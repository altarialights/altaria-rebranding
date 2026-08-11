import {
  finaliseEarlyFrameHealth,
  getPerformanceTierDebugDetail,
  getPerformanceTierState,
  hasManualPerformanceOverride,
  lockPerformanceTier,
  type FrameHealthReport,
  type PerformanceTier,
  type PerformanceTierDebugDetail,
} from './performance-tier';

const OUTLET_SELECTOR = '[data-hero-tier-outlet]';
const TEMPLATE_SELECTOR = 'template[data-hero-tier-template]';
const MEDIA_ATTRIBUTES = ['src', 'srcset', 'poster'] as const;
const DEFERRED_PREFIX = 'data-performance-';
const LATE_MEDIA_PREFIX = 'data-performance-late-';

export interface HeroTierRuntimeContext {
  readonly tier: PerformanceTier;
  readonly outlet: HTMLElement;
  readonly hero: HTMLElement | null;
  readonly debug: PerformanceTierDebugDetail;
}

/**
 * A tier runtime is imported only after the tier is locked. Its init method
 * is therefore intentionally one-way: no runtime is ever initialised merely
 * to benchmark it, and bootstrap never relies on teardown being possible.
 */
export interface HeroTierRuntimeModule {
  initHeroTier(context: HeroTierRuntimeContext): void | Promise<void>;
}

export type HeroTierRuntimeLoader = () => Promise<HeroTierRuntimeModule>;

export interface HeroTierBootstrapOptions {
  /** Deferred imports. Bootstrap invokes exactly one entry. */
  readonly runtimes: Record<PerformanceTier, HeroTierRuntimeLoader>;
  readonly outlet?: HTMLElement | string;
  readonly templateScope?: ParentNode;
  /** Defaults to two; exists only to make deterministic browser tests easier. */
  readonly connectedFrames?: number;
}

export interface HeroTierBootstrapResult {
  readonly tier: PerformanceTier;
  readonly outlet: HTMLElement;
  readonly hero: HTMLElement | null;
  readonly frameHealth: FrameHealthReport;
  readonly remounted: boolean;
  readonly debug: PerformanceTierDebugDetail;
}

interface MountedTier {
  readonly tier: PerformanceTier;
}

let bootstrapPromise: Promise<HeroTierBootstrapResult> | null = null;

