#!/usr/bin/env node

/**
 * ALTARIA LIGHTS — Phase 3 responsive QA.
 *
 * Read-only browser audit of the built Balanced/Lite heroes. The runner may
 * add a harness-only `scroll-behavior:auto` rule and move/focus the page, but
 * it never mutates application data or source files.
 *
 * Usage:
 *   pnpm build
 *   node scripts/phase3-responsive-qa.mjs
 *   node scripts/phase3-responsive-qa.mjs --base http://127.0.0.1:4321
 *
 * Environment: BASE_URL, OUT, PW_CHROME, QA_SETTLE_MS.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const arg = (name, fallback) => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE = arg('base', process.env.BASE_URL ?? 'http://127.0.0.1:4327');
const OUT = path.resolve(arg('out', process.env.OUT ?? 'review/phase3-responsive-qa'));
const SETTLE_MS = Number(arg('settle', process.env.QA_SETTLE_MS ?? 180));
const SOFT_EXIT = process.argv.includes('--soft');
const TIERS = ['balanced', 'lite'];
const VIEWPORTS = [
  { width: 1020, height: 640, id: '1020x640' },
  { width: 1152, height: 720, id: '1152x720' },
  { width: 1280, height: 720, id: '1280x720' },
  { width: 1366, height: 768, id: '1366x768' },
  { width: 1440, height: 900, id: '1440x900' },
  { width: 1920, height: 1080, id: '1920x1080' },
  { width: 2560, height: 1440, id: '2560x1440' },
];

const MOMENTS = [
  { id: 'intro', progress: 0.013077, beat: 'intro', subject: '[data-perf-intro]' },
  {
    id: 'phone',
    progress: 0.160192,
    beat: 'social',
    subject: '[data-perf-object="phone"]',
    copy: 'social',
  },
  {
    id: 'laptop',
    progress: 0.230154,
    beat: 'web',
    subject: '[data-perf-object="laptop"]',
    copy: 'web',
    scene: 'impact',
  },
  {
    id: 'miniweb-1',
    progress: 0.32,
    beat: 'web',
    subject: '[data-perf-object="laptop"]',
    copy: 'web',
    scene: 'impact',
  },
  {
    id: 'miniweb-2',
    progress: 0.46,
    beat: 'web',
    subject: '[data-perf-object="laptop"]',
    copy: 'web',
    scene: 'benefits',
  },
  {
    id: 'miniweb-3',
    progress: 0.59,
    beat: 'web',
    subject: '[data-perf-object="laptop"]',
    copy: 'web',
    scene: 'results',
  },
  {
    id: 'monitor',
    progress: 0.735,
    beat: 'software',
    subject: '[data-perf-object="monitor"]',
    copy: 'software',
  },
  {
    id: 'tablet',
    progress: 0.825,
    beat: 'brand',
    subject: '[data-perf-object="tablet"]',
    copy: 'brand',
  },
  {
    id: 'flow',
    progress: 0.915,
    beat: 'system',
    subject: '[data-perf-object="flow"]',
    copy: 'growth',
  },
];

const EASTER_WINDOWS = {
  'birds-a': [0.09, 0.154, 0.12],
  plane: [0.3, 0.375, 0.335],
  'birds-b': [0.575, 0.64, 0.605],
  rocket: [0.77, 0.846, 0.81],
};

if (!Number.isFinite(SETTLE_MS) || SETTLE_MS < 0) {
  throw new Error('--settle / QA_SETTLE_MS debe ser un número >= 0.');
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'failures'), { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1600) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensurePreview() {
  if (await reachable()) {
    return { kind: 'existing-server', close: async () => {} };
  }
  if (!existsSync(path.resolve('dist/index.html'))) {
    throw new Error('No existe dist/index.html. Ejecuta `pnpm build` antes del QA.');
  }

  const target = new URL(BASE);
  const astroBin = path.resolve('node_modules/astro/astro.js');
  const child = spawn(
    process.execPath,
    [astroBin, 'preview', '--host', target.hostname, '--port', target.port || '80'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-5000);
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`astro preview terminó antes de arrancar:\n${stderr}`);
    }
    if (await reachable()) {
      return {
        kind: 'astro-preview',
        close: async () => {
          if (child.exitCode === null) child.kill();
        },
      };
    }
    await sleep(150);
  }
  child.kill();
  throw new Error(`astro preview no respondió a tiempo:\n${stderr}`);
}

function makeUrl(tier) {
  const url = new URL(BASE);
  url.searchParams.set('perf', tier);
  url.searchParams.set('scrub', '0');
  url.searchParams.set('still', '1');
  return url.href;
}

async function preparePage(page, tier) {
  await page.goto(makeUrl(tier), { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html, body { scroll-behavior: auto !important; }' });
  await page.waitForFunction(
    (expectedTier) => {
      const outlet = document.querySelector('[data-hero-tier-outlet]');
      return (
        outlet?.getAttribute('data-hero-tier') === expectedTier &&
        outlet?.getAttribute('data-hero-tier-phase') === 'ready' &&
        document.documentElement.dataset.performanceTier === expectedTier &&
        document.querySelectorAll('[data-hero]').length === 1
      );
    },
    tier,
    { timeout: 15000 }
  );
  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
    return document.fonts?.ready ?? Promise.resolve();
  });
  await page.waitForTimeout(120);
}

async function seek(page, progress, settle = SETTLE_MS) {
  const destination = await page.evaluate((fraction) => {
    const hero = document.querySelector('[data-hero]');
    if (!(hero instanceof HTMLElement)) throw new Error('[data-hero] ausente');
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
    const top = hero.getBoundingClientRect().top + window.scrollY;
    const travel = Math.max(0, hero.getBoundingClientRect().height - window.innerHeight);
    const next = top + travel * fraction;
    window.scrollTo({ top: next, left: 0, behavior: 'instant' });
    if (document.scrollingElement) document.scrollingElement.scrollTop = next;
    return next;
  }, progress);
  await page.waitForFunction(
    (target) => Math.abs(window.scrollY - target) <= 1,
    destination,
    { timeout: 3000 }
  );
  await page.waitForTimeout(settle);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function inspectBeat(page, expected) {
  return page.evaluate((config) => {
    const root = document.querySelector('[data-performance-hero]');
    const hero = document.querySelector('[data-hero]');
    const stage = root?.querySelector('[data-performance-stage]');
    const outlet = document.querySelector('[data-hero-tier-outlet]');

    const rectOf = (element) => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        area,
        visibleFraction: area > 0 ? visibleArea / area : 0,
      };
    };

    const effectiveOpacity = (element) => {
      let opacity = 1;
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return 0;
        opacity *= Number(style.opacity || 1);
        if (current === root) break;
        current = current.parentElement;
      }
      return opacity;
    };

    const isInert = (element) => {
      let current = element;
      while (current instanceof HTMLElement) {
        if (current.inert || current.hasAttribute('inert')) return true;
        current = current.parentElement;
      }
      return false;
    };

    const visual = (element) => {
      const rect = rectOf(element);
      const opacity = element instanceof Element ? effectiveOpacity(element) : 0;
      return {
        exists: element instanceof Element,
        opacity,
        rect,
        visible: Boolean(rect && opacity >= 0.45 && rect.visibleFraction >= 0.55),
      };
    };

    const overlap = (a, b) => {
      if (!a || !b || a.area <= 0 || b.area <= 0) return 0;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return (width * height) / Math.min(a.area, b.area);
    };

    const subjectElement = root?.querySelector(config.subject) ?? null;
    const copyRoot = config.copy
      ? root?.querySelector(`[data-perf-copy="${config.copy}"]`) ?? null
      : null;
    const copyContent = copyRoot?.querySelector('.perf-copy__content') ?? copyRoot;
    const subject = visual(subjectElement);
    const copy = copyContent ? visual(copyContent) : null;

    const balancedScenes = root?.getAttribute('data-performance-tier') === 'balanced';
    const sceneSelector = balancedScenes ? '[data-web-scene]' : '[data-perf-web-scene]';
    const sceneAttribute = balancedScenes ? 'data-web-scene' : 'data-perf-web-scene';
    const scenes = [...(root?.querySelectorAll(sceneSelector) ?? [])].map(
      (scene) => ({
        id: scene.getAttribute(sceneAttribute),
        ariaHidden: scene.getAttribute('aria-hidden'),
        ...visual(scene),
        headingPx: Number.parseFloat(
          getComputedStyle(scene.querySelector('h3') ?? scene).fontSize || '0'
        ),
      })
    );

    const hiddenFocusableLeaks = [];
    const focusables = root?.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]'
    ) ?? [];
    for (const element of focusables) {
      const opacity = effectiveOpacity(element);
      const rect = rectOf(element);
      const visuallyHidden = opacity < 0.08 || !rect || rect.visibleFraction === 0;
      const disabled = 'disabled' in element && Boolean(element.disabled);
      if (visuallyHidden && element.tabIndex >= 0 && !disabled && !isInert(element)) {
        hiddenFocusableLeaks.push({
          tag: element.tagName,
          id: element.getAttribute('data-perf-flow-node') ??
            element.getAttribute('data-perf-brand-swatch') ??
            element.getAttribute('data-perf-easter'),
          tabIndex: element.tabIndex,
          opacity,
        });
      }
    }

    const easter = [...(root?.querySelectorAll(
      '[data-perf-easter]:not([data-perf-easter="sun"])'
    ) ?? [])].map((event) => ({
      id: event.getAttribute('data-perf-easter'),
      opacity: effectiveOpacity(event),
      pointerEvents: getComputedStyle(event).pointerEvents,
    }));

    const stageRect = rectOf(stage);
    const heroTop = hero ? hero.getBoundingClientRect().top + scrollY : 0;
    const heroTravel = hero
      ? Math.max(0, hero.getBoundingClientRect().height - innerHeight)
      : 0;
    const copyTitle = copyRoot?.querySelector('.perf-copy__title');
    const copySub = copyRoot?.querySelector('.perf-copy__sub');

    return {
      htmlTier: document.documentElement.dataset.performanceTier ?? null,
      stateTier: window.__ALTARIA_PERFORMANCE__?.tier ?? null,
      stateLocked: window.__ALTARIA_PERFORMANCE__?.locked ?? false,
      outletTier: outlet?.getAttribute('data-hero-tier') ?? null,
      outletPhase: outlet?.getAttribute('data-hero-tier-phase') ?? null,
      outletBusy: outlet?.getAttribute('aria-busy') ?? null,
      heroCount: document.querySelectorAll('[data-hero]').length,
      adaptiveHeroCount: document.querySelectorAll('[data-performance-hero]').length,
      templateCount: document.querySelectorAll('template[data-hero-tier-template]').length,
      rootTier: root?.getAttribute('data-performance-tier') ?? null,
      rootBeat: root?.getAttribute('data-performance-beat') ?? null,
      stageBeat: stage?.getAttribute('data-beat') ?? null,
      stageRect,
      subject,
      copy,
      overlapRatio: copy ? overlap(subject.rect, copy.rect) : 0,
      copyTitlePx: copyTitle ? Number.parseFloat(getComputedStyle(copyTitle).fontSize) : null,
      copySubPx: copySub ? Number.parseFloat(getComputedStyle(copySub).fontSize) : null,
      scenes,
      hiddenFocusableLeaks,
      easter,
      scrollX: window.scrollX,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      progress: heroTravel > 0 ? (scrollY - heroTop) / heroTravel : 0,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, expected);
}

function validateBeat(audit, tier, moment) {
  const failures = [];
  const check = (condition, code, message, detail) => {
    if (!condition) failures.push({ code, message, detail });
  };

  check(audit.htmlTier === tier, 'tier-html', `html tier=${audit.htmlTier}; esperado ${tier}`);
  check(audit.stateTier === tier, 'tier-state', `boot tier=${audit.stateTier}; esperado ${tier}`);
  check(audit.stateLocked, 'tier-unlocked', 'El tier no está bloqueado.');
  check(audit.outletTier === tier, 'tier-outlet', `outlet tier=${audit.outletTier}; esperado ${tier}`);
  check(audit.outletPhase === 'ready', 'tier-not-ready', `outlet phase=${audit.outletPhase}`);
  check(audit.outletBusy === null, 'outlet-busy', 'El outlet sigue aria-busy.', audit.outletBusy);
  check(audit.heroCount === 1, 'hero-count', `Hay ${audit.heroCount} [data-hero]; esperado 1.`);
  check(
    audit.adaptiveHeroCount === 1,
    'adaptive-count',
    `Hay ${audit.adaptiveHeroCount} heroes adaptativos; esperado 1.`
  );
  check(audit.templateCount === 0, 'templates-live', `Quedan ${audit.templateCount} templates.`);
  check(audit.rootTier === tier, 'root-tier', `root tier=${audit.rootTier}; esperado ${tier}`);
  check(audit.rootBeat === moment.beat, 'root-beat', `beat=${audit.rootBeat}; esperado ${moment.beat}`);
  check(Math.abs(audit.progress - moment.progress) <= 0.002, 'seek', 'Progreso inexacto.', audit.progress);
  check(audit.scrollX === 0, 'scroll-x', `window.scrollX=${audit.scrollX}`);
  check(audit.overflowX <= 1, 'overflow-x', `Overflow horizontal=${audit.overflowX}px.`);

  const stage = audit.stageRect;
  check(Boolean(stage), 'stage-missing', 'No existe stage.');
  if (stage) {
    check(Math.abs(stage.top) <= 1.5, 'stage-top', `Stage top=${stage.top}px.`);
    check(Math.abs(stage.left) <= 1.5, 'stage-left', `Stage left=${stage.left}px.`);
    check(
      Math.abs(stage.width - audit.viewport.width) <= 2,
      'stage-width',
      `Stage width=${stage.width}; viewport=${audit.viewport.width}.`
    );
    check(
      Math.abs(stage.height - audit.viewport.height) <= 2,
      'stage-height',
      `Stage height=${stage.height}; viewport=${audit.viewport.height}.`
    );
  }

  check(audit.subject.exists, 'subject-missing', `Falta protagonista ${moment.subject}.`);
  check(audit.subject.visible, 'subject-hidden', 'Protagonista no visible/encuadrado.', audit.subject);
  if (moment.copy) {
    check(Boolean(audit.copy), 'copy-missing', `Falta copy ${moment.copy}.`);
    check(audit.copy?.visible, 'copy-hidden', 'Copy no visible/encuadrado.', audit.copy);
    check(
      audit.overlapRatio <= 0.08,
      'material-overlap',
      `Copy/protagonista se solapan ${(audit.overlapRatio * 100).toFixed(1)}%.`,
      { subject: audit.subject.rect, copy: audit.copy?.rect }
    );
    check((audit.copyTitlePx ?? 0) >= 30, 'copy-title-small', `Título a ${audit.copyTitlePx}px.`);
    check((audit.copySubPx ?? 0) >= 14, 'copy-sub-small', `Subcopy a ${audit.copySubPx}px.`);
  }

  if (moment.scene) {
    const active = audit.scenes.filter(
      (scene) => scene.ariaHidden === 'false' && scene.opacity >= 0.4
    );
    check(active.length === 1, 'miniweb-active-count', `Escenas activas accesibles=${active.length}.`, audit.scenes);
    check(active[0]?.id === moment.scene, 'miniweb-active', `Escena=${active[0]?.id}; esperada ${moment.scene}.`);
    check(active[0]?.visible, 'miniweb-hidden', 'La escena miniweb activa no está visible.', active[0]);
    check((active[0]?.headingPx ?? 0) >= 12, 'miniweb-type-small', `Heading miniweb a ${active[0]?.headingPx}px.`);
    for (const scene of audit.scenes.filter((candidate) => candidate.id !== moment.scene)) {
      check(
        scene.ariaHidden === 'true',
        'miniweb-inactive-a11y',
        `Escena inactiva ${scene.id} no tiene aria-hidden=true.`
      );
      check(
        scene.opacity <= 0.08,
        'miniweb-inactive-visible',
        `Escena inactiva ${scene.id} conserva opacity=${scene.opacity}.`
      );
    }
  }

  check(
    audit.hiddenFocusableLeaks.length === 0,
    'hidden-focusable',
    'Hay controles invisibles en el tab order.',
    audit.hiddenFocusableLeaks
  );
  const hiddenPointerLeaks = audit.easter.filter(
    (event) => event.opacity <= 0.08 && event.pointerEvents !== 'none'
  );
  check(
    hiddenPointerLeaks.length === 0,
    'hidden-pointer',
    'Hay easter eggs invisibles con pointer activo.',
    hiddenPointerLeaks
  );

  return failures;
}

async function captureFailure(page, id) {
  const safe = id.replaceAll(/[^a-z0-9_-]+/gi, '-');
  const file = path.join(OUT, 'failures', `${safe}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  return path.relative(OUT, file).replaceAll('\\', '/');
}

async function runNavigation(page) {
  const results = [];
  await page.evaluate(() => document.body?.focus());
  await page.keyboard.press('End');
  await page.waitForFunction(
    () => {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      return Math.abs(max - scrollY) <= 3 && scrollX === 0;
    },
    undefined,
    { timeout: 1500 }
  ).catch(() => {});
  const end = await page.evaluate(() => ({
    y: scrollY,
    max: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    x: scrollX,
  }));
  results.push({
    id: 'End',
    passed: end.max > 0 && Math.abs(end.max - end.y) <= 3 && end.x === 0,
    state: end,
  });

  /* Let the browser finish dispatching the first keyboard scroll before the
     opposite key. Without this quiet frame Chromium can occasionally ignore
     Home when it follows End in the same settling cycle. */
  await page.waitForTimeout(120);
  await page.keyboard.press('Home');
  await page.waitForFunction(
    () => scrollY <= 1 && scrollX === 0,
    undefined,
    { timeout: 1500 }
  ).catch(() => {});
  const home = await page.evaluate(() => ({ y: scrollY, x: scrollX }));
  results.push({ id: 'Home', passed: home.y <= 1 && home.x === 0, state: home });
  return results;
}

