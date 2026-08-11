import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { beatsFull } from '../data/hero';
import type { HeroTierRuntimeContext } from './hero-tier-bootstrap';

gsap.registerPlugin(ScrollTrigger);

type AdaptiveTier = 'balanced' | 'lite';

interface TierMotionConfig {
  scrub: number | true;
  copyDistance: number;
  entryDistance: number;
  entryScale: number;
}

const MOTION: Record<AdaptiveTier, TierMotionConfig> = {
  balanced: {
    scrub: 0.48,
    copyDistance: 24,
    entryDistance: 52,
    entryScale: 0.78,
  },
  lite: {
    scrub: true,
    copyDistance: 14,
    entryDistance: 30,
    entryScale: 0.9,
  },
};

const COPY_WINDOWS = {
  social: [0.079, 0.177],
  web: [0.184, 0.657],
  software: [0.665, 0.758],
  brand: [0.766, 0.849],
  growth: [0.857, 0.963],
} as const;

const q = <T extends Element>(root: ParentNode, selector: string): T | null =>
  root.querySelector<T>(selector);

const qa = <T extends Element>(root: ParentNode, selector: string): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

const vw = (value: number): number => (window.innerWidth * value) / 100;
const vh = (value: number): number => (window.innerHeight * value) / 100;

function currentBeat(progress: number): (typeof beatsFull)[number] {
  return beatsFull.find((beat) => progress < beat.to) ?? beatsFull[beatsFull.length - 1];
}

function setInert(element: HTMLElement | null, inert: boolean): void {
  if (!element) return;
  element.inert = inert;
}

function setTabletInteractive(tablet: HTMLElement | null, active: boolean): void {
  if (!tablet) return;
  tablet.inert = !active;
  for (const swatch of qa<HTMLButtonElement>(tablet, '[data-perf-brand-swatch]')) {
    swatch.tabIndex = active ? 0 : -1;
  }
}

function setMiniwebAccessibility(root: HTMLElement, progress: number): void {
  const active = progress < 0.36 ? 'impact' : progress < 0.505 ? 'benefits' : 'results';
  const balanced = root.dataset.performanceTier === 'balanced';
  const selector = balanced ? '[data-web-scene]' : '[data-perf-web-scene]';
  for (const scene of qa<HTMLElement>(root, selector)) {
    const id = balanced ? scene.dataset.webScene : scene.dataset.perfWebScene;
    const current = id === active;
    scene.classList.toggle('is-current', current);
    scene.setAttribute('aria-hidden', String(!current));
  }
}

const EASTER_WINDOWS: Record<string, readonly [number, number]> = {
  'birds-a': [0.09, 0.154],
  plane: [0.3, 0.375],
  'birds-b': [0.575, 0.64],
  rocket: [0.77, 0.846],
};

function setEasterPointerWindows(root: HTMLElement, progress: number): void {
  for (const event of qa<HTMLElement>(root, '[data-perf-easter]:not([data-perf-easter="sun"])')) {
    const id = event.dataset.perfEaster ?? '';
    const window = EASTER_WINDOWS[id];
    event.style.pointerEvents = window && progress >= window[0] && progress < window[1]
      ? 'auto'
      : 'none';
  }
}

interface AdaptiveReel {
  update(progress: number): void;
  dispose(): void;
}

function initialiseBalancedReel(root: HTMLElement, tier: AdaptiveTier): AdaptiveReel {
  const video = q<HTMLVideoElement>(root, '[data-perf-reel]');
  if (!video) return { update: () => {}, dispose: () => {} };

  const deterministic = new URLSearchParams(window.location.search).get('still') === '1';
  let prepared = false;
  let progress = 0;

  const prepare = (): void => {
    if (prepared) return;
    prepared = true;
    video.preload = 'auto';
    video.load();
  };

  const sync = (): void => {
    const nearBeat = progress >= 0.065 && progress < 0.18;
    if (nearBeat) prepare();
    const shouldPlay =
      !deterministic &&
      !document.hidden &&
      progress >= 0.082 &&
      progress < 0.164;

    if (shouldPlay && video.paused) {
      void video.play().catch(() => {
        /* The poster remains a complete fallback if autoplay is denied. */
      });
    } else if (!shouldPlay && !video.paused) {
      video.pause();
    }
  };

  const onVisibility = (): void => sync();
  document.addEventListener('visibilitychange', onVisibility);

  return {
    update(nextProgress: number): void {
      progress = nextProgress;
      sync();
    },
    dispose(): void {
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
      video.preload = 'none';
    },
  };
}