function requireOutlet(outlet: HTMLElement | string | undefined): HTMLElement {
  if (outlet instanceof HTMLElement) return outlet;
  const selector = outlet ?? OUTLET_SELECTOR;
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Hero tier outlet not found: ${selector}`);
  return found;
}

function collectTemplates(scope: ParentNode): Map<PerformanceTier, HTMLTemplateElement> {
  const templates = new Map<PerformanceTier, HTMLTemplateElement>();

  for (const template of Array.from(
    scope.querySelectorAll<HTMLTemplateElement>(TEMPLATE_SELECTOR)
  )) {
    const tier = template.dataset.heroTierTemplate;
    if (tier !== 'full' && tier !== 'balanced' && tier !== 'lite') {
      throw new Error(
        `${TEMPLATE_SELECTOR} must have value "full", "balanced" or "lite"; got "${tier ?? ''}".`
      );
    }
    if (templates.has(tier)) {
      throw new Error(`Exactly one hero template is allowed for tier "${tier}".`);
    }
    templates.set(tier, template);
  }

  return templates;
}

function elementsIncludingRoot(root: ParentNode): Element[] {
  const elements = Array.from(root.querySelectorAll<Element>('*'));
  if (root instanceof Element) elements.unshift(root);
  return elements;
}

/**
 * Browser preload discovery can start as soon as a fragment is connected.
 * Move active media URLs to bootstrap-owned data attributes while the clone
 * is still detached. Existing component-level `data-src` contracts remain
 * untouched.
 */
export function neutraliseTierMedia(root: ParentNode): void {
  for (const element of elementsIncludingRoot(root)) {
    for (const attribute of MEDIA_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const deferredAttribute = `${DEFERRED_PREFIX}${attribute}`;
      if (element.hasAttribute(deferredAttribute)) {
        throw new Error(`Reserved attribute already present: ${deferredAttribute}`);
      }
      element.setAttribute(deferredAttribute, element.getAttribute(attribute) ?? '');
      element.removeAttribute(attribute);
    }
  }
}

function restoreAttribute(element: Element, attribute: (typeof MEDIA_ATTRIBUTES)[number]): void {
  const deferredAttribute = `${DEFERRED_PREFIX}${attribute}`;
  if (!element.hasAttribute(deferredAttribute)) return;
  element.setAttribute(attribute, element.getAttribute(deferredAttribute) ?? '');
  element.removeAttribute(deferredAttribute);
}

/** Restores URLs only on the final, selected tree and only after tier lock. */
export function restoreTierMedia(root: ParentNode): void {
  const all = elementsIncludingRoot(root);
  const sources = all.filter((element) => element.tagName === 'SOURCE');
  const responsiveImages = all.filter((element) => element.tagName === 'IMG');
  const remaining = all.filter(
    (element) => element.tagName !== 'SOURCE' && element.tagName !== 'IMG'
  );

  /* Source candidates and srcset precede img/src so the browser does not
     briefly request a fallback that responsive selection would replace. */
  for (const element of sources) {
    restoreAttribute(element, 'srcset');
    restoreAttribute(element, 'src');
  }
  for (const element of responsiveImages) restoreAttribute(element, 'srcset');
  for (const element of responsiveImages) restoreAttribute(element, 'src');
  for (const element of remaining) restoreAttribute(element, 'poster');
  for (const element of remaining) restoreAttribute(element, 'srcset');
  for (const element of remaining) restoreAttribute(element, 'src');
}

/**
 * WebKit may fetch a video even when it declares `preload="none"`. Preserve
 * the selected Full reel's original deferred contract by keeping only its
 * source URL cold until real navigation intent (or a restored scroll). The
 * poster is still restored at lock, so the first paint is unchanged.
 */
function holdColdVideoSources(root: ParentNode): void {
  const held: Array<{
    element: Element;
    attribute: 'src' | 'srcset';
  }> = [];

  for (const video of Array.from(
    root.querySelectorAll<HTMLVideoElement>('video[preload="none"]:not([autoplay])')
  )) {
    const candidates: Element[] = [
      ...Array.from(video.querySelectorAll('source')),
      video,
    ];
    for (const element of candidates) {
      for (const attribute of ['srcset', 'src'] as const) {
        const deferred = `${DEFERRED_PREFIX}${attribute}`;
        if (!element.hasAttribute(deferred)) continue;
        element.setAttribute(
          `${LATE_MEDIA_PREFIX}${attribute}`,
          element.getAttribute(deferred) ?? ''
        );
        element.removeAttribute(deferred);
        held.push({ element, attribute });
      }
    }
  }

  if (held.length === 0) return;
  let active = false;
  const navigationKeys = new Set([
    'ArrowDown',
    'ArrowUp',
    'End',
    'Home',
    'PageDown',
    'PageUp',
    ' ',
  ]);

  const cleanup = (): void => {
    window.removeEventListener('scroll', activate);
    window.removeEventListener('wheel', activate);
    window.removeEventListener('touchstart', activate);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', onPageHide);
  };
  const activate = (): void => {
    if (active) return;
    active = true;
    cleanup();
    for (const { element, attribute } of held) {
      const late = `${LATE_MEDIA_PREFIX}${attribute}`;
      element.setAttribute(attribute, element.getAttribute(late) ?? '');
      element.removeAttribute(late);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (navigationKeys.has(event.key)) activate();
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) cleanup();
  };

  if (window.scrollX > 1 || window.scrollY > 1) {
    activate();
    return;
  }

  window.addEventListener('scroll', activate, { passive: true });
  window.addEventListener('wheel', activate, { passive: true });
  window.addEventListener('touchstart', activate, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', onPageHide);
}

/**
 * Full normally receives this state synchronously from renderSurfaceLifecycle
 * and the master GSAP setup. During the two-frame automatic calibration the
 * runtime is deliberately absent, so mirror only its p=0 paint lifecycle.
 * Reduced Motion is excluded: its existing branch owns a different p=0.
 */
function applyFullPreflightP0(fragment: DocumentFragment): void {
  const state = getPerformanceTierState();
  if (state.signals.reducedMotion) return;

  fragment.querySelector<HTMLElement>('[data-intro-text]')?.classList.add('is-vapour-idle');

  const lifecycleSurfaces = fragment.querySelectorAll<HTMLElement>(
    [
      '[data-obj="phone"]',
      '[data-obj="laptop"]',
      '[data-obj="monitor"]',
      '[data-obj="tablet"]',
      '[data-obj="flow"]',
      '[data-web-scene="impact"]',
      '[data-web-scene="benefits"]',
      '[data-web-scene="results"]',
    ].join(',')
  );
  for (const surface of Array.from(lifecycleSurfaces)) surface.style.visibility = 'hidden';

  /* Master GSAP sets these to opacity:0 before its first render. Visibility
     is temporary here and released only after initHeroTier has applied its
     own p=0 state, preventing stacked copy from flashing during import. */
  for (const copy of Array.from(fragment.querySelectorAll<HTMLElement>('[data-beat-copy]'))) {
    copy.style.visibility = 'hidden';
    copy.dataset.performancePreflightCopy = '1';
  }
}

function releaseTemporaryP0(outlet: HTMLElement): void {
  for (const copy of Array.from(
    outlet.querySelectorAll<HTMLElement>('[data-performance-preflight-copy]')
  )) {
    copy.style.removeProperty('visibility');
    delete copy.dataset.performancePreflightCopy;
  }
}

function cloneTierTemplate(
  tier: PerformanceTier,
  templates: ReadonlyMap<PerformanceTier, HTMLTemplateElement>
): DocumentFragment {
  const template = templates.get(tier);
  if (!template) throw new Error(`Hero template for selected tier "${tier}" was not found.`);

  const fragment = template.content.cloneNode(true) as DocumentFragment;
  /* Tier templates are markup only. Runtime code must arrive through the
     selected loader, never through parser-inert scripts copied by accident. */
  for (const script of Array.from(fragment.querySelectorAll('script'))) script.remove();
  neutraliseTierMedia(fragment);
  if (tier === 'full') applyFullPreflightP0(fragment);
  return fragment;
}

function mountTier(
  outlet: HTMLElement,
  tier: PerformanceTier,
  templates: ReadonlyMap<PerformanceTier, HTMLTemplateElement>
): MountedTier {
  const fragment = cloneTierTemplate(tier, templates);
  outlet.replaceChildren(fragment);
  outlet.dataset.heroTier = tier;
  outlet.dataset.heroTierPhase = 'preflight';
  outlet.setAttribute('aria-busy', 'true');

  return { tier };
}

function isRestoredOrAdvancedScroll(): boolean {
  const state = getPerformanceTierState();
  return (
    state.restoredScroll ||
    window.scrollX > 1 ||
    window.scrollY > 1 ||
    (!!window.location.hash && window.location.hash !== '#top')
  );
}

async function waitUntilDomReady(): Promise<void> {
  if (document.readyState !== 'loading') return;
  await new Promise<void>((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

/** Observe real connected paints; no synthetic animation or benchmark work. */
async function waitForConnectedFrames(outlet: HTMLElement, count: number): Promise<void> {
  if (count <= 0 || typeof requestAnimationFrame !== 'function') return;
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!outlet.isConnected) {
      throw new Error('Hero tier outlet was disconnected during early calibration.');
    }
  }
}

function removeInactiveTemplates(templates: ReadonlyMap<PerformanceTier, HTMLTemplateElement>): void {
  for (const template of templates.values()) template.remove();
}

/**
 * The native hash jump can run while the outlet is still empty, before its
 * selected hero contributes any height. Re-apply that one initial anchor
 * synchronously after the final tree exists so the runtime reads the correct
 * restored scroll position on its first ScrollTrigger refresh.
 */
function restoreInitialAnchorPosition(): void {
  if (!window.location.hash || window.location.hash === '#top') return;
  let id: string;
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return;
  }
  const target = document.getElementById(id);
  if (!target) return;

  /* global.css deliberately enables smooth navigation for user actions.
     A restored/deep-link boot is state restoration, not an animation: a
     smooth trip through the entire hero would initialise the runtime at p=0
     and then scrub every beat. Force this one jump to be synchronous. */
  const root = document.documentElement;
  const previousValue = root.style.getPropertyValue('scroll-behavior');
  const previousPriority = root.style.getPropertyPriority('scroll-behavior');
  root.style.setProperty('scroll-behavior', 'auto', 'important');
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  if (previousValue) root.style.setProperty('scroll-behavior', previousValue, previousPriority);
  else root.style.removeProperty('scroll-behavior');
}

function dispatchReady(result: HeroTierBootstrapResult): void {
  document.dispatchEvent(
    new CustomEvent<HeroTierBootstrapResult>('altaria:hero-tier-ready', { detail: result })
  );
}

async function runBootstrap(options: HeroTierBootstrapOptions): Promise<HeroTierBootstrapResult> {
  await waitUntilDomReady();

  const state = getPerformanceTierState();
  const outlet = requireOutlet(options.outlet);
  const templates = collectTemplates(options.templateScope ?? document);
  const connectedFrames = Math.max(2, Math.floor(options.connectedFrames ?? 2));
  let mounted = mountTier(outlet, state.tier, templates);
  let remounted = false;
  let frameHealth: FrameHealthReport;

  if (hasManualPerformanceOverride()) {
    /* The head boot already locked overrides and never started its rAF. */
    frameHealth = finaliseEarlyFrameHealth(false);
  } else if (isRestoredOrAdvancedScroll()) {
    /* Never swap the tree under a restored/deep scroll position. */
    frameHealth = finaliseEarlyFrameHealth(true);
  } else {
    await waitForConnectedFrames(outlet, connectedFrames);
    frameHealth = finaliseEarlyFrameHealth(isRestoredOrAdvancedScroll());

    const resolvedTier = getPerformanceTierState().tier;
    if (resolvedTier !== mounted.tier) {
      mounted = mountTier(outlet, resolvedTier, templates);
      remounted = true;
      /* Let CSS establish p=0 on the replacement before its runtime owns it. */
      await waitForConnectedFrames(outlet, connectedFrames);
    }
  }

  const finalTier = lockPerformanceTier('before-runtime-import');
  if (finalTier !== mounted.tier) {
    /* Defensive: no state transition is expected after frame finalisation. */
    mounted = mountTier(outlet, finalTier, templates);
    remounted = true;
  }

  holdColdVideoSources(outlet);
  restoreTierMedia(outlet);
  removeInactiveTemplates(templates);
  restoreInitialAnchorPosition();

  /* This is the only import boundary. No inactive runtime is evaluated,
     no inactive listener is registered, and no inactive GSAP exists. */
  const loadRuntime = options.runtimes[finalTier];
  if (!loadRuntime) throw new Error(`Runtime loader for tier "${finalTier}" was not provided.`);
  const runtime = await loadRuntime();
  if (!runtime || typeof runtime.initHeroTier !== 'function') {
    throw new Error(`Runtime for tier "${finalTier}" must export initHeroTier().`);
  }

  const hero = outlet.querySelector<HTMLElement>('[data-hero]');
  await runtime.initHeroTier({
    tier: finalTier,
    outlet,
    hero,
    debug: getPerformanceTierDebugDetail(),
  });
  restoreInitialAnchorPosition();
  releaseTemporaryP0(outlet);

  outlet.dataset.heroTierPhase = 'ready';
  outlet.removeAttribute('aria-busy');
  const result: HeroTierBootstrapResult = {
    tier: finalTier,
    outlet,
    hero,
    frameHealth,
    remounted,
    debug: getPerformanceTierDebugDetail(),
  };
  dispatchReady(result);
  return result;
}

/**
 * Idempotent one-way hero boot. Calling it twice returns the original boot
 * promise; it can never initialise a second timeline or switch a live hero.
 */
export function bootstrapHeroTier(
  options: HeroTierBootstrapOptions
): Promise<HeroTierBootstrapResult> {
  bootstrapPromise ??= runBootstrap(options);
  return bootstrapPromise;
}