async function runInteractiveSmoke(browser, tier) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const checks = [];
  const push = (id, passed, detail = null) => checks.push({ id, passed, detail });

  try {
    await preparePage(page, tier);
    await seek(page, MOMENTS[0].progress);

    const sun = page.locator('[data-perf-easter="sun"]');
    const sunBox = await sun.boundingBox();
    if (sunBox) {
      await page.mouse.click(sunBox.x + sunBox.width / 2, sunBox.y + sunBox.height * 0.88);
    }
    await page.waitForTimeout(80);
    const sunOpen = await page.evaluate(() => ({
      hidden: document.querySelector('[data-perf-sun-message]')?.hidden,
      state: document.querySelector('[data-performance-stage]')?.getAttribute('data-perf-sun-open'),
    }));
    push('sun-opens', sunOpen.hidden === false && sunOpen.state === '1', sunOpen);
    await seek(page, 0.04, 700);
    const sunClosed = await page.evaluate(() => ({
      hidden: document.querySelector('[data-perf-sun-message]')?.hidden,
      state: document.querySelector('[data-performance-stage]')?.getAttribute('data-perf-sun-open'),
    }));
    push('sun-closes', sunClosed.hidden === true && sunClosed.state === null, sunClosed);

    for (const [id, [, , midpoint]] of Object.entries(EASTER_WINDOWS)) {
      await seek(page, midpoint, 100);
      const pointerState = await page.evaluate((activeId) =>
        [...document.querySelectorAll('[data-perf-easter]:not([data-perf-easter="sun"])')].map(
          (element) => ({
            id: element.getAttribute('data-perf-easter'),
            pointer: getComputedStyle(element).pointerEvents,
          })
        ), id
      );
      push(
        `${id}-exclusive-pointer`,
        pointerState.every((entry) =>
          entry.id === id ? entry.pointer === 'auto' : entry.pointer === 'none'
        ),
        pointerState
      );

      const event = page.locator(`[data-perf-easter="${id}"]`);
      const box = await event.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(40);
      const reactionOpen = await page.evaluate(
        () => document.querySelector('[data-perf-reaction]')?.hidden === false
      );
      push(`${id}-reaction-opens`, reactionOpen, { box });
      await page.waitForTimeout(630);
      const reactionClosed = await page.evaluate(
        () => document.querySelector('[data-perf-reaction]')?.hidden === true
      );
      push(`${id}-reaction-closes`, reactionClosed);
    }

    await seek(page, 0.70, 100);
    const tabletBefore = await page.evaluate(() => ({
      inert: document.querySelector('[data-perf-object="tablet"]')?.inert,
      tabs: [...document.querySelectorAll('[data-perf-brand-swatch]')].map((item) => item.tabIndex),
    }));
    push(
      'swatches-disabled-before-brand',
      tabletBefore.inert === true && tabletBefore.tabs.every((value) => value === -1),
      tabletBefore
    );

    await seek(page, 0.825, 120);
    const firstSwatch = page.locator('[data-perf-brand-swatch]').first();
    await firstSwatch.hover();
    const swatchHover = await firstSwatch.evaluate((element) => ({
      inert: element.closest('[data-perf-object="tablet"]')?.inert,
      tabIndex: element.tabIndex,
      tooltipOpacity: getComputedStyle(element, '::after').opacity,
    }));
    push(
      'swatch-hover',
      swatchHover.inert === false &&
        swatchHover.tabIndex === 0 &&
        Number(swatchHover.tooltipOpacity) >= 0.9,
      swatchHover
    );
    await firstSwatch.focus();
    const swatchFocus = await firstSwatch.evaluate(
      (element) => document.activeElement === element && element.tabIndex === 0
    );
    push('swatch-focus', swatchFocus);

    const flowBefore = await page.evaluate(() => ({
      inert: document.querySelector('[data-perf-object="flow"]')?.inert,
      activeLinks: [...document.querySelectorAll('[data-perf-flow-node]')].filter(
        (link) => link.tabIndex >= 0 && !link.closest('[inert]')
      ).length,
    }));
    push('flow-disabled-before-system', flowBefore.inert === true && flowBefore.activeLinks === 0, flowBefore);

    await seek(page, 0.915, 120);
    const firstFlow = page.locator('[data-perf-flow-node]').first();
    await firstFlow.focus();
    const flowActive = await firstFlow.evaluate((element) => ({
      inert: element.closest('[data-perf-object="flow"]')?.inert,
      focused: document.activeElement === element,
      tabIndex: element.tabIndex,
      tabletInert: document.querySelector('[data-perf-object="tablet"]')?.inert,
      tabletTabs: [...document.querySelectorAll('[data-perf-brand-swatch]')].map(
        (item) => item.tabIndex
      ),
    }));
    push(
      'flow-enabled-system-only',
      flowActive.inert === false &&
        flowActive.focused &&
        flowActive.tabIndex === 0 &&
        flowActive.tabletInert === true &&
        flowActive.tabletTabs.every((value) => value === -1),
      flowActive
    );

    await seek(page, 0.98, 100);
    const flowAfter = await page.evaluate(() => ({
      inert: document.querySelector('[data-perf-object="flow"]')?.inert,
      activeLinks: [...document.querySelectorAll('[data-perf-flow-node]')].filter(
        (link) => link.tabIndex >= 0 && !link.closest('[inert]')
      ).length,
      pointers: [...document.querySelectorAll('[data-perf-easter]:not([data-perf-easter="sun"])')]
        .map((event) => getComputedStyle(event).pointerEvents),
    }));
    push(
      'interactive-cleanup-after-hero',
      flowAfter.inert === true &&
        flowAfter.activeLinks === 0 &&
        flowAfter.pointers.every((value) => value === 'none'),
      flowAfter
    );
  } finally {
    await context.close();
  }

  return {
    kind: 'interactions',
    tier,
    viewport: '1366x768',
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function runReducedSmoke(browser, tier) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await preparePage(page, tier);
    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-performance-hero]');
      const balanced = root?.getAttribute('data-performance-tier') === 'balanced';
      const result = root?.querySelector(
        balanced ? '[data-web-scene="results"]' : '[data-perf-web-scene="results"]'
      );
      const intro = root?.querySelector('[data-perf-intro]');
      const stage = root?.querySelector('[data-performance-stage]');
      const stageRect = stage?.getBoundingClientRect();
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        tier: document.documentElement.dataset.performanceTier,
        ready: document.querySelector('[data-hero-tier-outlet]')?.getAttribute('data-hero-tier-phase'),
        heroCount: document.querySelectorAll('[data-hero]').length,
        templates: document.querySelectorAll('template[data-hero-tier-template]').length,
        videos: root?.querySelectorAll('video').length ?? -1,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stage: stageRect ? { top: stageRect.top, width: stageRect.width, height: stageRect.height } : null,
        resultOpacity: result ? Number(getComputedStyle(result).opacity) : 0,
        resultAriaHidden: result?.getAttribute('aria-hidden'),
        introOpacity: intro ? Number(getComputedStyle(intro).opacity) : 1,
        flowInert: root?.querySelector('[data-perf-object="flow"]')?.inert,
        tabletInert: root?.querySelector('[data-perf-object="tablet"]')?.inert,
      };
    });
    const checks = [
      ['media-query', state.reduced],
      ['tier-ready', state.tier === tier && state.ready === 'ready'],
      ['single-hero', state.heroCount === 1 && state.templates === 0],
      ['tier-video-contract', state.videos === 1],
      ['no-overflow-x', state.overflowX <= 1],
      [
        'stage-framed',
        Boolean(
          state.stage &&
            Math.abs(state.stage.top) <= 1.5 &&
            Math.abs(state.stage.width - 1366) <= 2 &&
            Math.abs(state.stage.height - 768) <= 2
        ),
      ],
      ['results-visible-accessible', state.resultOpacity >= 0.9 && state.resultAriaHidden === 'false'],
      ['intro-hidden', state.introOpacity <= 0.08],
      [
        'static-controls-contract',
        state.flowInert === false && state.tabletInert === true,
      ],
    ].map(([id, passed]) => ({ id, passed: Boolean(passed) }));
    return {
      kind: 'reduced-motion',
      tier,
      viewport: '1366x768',
      passed: checks.every((check) => check.passed),
      checks,
      state,
    };
  } finally {
    await context.close();
  }
}