interface AdaptiveFlowAsset {
  update(progress: number): void;
}

function initialiseBalancedFlowAsset(root: HTMLElement, tier: AdaptiveTier): AdaptiveFlowAsset {
  const image = q<HTMLImageElement>(root, '[data-perf-flow-image]');
  if (!image) return { update: () => {} };

  let loaded = false;
  const load = (): void => {
    if (loaded) return;
    const source = image.dataset.src;
    if (!source) return;
    loaded = true;
    image.src = source;
    image.removeAttribute('data-src');
  };

  return {
    update(progress: number): void {
      if (progress >= 0.81) load();
    },
  };
}

function initialiseEasterEggs(root: HTMLElement, tier: AdaptiveTier): () => void {
  const stage = q<HTMLElement>(root, '[data-performance-stage]');
  const sun = q<HTMLElement>(root, '[data-perf-easter="sun"]');
  const sunMessage = q<HTMLElement>(root, '[data-perf-sun-message]');
  const sunIntro = q<HTMLElement>(root, '[data-perf-sun-intro]');
  const sunLine = q<HTMLElement>(root, '[data-perf-sun-line]');
  const sunBubble = q<HTMLElement>(root, '[data-perf-sun-bubble]');
  const reaction = q<HTMLElement>(root, '[data-perf-reaction]');
  const disposers: Array<() => void> = [];
  const timeouts = new Set<number>();
  const sunAnimations = new Set<Animation>();
  let balancedTold = false;
  let balancedClicks = 0;
  let balancedClosing = false;
  let sunScrollOrigin = 0;

  const later = (callback: () => void, delay: number): void => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      callback();
    }, delay);
    timeouts.add(id);
  };

  const animate = (
    element: HTMLElement | null,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ): Animation | null => {
    if (!element) return null;
    const animation = element.animate(keyframes, options);
    sunAnimations.add(animation);
    animation.finished.catch(() => {}).finally(() => sunAnimations.delete(animation));
    return animation;
  };

  const pulseBalancedSun = (): void => {
    animate(
      sun,
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.2)', offset: 0.28 },
        { transform: 'scale(1.06)', offset: 0.58 },
        { transform: 'scale(1)' },
      ],
      { duration: 760, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
  };

  const closeBalancedSignature = (): void => {
    if (!sunMessage || sunMessage.hidden || balancedClosing) return;
    balancedClosing = true;
    window.removeEventListener('scroll', onBalancedSunScroll);

    const introOpacity = sunIntro
      ? Number.parseFloat(getComputedStyle(sunIntro).opacity) || 0
      : 0;
    const lineOpacity = sunLine
      ? Number.parseFloat(getComputedStyle(sunLine).opacity) || 0
      : 0;
    for (const animation of sunAnimations) animation.cancel();
    sunAnimations.clear();

    /* Keep the special sky fully opaque while its copy leaves. Otherwise
       the normal hero copy becomes visible through the same fade and both
       messages overlap for a few frames. */
    sunMessage.style.opacity = '1';
    animate(
      sunIntro,
      [{ opacity: introOpacity }, { opacity: 0 }],
      { duration: 190, easing: 'ease-in', fill: 'forwards' }
    );
    animate(
      sunLine,
      [{ opacity: lineOpacity }, { opacity: 0 }],
      { duration: 190, easing: 'ease-in', fill: 'forwards' }
    );

    later(() => {
      const finish = (): void => {
        sunMessage.hidden = true;
        sunMessage.style.removeProperty('opacity');
        for (const element of [sunMessage, sunIntro, sunLine]) {
          for (const animation of element?.getAnimations() ?? []) animation.cancel();
        }
        stage?.removeAttribute('data-perf-sun-open');
        balancedClosing = false;
      };
      const exit = animate(
        sunMessage,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 330, easing: 'ease-in', fill: 'forwards' }
      );
      if (exit) exit.onfinish = finish;
      else finish();
    }, 210);
  };

  const onBalancedSunScroll = (): void => {
    if (Math.abs(window.scrollY - sunScrollOrigin) >= 140) closeBalancedSignature();
  };

  const showBalancedSignature = (): void => {
    if (!sunMessage) return;
    balancedClosing = false;
    sunMessage.hidden = false;
    sunMessage.style.removeProperty('opacity');
    stage?.setAttribute('data-perf-sun-open', '1');
    sunScrollOrigin = window.scrollY;
    window.addEventListener('scroll', onBalancedSunScroll, { passive: true });

    animate(
      sunMessage,
      [
        { opacity: 0 },
        { opacity: 1 },
      ],
      { duration: tier === 'lite' ? 420 : 520, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
    );
    animate(
      sunIntro,
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: tier === 'lite' ? 440 : 540, delay: tier === 'lite' ? 260 : 360, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }
    );
    animate(
      sunLine,
      [
        { opacity: 0, transform: 'translateY(22px) scale(1.035)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: tier === 'lite' ? 650 : 820, delay: tier === 'lite' ? 420 : 560, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }
    );
    later(closeBalancedSignature, tier === 'lite' ? 5200 : 6200);
  };

  const showBalancedBubble = (): void => {
    if (!sunBubble) return;
    sunBubble.hidden = false;
    animate(
      sunBubble,
      [
        { opacity: 0, transform: 'translateY(-6px) scale(.9)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.25 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.76 },
        { opacity: 0, transform: 'translateY(4px) scale(.97)' },
      ],
      { duration: 2300, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
    later(() => {
      sunBubble.hidden = true;
    }, 2320);
  };

  if (sun && sunMessage) {
    const onSun = (): void => {
      balancedClicks += 1;
      pulseBalancedSun();
      if (!balancedTold) {
        balancedTold = true;
        showBalancedSignature();
        return;
      }
      if (balancedClicks >= 3) showBalancedBubble();
    };
    sun.addEventListener('click', onSun);
    disposers.push(() => sun.removeEventListener('click', onSun));
  }

  for (const event of qa<HTMLElement>(root, '[data-perf-easter]:not([data-perf-easter="sun"])')) {
    const onEvent = (pointer: PointerEvent): void => {
      if (!reaction) return;
      const rect = root.getBoundingClientRect();
      reaction.style.setProperty('--reaction-x', `${pointer.clientX - rect.left}px`);
      reaction.style.setProperty('--reaction-y', `${pointer.clientY - rect.top}px`);
      reaction.hidden = false;
      reaction.animate(
        [
          { opacity: 0.9, transform: 'translate(-50%, -50%) scale(.35)' },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.8)' },
        ],
        { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
      later(() => {
        reaction.hidden = true;
      }, 640);
    };
    event.addEventListener('pointerup', onEvent);
    disposers.push(() => event.removeEventListener('pointerup', onEvent));
  }

  return () => {
    for (const dispose of disposers) dispose();
    for (const id of timeouts) window.clearTimeout(id);
    timeouts.clear();
    for (const animation of sunAnimations) animation.cancel();
    sunAnimations.clear();
    window.removeEventListener('scroll', onBalancedSunScroll);
    if (sunMessage) sunMessage.hidden = true;
    if (sunMessage) sunMessage.style.removeProperty('opacity');
    if (sunBubble) sunBubble.hidden = true;
    if (reaction) reaction.hidden = true;
    stage?.removeAttribute('data-perf-sun-open');
  };
}

function initialiseReduced(
  root: HTMLElement,
  stage: HTMLElement,
  header: HTMLElement | null
): () => void {
  const tier = root.dataset.performanceTier;
  const copies = qa<HTMLElement>(root, '[data-perf-copy]');
  const objects = qa<HTMLElement>(root, '[data-perf-object]');
  const flow = q<HTMLElement>(root, '[data-perf-object="flow"]');
  const tablet = q<HTMLElement>(root, '[data-perf-object="tablet"]');
  const scenes = qa<HTMLElement>(
    root,
    root.dataset.performanceTier === 'balanced' ? '[data-web-scene]' : '[data-perf-web-scene]'
  );

  gsap.set(q(root, '[data-perf-intro]'), { autoAlpha: 0 });
  gsap.set(copies, { autoAlpha: 0 });
  gsap.set(q(root, '[data-perf-copy="growth"]'), { autoAlpha: 1, x: 0, y: 0 });
  gsap.set(objects, { autoAlpha: 0 });
  gsap.set(flow, { autoAlpha: 1, x: 0, y: 0, scale: 1 });
  const flowImage = q<HTMLImageElement>(root, '[data-perf-flow-image]');
  if (flowImage?.dataset.src) {
    flowImage.src = flowImage.dataset.src;
    flowImage.removeAttribute('data-src');
  }
  gsap.set(scenes, { autoAlpha: 0, y: 0 });
  gsap.set(
    q(root, root.dataset.performanceTier === 'balanced'
      ? '[data-web-scene="results"]'
      : '[data-perf-web-scene="results"]'),
    { autoAlpha: 1 }
  );
  setMiniwebAccessibility(root, 0.59);
  gsap.set(q(root, '[data-perf-brand-cloud]'), { autoAlpha: 0 });
  gsap.set(q(root, '[data-perf-brand-logo]'), { autoAlpha: 1 });
  if (header) gsap.set(header, { autoAlpha: 1, y: 0, scale: 1 });
  setInert(flow, false);
  setTabletInteractive(tablet, false);

  const trigger = ScrollTrigger.create({
    trigger: root,
    start: 'top top',
    end: 'bottom bottom',
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      const beat = currentBeat(self.progress);
      stage.dataset.beat = String(beat.n);
      root.dataset.performanceBeat = beat.id;
    },
  });

  return () => {
    trigger.kill();
    setInert(flow, true);
    setTabletInteractive(tablet, false);
  };
}

function addCopy(
  timeline: gsap.core.Timeline,
  element: HTMLElement | null,
  from: number,
  to: number,
  config: TierMotionConfig
): void {
  if (!element) return;
  const enterDuration = Math.min(0.016, (to - from) * 0.16);
  const exitDuration = Math.min(0.014, (to - from) * 0.14);
  timeline.fromTo(
    element,
    { autoAlpha: 0, x: -config.copyDistance, y: 9 },
    {
      autoAlpha: 1,
      x: 0,
      y: 0,
      duration: enterDuration,
      ease: 'power2.out',
      immediateRender: false,
    },
    from
  );
  timeline.to(
    element,
    { autoAlpha: 0, x: -config.copyDistance * 0.45, y: -5, duration: exitDuration, ease: 'power1.in' },
    Math.max(from + enterDuration, to - exitDuration)
  );
}

function addDevice(
  timeline: gsap.core.Timeline,
  element: HTMLElement | null,
  from: number,
  settled: number,
  exitAt: number,
  exit: { x: number; y: number; scale: number; rotation?: number },
  config: TierMotionConfig,
  entryRotation: number,
  leavesStage = false
): void {
  if (!element) return;
  timeline.fromTo(
    element,
    {
      autoAlpha: 0,
      x: () => vw(config.entryDistance / 2),
      y: () => vh(config.entryDistance / 4),
      scale: config.entryScale,
      rotation: entryRotation,
    },
    {
      autoAlpha: 1,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      duration: settled - from,
      ease: 'power2.out',
      immediateRender: false,
    },
    from
  );
  timeline.to(
    element,
    {
      autoAlpha: leavesStage ? 0 : 0.82,
      x: () => vw(exit.x),
      y: () => vh(exit.y),
      scale: exit.scale,
      rotation: exit.rotation ?? 0,
      duration: leavesStage ? 0.022 : 0.018,
      ease: 'power2.inOut',
    },
    exitAt
  );
}

function buildMotionTimeline(
  root: HTMLElement,
  stage: HTMLElement,
  tier: AdaptiveTier,
  header: HTMLElement | null
): { timeline: gsap.core.Timeline; dispose(): void } {
  const config = MOTION[tier];
  const timeline = gsap.timeline({ paused: true, defaults: { overwrite: 'auto' } });
  const marker = { progress: 0 };
  const intro = q<HTMLElement>(root, '[data-perf-intro]');
  const introLines = qa<HTMLElement>(root, '[data-perf-intro-line]');
  const introCue = q<HTMLElement>(root, '[data-perf-intro-cue]');
  const phone = q<HTMLElement>(root, '[data-perf-object="phone"]');
  const laptop = q<HTMLElement>(root, '[data-perf-object="laptop"]');
  const monitor = q<HTMLElement>(root, '[data-perf-object="monitor"]');
  const tablet = q<HTMLElement>(root, '[data-perf-object="tablet"]');
  const flow = q<HTMLElement>(root, '[data-perf-object="flow"]');
  const allObjects = qa<HTMLElement>(root, '[data-perf-object]');
  const allCopies = qa<HTMLElement>(root, '[data-perf-copy]');
  const webScenePrefix = tier === 'balanced' ? 'data-web-scene' : 'data-perf-web-scene';
  const webScenes = qa<HTMLElement>(root, `[${webScenePrefix}]`);
  const cloudLogo = q<HTMLElement>(root, '[data-perf-brand-cloud]');
  const completeLogo = q<HTMLElement>(root, '[data-perf-brand-logo]');
  const cloudBank = q<HTMLElement>(root, '[data-perf-clouds]');
  const reel = initialiseBalancedReel(root, tier);
  const flowAsset = initialiseBalancedFlowAsset(root, tier);

  gsap.set(allObjects, { autoAlpha: 0, transformOrigin: '50% 50%' });
  gsap.set(allCopies, { autoAlpha: 0 });
  gsap.set(webScenes, { autoAlpha: 0, y: tier === 'balanced' ? 10 : 5 });
  gsap.set(header, { autoAlpha: 0, y: -52, scale: 0.97 });
  gsap.set(intro, { autoAlpha: 1 });
  gsap.set(introLines, { autoAlpha: 1, y: 0, scale: 1 });
  gsap.set(introCue, { autoAlpha: 1, y: 0 });
  gsap.set(cloudLogo, { autoAlpha: 1, scale: 1 });
  gsap.set(completeLogo, { autoAlpha: 0, scale: 0.9 });

  /* Keeps the master duration normalised to exactly one even when a later
     visual cue is shortened. This tween does not touch the DOM. */
  timeline.to(marker, { progress: 1, duration: 1, ease: 'none' }, 0);

  /* One shared cloud surface supplies reversible environmental parallax.
     It replaces every permanent drift/blur loop from Full and becomes
     completely idle as soon as scroll stops. */
  if (cloudBank) {
    timeline.fromTo(
      cloudBank,
      { y: 0, x: 0 },
      {
        y: () => -vh(tier === 'balanced' ? 4.5 : 2.5),
        x: () => vw(tier === 'balanced' ? 1.4 : 0.7),
        duration: 1,
        ease: 'none',
        immediateRender: false,
      },
      0
    );
  }

  timeline.to(introLines, {
    autoAlpha: 0,
    y: tier === 'balanced' ? -22 : -12,
    scale: tier === 'balanced' ? 1.025 : 1.01,
    duration: 0.028,
    stagger: 0.002,
    ease: 'power2.in',
  }, 0.036);
  timeline.to(introCue, { autoAlpha: 0, y: -7, duration: 0.016, ease: 'power1.in' }, 0.032);
  timeline.to(intro, { autoAlpha: 0, duration: 0.014 }, 0.061);
  timeline.to(header, { autoAlpha: 1, y: 0, scale: 1, duration: 0.02, ease: 'power2.out' }, 0.049);

  for (const [id, [from, to]] of Object.entries(COPY_WINDOWS)) {
    addCopy(timeline, q(root, `[data-perf-copy="${id}"]`), from, to, config);
  }

  if (tier === 'balanced') {
    /* Balanced tells the approved one-device-at-a-time story. Each exit is
       a reversible transform/opacity flight, never a display toggle or a
       persistent corner stack. */
    addDevice(timeline, phone, 0.082, 0.113, 0.164, { x: 30, y: -9, scale: 0.72, rotation: 5 }, config, 8, true);
    addDevice(timeline, laptop, 0.187, 0.224, 0.641, { x: 34, y: -5, scale: 0.78, rotation: 2 }, config, 4, true);
    addDevice(timeline, monitor, 0.671, 0.699, 0.744, { x: 31, y: -4, scale: 0.8, rotation: 3 }, config, 5, true);
    addDevice(timeline, tablet, 0.772, 0.798, 0.837, { x: 30, y: 4, scale: 0.82, rotation: -3 }, config, -4, true);
  } else {
    /* Lite preserves the one-device-at-a-time narrative with shorter,
       cheaper transform/opacity exits and no persistent corner stack. */
    addDevice(timeline, phone, 0.082, 0.113, 0.164, { x: 24, y: -7, scale: 0.78, rotation: 3 }, config, 8, true);
    addDevice(timeline, laptop, 0.187, 0.224, 0.641, { x: 28, y: -4, scale: 0.82, rotation: 2 }, config, 4, true);
    addDevice(timeline, monitor, 0.671, 0.699, 0.744, { x: 27, y: -3, scale: 0.84, rotation: 2 }, config, 5, true);
    addDevice(timeline, tablet, 0.772, 0.798, 0.837, { x: 26, y: 3, scale: 0.85, rotation: -2 }, config, -4, true);
  }

  const laptopLid = q<HTMLElement>(root, '.perf-laptop__lid');
  const laptopBase = q<HTMLElement>(root, '.perf-laptop__base');
  if (laptopLid) {
    timeline.fromTo(
      laptopLid,
      { scaleY: 0.12, transformOrigin: '50% 100%' },
      { scaleY: 1, duration: 0.032, ease: 'power2.out', immediateRender: false },
      0.191
    );
  }
  if (laptopBase) {
    timeline.fromTo(
      laptopBase,
      { autoAlpha: 0, scaleX: 0.86 },
      { autoAlpha: 1, scaleX: 1, duration: 0.022, ease: 'power1.out', immediateRender: false },
      0.207
    );
  }

  const impact = q<HTMLElement>(root, `[${webScenePrefix}="impact"]`);
  const benefits = q<HTMLElement>(root, `[${webScenePrefix}="benefits"]`);
  const results = q<HTMLElement>(root, `[${webScenePrefix}="results"]`);
  timeline.fromTo(impact, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.018, ease: 'power1.out', immediateRender: false }, 0.218);
  timeline.to(impact, { autoAlpha: 0, y: -7, duration: 0.014, ease: 'power1.in' }, 0.352);
  timeline.fromTo(benefits, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.018, ease: 'power1.out', immediateRender: false }, 0.359);
  timeline.to(benefits, { autoAlpha: 0, y: -7, duration: 0.014, ease: 'power1.in' }, 0.497);
  timeline.fromTo(results, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.018, ease: 'power1.out', immediateRender: false }, 0.504);
  timeline.to(results, { autoAlpha: 0, y: -7, duration: 0.014, ease: 'power1.in' }, 0.638);

  timeline.fromTo(
    qa(root, '[data-perf-web-pillar]'),
    { autoAlpha: 0, y: 5 },
    { autoAlpha: 1, y: 0, duration: 0.012, stagger: 0.003, ease: 'power1.out', immediateRender: false },
    0.236
  );
  timeline.fromTo(
    qa(root, '[data-perf-web-benefit]'),
    { autoAlpha: 0, y: 6 },
    { autoAlpha: 1, y: 0, duration: 0.012, stagger: 0.003, ease: 'power1.out', immediateRender: false },
    0.376
  );
  timeline.fromTo(
    qa(root, '[data-perf-web-result]'),
    { autoAlpha: 0, y: 5 },
    { autoAlpha: 1, y: 0, duration: 0.012, stagger: 0.003, ease: 'power1.out', immediateRender: false },
    0.521
  );

  timeline.to(cloudLogo, { autoAlpha: 0, scale: 0.86, duration: 0.016, ease: 'power1.in' }, 0.79);
  timeline.to(completeLogo, { autoAlpha: 1, scale: 1, duration: 0.022, ease: 'back.out(1.35)' }, 0.797);

  timeline.fromTo(
    flow,
    {
      autoAlpha: 0,
      x: () => vw(config.entryDistance / 3),
      y: () => vh(config.entryDistance / 7),
      scale: config.entryScale,
      rotation: tier === 'balanced' ? 3 : 1,
    },
    { autoAlpha: 1, x: 0, y: 0, scale: 1, rotation: 0, duration: 0.035, ease: 'power2.out', immediateRender: false },
    0.862
  );
  timeline.fromTo(
    qa(root, '[data-perf-flow-node]'),
    { autoAlpha: 0, y: 8, scale: 0.96 },
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.015, stagger: 0.004, ease: 'power1.out', immediateRender: false },
    0.872
  );

  const birdsA = q<HTMLElement>(root, '[data-perf-easter="birds-a"]');
  const plane = q<HTMLElement>(root, '[data-perf-easter="plane"]');
  const birdsB = q<HTMLElement>(root, '[data-perf-easter="birds-b"]');
  const rocket = q<HTMLElement>(root, '[data-perf-easter="rocket"]');
  timeline.fromTo(birdsA, { autoAlpha: 0, x: 0 }, { autoAlpha: 0.72, x: () => vw(17), duration: 0.045, ease: 'none', immediateRender: false }, 0.09);
  timeline.to(birdsA, { autoAlpha: 0, duration: 0.012 }, 0.142);
  timeline.fromTo(plane, { autoAlpha: 0.82, x: 0 }, { autoAlpha: 0.82, x: () => vw(116), duration: 0.07, ease: 'none', immediateRender: false }, 0.3);
  timeline.to(plane, { autoAlpha: 0, duration: 0.008 }, 0.367);
  timeline.fromTo(birdsB, { autoAlpha: 0, x: 0 }, { autoAlpha: 0.7, x: () => -vw(14), duration: 0.047, ease: 'none', immediateRender: false }, 0.575);
  timeline.to(birdsB, { autoAlpha: 0, duration: 0.01 }, 0.63);
  timeline.fromTo(rocket, { autoAlpha: 0.8, y: 0 }, { autoAlpha: 0.9, y: () => -vh(78), duration: 0.07, ease: 'power1.in', immediateRender: false }, 0.77);
  timeline.to(rocket, { autoAlpha: 0, duration: 0.008 }, 0.838);

  timeline.to([...allObjects, ...allCopies], { autoAlpha: 0, duration: 0.025, ease: 'power1.in' }, 0.968);

  const lag = new URLSearchParams(window.location.search).get('scrub') === '0' ? true : config.scrub;
  let lastBeat = '';
  let flowActive = false;
  let tabletActive = false;
  const trigger = ScrollTrigger.create({
    animation: timeline,
    trigger: root,
    start: 'top top',
    end: 'bottom bottom',
    scrub: lag,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      reel.update(self.progress);
      flowAsset.update(self.progress);
      const beat = currentBeat(self.progress);
      if (beat.id !== lastBeat) {
        lastBeat = beat.id;
        stage.dataset.beat = String(beat.n);
        root.dataset.performanceBeat = beat.id;
      }
      setMiniwebAccessibility(root, self.progress);
      setEasterPointerWindows(root, self.progress);
      const nextFlow = self.progress >= 0.852 && self.progress < 0.966;
      if (nextFlow !== flowActive) {
        flowActive = nextFlow;
        setInert(flow, !flowActive);
      }
      const nextTablet = self.progress >= 0.765 && self.progress < 0.852;
      if (nextTablet !== tabletActive) {
        tabletActive = nextTablet;
        setTabletInteractive(tablet, tabletActive);
      }
    },
  });

  if (Math.abs(timeline.totalDuration() - 1) > 0.000001) {
    console.warn(`[Altaria] Adaptive master timeline duration is ${timeline.totalDuration()}, expected 1.`);
  }

  return {
    timeline,
    dispose() {
      trigger.kill();
      timeline.kill();
      reel.dispose();
      setInert(flow, true);
      setTabletInteractive(tablet, false);
    },
  };
}

