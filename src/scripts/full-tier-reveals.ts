import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type RevealPattern = 'heading' | 'text' | 'media-left' | 'media-right' | 'cards' | 'cta';

interface MotionPreset {
  distance: number;
  duration: number;
  ease: string;
  scale?: number;
}

interface FullRevealDebugState {
  initialized: boolean;
  triggerCount: number;
  tweenCount: number;
  completed: number;
  cleanup: () => void;
}

declare global {
  interface Window {
    __ALTARIA_FULL_REVEALS__?: FullRevealDebugState;
  }
}

gsap.registerPlugin(ScrollTrigger);

const ROOT_ATTRIBUTE = 'data-full-reveal';

function uniqueElements(elements: Iterable<Element>): HTMLElement[] {
  return Array.from(new Set(Array.from(elements))).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function directChildren(root: Element): HTMLElement[] {
  return Array.from(root.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function visibleElement(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
}

export function initFullTierReveals(): (() => void) | undefined {
  if (document.documentElement.dataset.performanceTier !== 'full') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.__ALTARIA_FULL_REVEALS__?.initialized) {
    return window.__ALTARIA_FULL_REVEALS__.cleanup;
  }

  const deviceClass = document.documentElement.dataset.deviceClass;
  const mobile = deviceClass === 'mobile';
  const tablet = deviceClass === 'tablet';
  const motion: Record<RevealPattern, MotionPreset> = {
    heading: {
      distance: mobile ? 15 : tablet ? 18 : 21,
      duration: mobile ? 0.74 : tablet ? 0.82 : 0.9,
      ease: 'power3.out',
    },
    text: {
      distance: mobile ? 8 : tablet ? 10 : 12,
      duration: mobile ? 0.66 : tablet ? 0.72 : 0.78,
      ease: 'power2.out',
    },
    'media-left': {
      distance: mobile ? 18 : tablet ? 24 : 29,
      duration: mobile ? 0.84 : tablet ? 0.98 : 1.08,
      ease: 'power3.out',
      scale: 0.99,
    },
    'media-right': {
      distance: mobile ? 18 : tablet ? 24 : 29,
      duration: mobile ? 0.84 : tablet ? 0.98 : 1.08,
      ease: 'power3.out',
      scale: 0.99,
    },
    cards: {
      distance: mobile ? 13 : tablet ? 16 : 18,
      duration: mobile ? 0.7 : tablet ? 0.77 : 0.84,
      ease: 'power3.out',
    },
    cta: {
      distance: mobile ? 6 : tablet ? 7 : 8,
      duration: mobile ? 0.62 : tablet ? 0.66 : 0.7,
      ease: 'power2.out',
    },
  };
  const stagger = mobile ? 0.065 : tablet ? 0.08 : 0.095;
  const headingStagger = mobile ? 0.055 : tablet ? 0.07 : 0.085;
  const start = mobile ? 'top 94%' : tablet ? 'top 93%' : 'top 92%';
  const tweens: gsap.core.Tween[] = [];
  const ownedTriggers: ScrollTrigger[] = [];
  const prepared = new Set<HTMLElement>();
  const legacyHeroAnimations = new Map<HTMLElement, { value: string; priority: string }>();
  const managedTransitions = new Map<HTMLElement, { value: string; priority: string }>();
  let completed = 0;
  let refreshFrame = 0;

  const debugState: FullRevealDebugState = {
    initialized: true,
    triggerCount: 0,
    tweenCount: 0,
    completed: 0,
    cleanup: () => undefined,
  };
  window.__ALTARIA_FULL_REVEALS__ = debugState;
  document.documentElement.setAttribute('data-full-reveals', 'active');

  const motionVars = (pattern: RevealPattern): gsap.TweenVars => {
    const preset = motion[pattern];
    if (pattern === 'media-left') {
      return { x: -preset.distance, scale: preset.scale, transformOrigin: '50% 50%' };
    }
    if (pattern === 'media-right') {
      return { x: preset.distance, scale: preset.scale, transformOrigin: '50% 50%' };
    }
    if (pattern === 'heading') {
      return {
        y: (_index: number, target: Element) => {
          if (target.matches('h1, h2, h3, h4')) return preset.distance;
          if (target.matches('a, button, [class*="actions"]')) return motion.cta.distance;
          return motion.text.distance;
        },
      };
    }
    return { y: preset.distance };
  };

  const motionDuration = (pattern: RevealPattern): gsap.TweenVars['duration'] => {
    if (pattern !== 'heading') return motion[pattern].duration;
    return (_index: number, target: Element) => {
      if (target.matches('h1, h2, h3, h4')) return motion.heading.duration;
      if (target.matches('a, button, [class*="actions"]')) return motion.cta.duration;
      return motion.text.duration;
    };
  };

  const restoreTransition = (target: HTMLElement): void => {
    const transition = managedTransitions.get(target);
    if (transition?.value) target.style.setProperty('transition', transition.value, transition.priority);
    else target.style.removeProperty('transition');
    managedTransitions.delete(target);
  };

  const reveal = (
    rawTargets: Iterable<Element>,
    trigger: HTMLElement,
    pattern: RevealPattern = 'text',
    itemStagger = 0,
    customDuration?: number,
  ): void => {
    const targets = uniqueElements(rawTargets).filter(visibleElement).filter((target) => !prepared.has(target));
    if (!targets.length || !visibleElement(trigger)) return;
    targets.forEach((target) => {
      prepared.add(target);
      target.setAttribute(ROOT_ATTRIBUTE, 'pending');
      managedTransitions.set(target, {
        value: target.style.getPropertyValue('transition'),
        priority: target.style.getPropertyPriority('transition'),
      });
      target.style.setProperty('transition', 'none', 'important');
    });

    const rect = trigger.getBoundingClientRect();
    if (rect.bottom <= 0) {
      targets.forEach((target) => {
        target.setAttribute(ROOT_ATTRIBUTE, 'complete');
        restoreTransition(target);
      });
      return;
    }

    const aboveFold = rect.top < window.innerHeight * 0.96;
    const preset = motion[pattern];
    gsap.set(targets, {
      autoAlpha: 0,
      ...motionVars(pattern),
      willChange: 'transform,opacity',
    });
    let tween: gsap.core.Tween;
    let finalized = false;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      completed += targets.length;
      debugState.completed = completed;
      targets.forEach((target) => {
        target.setAttribute(ROOT_ATTRIBUTE, 'complete');
        restoreTransition(target);
      });
      gsap.set(targets, { clearProps: 'opacity,visibility,transform,willChange' });
    };
    const vars: gsap.TweenVars = {
      autoAlpha: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: customDuration ?? motionDuration(pattern),
      stagger: itemStagger,
      ease: preset.ease,
      overwrite: 'auto',
      lazy: false,
      onStart: () => targets.forEach((target) => target.setAttribute(ROOT_ATTRIBUTE, 'active')),
      onComplete: finalize,
      /* If another FULL animation or a very fast scroll interrupts this tween,
         progressive enhancement wins: leave the content fully visible. */
      onInterrupt: finalize,
    };

    if (aboveFold) {
      tween = gsap.to(targets, vars);
    } else {
      tween = gsap.to(targets, {
        ...vars,
        scrollTrigger: {
          trigger,
          start,
          once: true,
          fastScrollEnd: true,
          invalidateOnRefresh: true,
          onLeave: (self) => self.animation?.progress(1),
          onRefresh: (self) => {
            /* A restored/deep scroll may place the trigger above the viewport
               before its first refresh. Never leave that content hidden. */
            if (self.end < window.scrollY && !self.isActive) self.animation?.progress(1);
          },
        },
      });
      if (tween.scrollTrigger) ownedTriggers.push(tween.scrollTrigger);
    }

    tweens.push(tween);
    debugState.tweenCount = tweens.length;
    debugState.triggerCount = ownedTriggers.length;
  };

  const revealGroup = (
    container: HTMLElement,
    targets: Iterable<Element>,
    pattern: RevealPattern = 'cards',
    groupStagger = stagger,
  ): void => reveal(targets, container, pattern, groupStagger);

  const revealEach = (
    elements: Iterable<Element>,
    pattern: RevealPattern = 'text',
    triggerSelector?: string,
  ): void => {
    uniqueElements(elements).forEach((element, index) => {
      const trigger = triggerSelector
        ? element.closest<HTMLElement>(triggerSelector) ?? element
        : element;
      const resolvedPattern = pattern === 'media-left' && index % 2 ? 'media-right' : pattern;
      reveal([element], trigger, resolvedPattern);
    });
  };

  const initInteriorPage = (page: HTMLElement): void => {
    const hero = page.querySelector<HTMLElement>('section[class*="-hero"]');
    if (hero) {
      /* Some secondary heroes predate this system and animate their outer
         cloud/visual with CSS. In FULL, let GSAP own the entrance so parent
         and child transforms never compound. Other tiers never run this. */
      for (const surface of hero.querySelectorAll<HTMLElement>(
        '[class$="-hero__cloud"], [class$="-hero__visual"]',
      )) {
        if (getComputedStyle(surface).animationName === 'none') continue;
        legacyHeroAnimations.set(surface, {
          value: surface.style.getPropertyValue('animation'),
          priority: surface.style.getPropertyPriority('animation'),
        });
        surface.style.setProperty('animation', 'none', 'important');
      }

      const copy = hero.querySelector<HTMLElement>('[class$="-hero__copy"]');
      if (copy) revealGroup(copy, directChildren(copy), 'heading', headingStagger);
      const heroImage = hero.querySelector<HTMLElement>('[class$="-hero__visual"] img');
      if (heroImage) reveal([heroImage], heroImage, 'media-right');
    }

    const sections = Array.from(page.querySelectorAll<HTMLElement>('section')).filter(
      (section) => section !== hero,
    );

    for (const section of sections) {
      const heading = section.querySelector<HTMLElement>(
        'header, [class$="-heading"], [class$="__heading"]',
      );
      if (heading && !heading.closest('article, li')) {
        reveal(directChildren(heading), section, 'heading', headingStagger);
      }

      const groupContainers = uniqueElements(
        section.querySelectorAll<HTMLElement>(
          '[class$="__grid"], [class$="__metrics"], [class$="__stages"], [class$="__steps"]',
        ),
      );
      for (const group of groupContainers) {
        const items = directChildren(group).filter((item) => item.matches('article, li'));
        if (items.length) revealGroup(group, items, 'cards');
      }

      const standaloneMedia = uniqueElements(
        section.querySelectorAll<HTMLElement>('picture img, figure > img'),
      ).filter((media) => !media.closest('article, li') && !media.closest('[class*="-hero"]'));
      standaloneMedia.forEach((media, index) => {
        reveal([media], section, index % 2 ? 'media-right' : 'media-left');
      });

      const supportingBlocks = uniqueElements(
        section.querySelectorAll<HTMLElement>(
          '[class$="__offer"], [class$="__notice"], [class$="__note"], [class$="__more"], [class$="__story"], [class$="__actions"], [class$="__copy"]',
        ),
      ).filter(
        (block) => !block.closest('article, li') && block !== heading && !block.closest('[class*="-hero"]'),
      );
      supportingBlocks.forEach((block) => reveal([block], section, 'text'));

      for (const aside of Array.from(section.querySelectorAll<HTMLElement>('aside'))) {
        if (!aside.closest('article, li') && !prepared.has(aside)) reveal([aside], aside, 'cards');
      }

      if (section.className.includes('final') || section.className.includes('cta')) {
        const finalChildren = directChildren(section).filter(
          (child) => !child.matches('[aria-hidden="true"]'),
        );
        revealGroup(section, finalChildren, 'cta', mobile ? 0.055 : tablet ? 0.07 : 0.08);
      }
    }

    const servicesMap = page.querySelector<HTMLElement>('.services-system__map');
    if (servicesMap) {
      revealGroup(
        servicesMap,
        servicesMap.querySelectorAll('.services-system__node, .services-system__center'),
        'cards',
      );
    }
  };

  const initHomeAfterHero = (): void => {
    const caseSection = document.querySelector<HTMLElement>('[data-case-study]');
    if (caseSection) {
      const copy = caseSection.querySelector<HTMLElement>('.case__copy');
      if (copy) reveal(directChildren(copy), caseSection, 'heading', headingStagger);
      revealEach(caseSection.querySelectorAll('.case__showcase'), 'media-right');
      const metrics = caseSection.querySelector<HTMLElement>('.case-metrics');
      if (metrics) revealGroup(metrics, metrics.querySelectorAll('.case-metric'), 'cards');
      revealEach(caseSection.querySelectorAll('.case-testimonial'), 'cards');
    }

    const howSection = document.querySelector<HTMLElement>('[data-how-we-work]');
    if (howSection) {
      const copy = howSection.querySelector<HTMLElement>('.how__copy');
      if (copy) reveal(directChildren(copy), howSection, 'heading', headingStagger);
      revealEach(howSection.querySelectorAll('.how-step__card'), 'cards', '.how-step');
      revealEach(howSection.querySelectorAll('.how-step__asset img'), 'media-right', '.how-step');

      const route = howSection.querySelector<HTMLElement>('.how__process');
      const routeLines = route
        ? Array.from(route.querySelectorAll<SVGElement>(
            '.how-route__halo, .how-route__line, .how-route__bridge-halo, .how-route__bridge',
          )).filter((line) => getComputedStyle(line).display !== 'none')
        : [];
      if (route && routeLines.length && route.getBoundingClientRect().top >= window.innerHeight * 0.96) {
        const lineTween = gsap.fromTo(
          routeLines,
          { strokeDasharray: 1, strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            duration: mobile ? 0.8 : tablet ? 0.9 : 1,
            ease: 'power2.out',
            stagger: 0.025,
            scrollTrigger: { trigger: route, start, once: true },
            onComplete: () => gsap.set(routeLines, { clearProps: 'strokeDasharray,strokeDashoffset' }),
          },
        );
        tweens.push(lineTween);
        if (lineTween.scrollTrigger) ownedTriggers.push(lineTween.scrollTrigger);
      }
    }

    const mirador = document.querySelector<HTMLElement>('[data-mirador]');
    if (mirador) {
      const copy = mirador.querySelector<HTMLElement>('[data-mirador-copy]');
      if (copy) reveal(directChildren(copy), mirador, 'heading', headingStagger);
      revealEach(mirador.querySelectorAll('.mirador__cta, .mirador__mobile-actions'), 'cta');
      revealEach(mirador.querySelectorAll('[data-mirador-scene] img'), 'media-right');
    }
  };

  const page = document.querySelector<HTMLElement>(
    'main.services-page, main.web-page, main.marketing-page, main.software-page, main.branding-page, main.contact-page, main.dz-page',
  );
  if (page) initInteriorPage(page);
  else initHomeAfterHero();

  const scheduleRefresh = (): void => {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      ScrollTrigger.refresh();
    });
  };
  if (document.fonts?.ready) void document.fonts.ready.then(scheduleRefresh);
  window.addEventListener('load', scheduleRefresh, { once: true });

  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) cleanup();
  };

  const cleanup = (): void => {
    window.removeEventListener('load', scheduleRefresh);
    window.removeEventListener('pagehide', onPageHide);
    if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
    ownedTriggers.forEach((trigger) => trigger.kill(false));
    tweens.forEach((tween) => tween.kill());
    prepared.forEach((element) => {
      element.removeAttribute(ROOT_ATTRIBUTE);
      gsap.set(element, { clearProps: 'opacity,visibility,transform,willChange' });
      restoreTransition(element);
    });
    managedTransitions.clear();
    legacyHeroAnimations.forEach(({ value, priority }, element) => {
      if (value) element.style.setProperty('animation', value, priority);
      else element.style.removeProperty('animation');
    });
    document.documentElement.removeAttribute('data-full-reveals');
    delete window.__ALTARIA_FULL_REVEALS__;
  };

  debugState.cleanup = cleanup;
  debugState.tweenCount = tweens.length;
  debugState.triggerCount = ownedTriggers.length;
  window.addEventListener('pagehide', onPageHide);
  scheduleRefresh();
  return cleanup;
}