async function runNoScriptSmoke(browser) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    javaScriptEnabled: false,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const state = await page.evaluate(() => {
      const fallback = document.querySelector('[data-hero-boot-fallback]');
      const header = document.querySelector('[data-header-capsule]');
      const fallbackRect = fallback?.getBoundingClientRect();
      const headerRect = header?.getBoundingClientRect();
      return {
        fallbackDisplay: fallback ? getComputedStyle(fallback).display : null,
        fallbackVisibility: fallback ? getComputedStyle(fallback).visibility : null,
        fallbackOpacity: fallback ? Number(getComputedStyle(fallback).opacity) : 0,
        fallbackArea: fallbackRect ? fallbackRect.width * fallbackRect.height : 0,
        fallbackText: fallback?.textContent?.trim().length ?? 0,
        headerOpacity: header ? Number(getComputedStyle(header).opacity) : 0,
        headerArea: headerRect ? headerRect.width * headerRect.height : 0,
        bodyText: document.body.textContent?.trim().length ?? 0,
      };
    });
    const checks = [
      [
        'fallback-visible',
        state.fallbackDisplay !== 'none' &&
          state.fallbackVisibility !== 'hidden' &&
          state.fallbackOpacity >= 0.9 &&
          state.fallbackArea > 10000,
      ],
      ['fallback-copy', state.fallbackText > 40],
      ['header-visible', state.headerOpacity >= 0.9 && state.headerArea > 1000],
      ['page-not-empty', state.bodyText > 100],
    ].map(([id, passed]) => ({ id, passed: Boolean(passed) }));
    return {
      kind: 'javascript-disabled',
      viewport: '1366x768',
      passed: checks.every((check) => check.passed),
      checks,
      state,
    };
  } finally {
    await context.close();
  }
}

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  config: { tiers: TIERS, viewports: VIEWPORTS, moments: MOMENTS, settleMs: SETTLE_MS },
  server: null,
  browser: null,
  beatCases: [],
  navigationCases: [],
  smokeCases: [],
  summary: null,
};