export function initPerformanceHeroTier(context: HeroTierRuntimeContext): void {
  const tier = context.tier;
  if (tier !== 'balanced' && tier !== 'lite') {
    throw new Error(`Adaptive runtime cannot initialise tier "${tier}".`);
  }

  const root = context.outlet.querySelector<HTMLElement>(
    `[data-performance-hero][data-performance-tier="${tier}"]`
  );
  const stage = root && q<HTMLElement>(root, '[data-performance-stage]');
  if (!root || !stage) throw new Error(`Adaptive ${tier} hero markup was not mounted.`);

  if (new URLSearchParams(window.location.search).get('still') === '1') {
    stage.dataset.still = '1';
  }

  const header = document.querySelector<HTMLElement>('[data-header-capsule]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const disposeEaster = initialiseEasterEggs(root, tier);
  const disposeMotion = reduced
    ? initialiseReduced(root, stage, header)
    : buildMotionTimeline(root, stage, tier, header).dispose;

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') gsap.ticker.sleep();
    else {
      gsap.ticker.wake();
      ScrollTrigger.update();
    }
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      gsap.ticker.wake();
      ScrollTrigger.refresh();
    }
  };
  const dispose = (): void => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    disposeEaster();
    disposeMotion();
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) dispose();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  if (document.visibilityState === 'hidden') onVisibility();
}