let preview;
let browser;

try {
  preview = await ensurePreview();
  report.server = preview.kind;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROME || undefined,
  });
  report.browser = await browser.version();

  for (const tier of TIERS) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        locale: 'es-ES',
        timezoneId: 'Europe/Madrid',
        colorScheme: 'light',
        reducedMotion: 'no-preference',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
      });

      try {
        await preparePage(page, tier);
        for (const direction of ['forward', 'reverse']) {
          const moments = direction === 'forward' ? MOMENTS : [...MOMENTS].reverse();
          for (const moment of moments) {
            await seek(page, moment.progress);
            const audit = await inspectBeat(page, moment);
            const failures = validateBeat(audit, tier, moment);
            const id = `${tier}-${viewport.id}-${direction}-${moment.id}`;
            const result = {
              kind: 'beat',
              id,
              tier,
              viewport: viewport.id,
              direction,
              moment: moment.id,
              progress: moment.progress,
              passed: failures.length === 0,
              failures,
              audit,
            };
            if (!result.passed) result.screenshot = await captureFailure(page, id);
            report.beatCases.push(result);
          }
        }

        const navigation = await runNavigation(page);
        for (const result of navigation) {
          report.navigationCases.push({
            kind: 'navigation',
            tier,
            viewport: viewport.id,
            ...result,
            id: `${tier}-${viewport.id}-${result.id}`,
          });
        }
        if (runtimeErrors.length) {
          report.navigationCases.push({
            kind: 'runtime-errors',
            id: `${tier}-${viewport.id}-runtime-errors`,
            tier,
            viewport: viewport.id,
            passed: false,
            errors: runtimeErrors,
          });
        }
      } catch (error) {
        report.navigationCases.push({
          kind: 'page-fatal',
          id: `${tier}-${viewport.id}-fatal`,
          tier,
          viewport: viewport.id,
          passed: false,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        try {
          await captureFailure(page, `${tier}-${viewport.id}-fatal`);
        } catch {
          // The page may already be gone; the diagnostic above survives.
        }
      } finally {
        await context.close();
      }
    }
  }

  for (const tier of TIERS) {
    report.smokeCases.push(await runInteractiveSmoke(browser, tier));
    report.smokeCases.push(await runReducedSmoke(browser, tier));
  }
  report.smokeCases.push(await runNoScriptSmoke(browser));
} finally {
  if (browser) await browser.close();
  if (preview) await preview.close();
}

const allCases = [
  ...report.beatCases,
  ...report.navigationCases,
  ...report.smokeCases,
];
const failed = allCases.filter((result) => !result.passed);
report.finishedAt = new Date().toISOString();
report.summary = {
  total: allCases.length,
  passed: allCases.length - failed.length,
  failed: failed.length,
  beatCases: report.beatCases.length,
  navigationCases: report.navigationCases.length,
  smokeCases: report.smokeCases.length,
};

const summaryFile = path.join(OUT, 'summary.json');
writeFileSync(summaryFile, `${JSON.stringify(report, null, 2)}\n`);

for (const failure of failed) {
  const detail = failure.failures?.map((item) => item.code).join(', ') ||
    failure.checks?.filter((item) => !item.passed).map((item) => item.id).join(', ') ||
    failure.error || failure.errors?.join(' | ') || 'fallo sin detalle';
  console.error(`FAIL ${failure.id ?? `${failure.kind}-${failure.tier ?? ''}`}: ${detail}`);
}

console.log(
  `Phase 3 responsive QA: ${report.summary.passed}/${report.summary.total} PASS; ` +
    `${report.summary.failed} FAIL.`
);
console.log(`Informe: ${summaryFile}`);

if (failed.length && !SOFT_EXIT) process.exitCode = 1;
