/**
 * ALTARIA LIGHTS — hero choreography.
 *
 * ONE master GSAP timeline, scrubbed by ScrollTrigger against the hero
 * track. No scroll hijacking, no snap: the page scrolls normally and the
 * timeline follows.
 *
 * Coordinate convention: animated objects are positioned by their CENTRE
 * in viewport units, converted to px by vw()/vh(). Every tween value is a
 * function so `invalidateOnRefresh` re-evaluates it on resize — that is
 * what keeps 1440 / 1920 / 2560 on one codepath.
 *
 * Transform discipline: three nested wrappers per object, each owning
 * exactly one transform, so they can never fight.
 *   .obj → this timeline · .obj__float → idle drift · .obj__point → cursor
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { beats } from '../data/hero';

gsap.registerPlugin(ScrollTrigger);

const vw = (n: number): number => (window.innerWidth * n) / 100;
const vh = (n: number): number => (window.innerHeight * n) / 100;

const q = <T extends Element = HTMLElement>(s: string): T | null =>
  document.querySelector<T>(s);

const STAGE_OBJS = '[data-obj="phone"], [data-obj="laptop"], [data-obj="flow"]';

/* ------------------------------------------------------------------ *
 * Intro statement fit
 * ------------------------------------------------------------------ *
 * The statement must always be exactly two lines. Its copy lives in
 * data/hero.ts and can be rewritten at any time, so the type size has to
 * follow the copy instead of being hard-coded: measure the widest line at
 * the CSS ceiling size and scale down until it fits the container.
 */
function fitIntro(): void {
  const text = q<HTMLElement>('[data-intro-text]');
  if (!text) return;
  const lines = Array.from(text.querySelectorAll<HTMLElement>('[data-intro-line]'));
  if (lines.length === 0) return;

  let current = 1;
  const apply = (): void => {
    text.style.setProperty('--intro-fit', '1');
    const avail = text.clientWidth;
    const widest = Math.max(...lines.map((l) => l.scrollWidth));
    if (widest <= 0 || avail <= 0) {
      text.style.setProperty('--intro-fit', String(current));
      return;
    }
    // 0.995 keeps a hair of margin so sub-pixel rounding never wraps.
    const next = Math.min(1, (avail / widest) * 0.995);
    // Re-applying a value that is effectively identical still resizes the
    // block, and because the statement is centre-anchored that registers as
    // a layout shift. Only write a genuinely different fit.
    if (Math.abs(next - current) < 0.005) {
      text.style.setProperty('--intro-fit', String(current));
      return;
    }
    current = next;
    text.style.setProperty('--intro-fit', String(current));
  };

  apply();
  window.addEventListener('resize', apply, { passive: true });
  // Re-fit once webfonts land, since metrics change under the fallback.
  if ('fonts' in document) void (document as Document).fonts.ready.then(apply);
}

/* ------------------------------------------------------------------ *
 * Intro cue — appears ~1.5 s after load, never in the first frame
 * ------------------------------------------------------------------ */
function openingSequence(reduced: boolean): void {
  // The sun is painted at opacity 0 so it can bloom in rather than being
  // there in frame one. Without this it never becomes visible at all.
  gsap.to('[data-sky-sun]', {
    opacity: 1,
    duration: reduced ? 0 : 1.4,
    ease: 'power2.out',
  });

  if (reduced) return;

  // Statement lines rise out from under their own mask.
  gsap.from('[data-intro-line]', {
    yPercent: 108,
    duration: 1.15,
    stagger: 0.12,
    ease: 'power3.out',
  });

  // Discreet cue, never in the first frame.
  gsap.to('[data-intro-cue]', {
    opacity: 1,
    duration: 0.9,
    delay: 1.5,
    ease: 'power2.out',
  });
}

/* ------------------------------------------------------------------ *
 * Idle float + cursor parallax
 * ------------------------------------------------------------------ */
function idleFloat(): void {
  const spec: Array<[string, number, number, number]> = [
    ['[data-float="phone"]', 9, 0.7, 5.2],
    ['[data-float="laptop"]', 6, 0.4, 6.4],
    ['[data-float="flow"]', 7, 0.4, 5.8],
  ];
  for (const [sel, dy, rot, dur] of spec) {
    gsap.to(sel, {
      y: dy,
      rotation: rot,
      duration: dur,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }
}

function cursorParallax(): () => void {
  const targets: Array<[string, number, number]> = [
    ['[data-point="phone"]', 10, 2],
    ['[data-point="laptop"]', 6, 1],
  ];

  const setters = targets
    .map(([sel, px, deg]) => {
      const el = q(sel);
      if (!el) return null;
      return {
        x: gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power2.out' }),
        y: gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power2.out' }),
        ry: gsap.quickTo(el, 'rotationY', { duration: 0.7, ease: 'power2.out' }),
        px,
        deg,
      };
    })
    .filter(Boolean) as Array<{
    x: (v: number) => void;
    y: (v: number) => void;
    ry: (v: number) => void;
    px: number;
    deg: number;
  }>;

  // Suppressed while the user is scrolling quickly: it must never compete
  // with the scroll.
  let scrolling = false;
  let timer = 0;
  const onScroll = (): void => {
    scrolling = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      scrolling = false;
    }, 180);
  };
  const onMove = (e: MouseEvent): void => {
    if (scrolling) return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    for (const t of setters) {
      t.x(nx * t.px);
      t.y(ny * t.px * 0.6);
      t.ry(nx * t.deg);
    }
  };

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('scroll', onScroll);
  };
}

/* ------------------------------------------------------------------ *
 * Flow wires
 * ------------------------------------------------------------------ */
function prepareWires(): void {
  for (const path of document.querySelectorAll<SVGPathElement>('.flow__wire')) {
    const len = path.getTotalLength();
    path.style.setProperty('--len', String(len));
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
  }
}

/**
 * Spark travelling the whole route once.
 *
 * `total` MUST be expressed in master-timeline units. The master timeline
 * is normalised to a duration of exactly 1; a child left on GSAP's default
 * 0.5 s per tween would stretch the parent several times over and every
 * beat would render its end state.
 */
function sparkTween(total: number): gsap.core.Timeline {
  const spark = q<SVGCircleElement>('[data-flow-spark]');
  const wires = Array.from(document.querySelectorAll<SVGPathElement>('.flow__wire'));
  const tl = gsap.timeline();
  if (!spark || wires.length === 0) return tl;

  const per = total / wires.length;
  for (const wire of wires) {
    const len = wire.getTotalLength();
    const state = { t: 0 };
    // getPointAtLength avoids pulling in MotionPathPlugin for three curves.
    tl.to(state, {
      t: 1,
      duration: per,
      ease: 'none',
      onUpdate: () => {
        const p = wire.getPointAtLength(state.t * len);
        spark.setAttribute('cx', String(p.x));
        spark.setAttribute('cy', String(p.y));
      },
    });
  }
  return tl;
}

/* ------------------------------------------------------------------ *
 * Reel — plays only inside the social beat
 * ------------------------------------------------------------------ */
function reelController(): (beat: number) => void {
  const video = q<HTMLVideoElement>('[data-reel]');
  let loaded = false;
  return (beat: number): void => {
    if (!video) return;
    if (beat === 1) {
      if (!loaded) {
        video.preload = 'auto';
        video.load();
        loaded = true;
      }
      void video.play().catch(() => {
        /* autoplay refused — the poster stays, which is acceptable */
      });
    } else if (!video.paused) {
      video.pause();
    }
  };
}

/* ------------------------------------------------------------------ *
 * Master timeline
 * ------------------------------------------------------------------ */
function buildTimeline(onProgress: (p: number) => void): gsap.core.Timeline {
  const tl = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '[data-hero]',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.9,
      invalidateOnRefresh: true,
      onUpdate: (self) => onProgress(self.progress),
      onRefresh: (self) => onProgress(self.progress),
    },
  });

  gsap.set(STAGE_OBJS, { xPercent: -50, yPercent: -50 });

  /* ---------- INTRO STATEMENT · 0 – 22 % --------------------------- */
  // Not an opacity fade: the crisp copy lifts and thins while its blurred
  // twin swells and drifts, and an SVG turbulence displacement ramps up so
  // the letterforms actually break apart into the sky.
  tl.to('[data-intro-cue]', { opacity: 0, duration: 0.04 }, 0.07)
    .to(
      '[data-intro-line]',
      { y: () => vh(-3), duration: 0.07, ease: 'none', stagger: 0.012 },
      0.07
    )
    .to(
      '[data-intro-line]',
      { y: () => vh(-11), opacity: 0, duration: 0.08, stagger: 0.02, ease: 'power1.in' },
      0.14
    )
    .to(
      '.intro__vapour',
      {
        opacity: 0,
        scale: 1.16,
        filter: 'blur(46px)',
        duration: 0.09,
        stagger: 0.02,
        ease: 'power1.in',
      },
      0.13
    )
    .to('[data-vapour-map]', { attr: { scale: 46 }, duration: 0.09, ease: 'power2.in' }, 0.13)
    .to('[data-intro-text]', { opacity: 0, duration: 0.02 }, 0.21);

  /* ---------- HEADER · enters while the statement dissolves -------- */
  tl.to(
    '[data-header-capsule]',
    { opacity: 1, y: 0, scale: 1, duration: 0.07, ease: 'power3.out' },
    0.18
  );

  /* ---------- PHONE · social beat ---------------------------------- */
  tl.fromTo(
    '[data-obj="phone"]',
    {
      x: () => vw(114),
      y: () => vh(-20),
      scale: 0.6,
      rotationX: -8,
      rotationY: -22,
      rotation: 16,
      opacity: 0,
    },
    // x and y run on different eases → the path arcs instead of being a
    // straight line.
    { x: () => vw(72), duration: 0.14, ease: 'power1.inOut', opacity: 1 },
    0.24
  )
    .to(
      '[data-obj="phone"]',
      {
        y: () => vh(50),
        scale: 1,
        rotationX: 2,
        rotationY: -8,
        rotation: 2,
        duration: 0.15,
        ease: 'power3.out',
      },
      0.24
    )
    // steps back but stays as evidence of the previous beat
    .to(
      '[data-obj="phone"]',
      {
        x: () => vw(88),
        y: () => vh(30),
        scale: 0.5,
        rotationY: -12,
        opacity: 0.8,
        duration: 0.08,
        ease: 'power2.inOut',
      },
      0.44
    )
    .to(
      '[data-obj="phone"]',
      { x: () => vw(89), y: () => vh(27), scale: 0.42, opacity: 0.62, duration: 0.07 },
      0.7
    )
    .to('[data-obj="phone"]', { y: () => vh(10), opacity: 0, duration: 0.05 }, 0.95);

  /* ---------- LAPTOP · web beat ------------------------------------ */
  tl.fromTo(
    '[data-obj="laptop"]',
    {
      x: () => vw(58),
      y: () => vh(122),
      scale: 0.7,
      rotationX: 18,
      rotationY: 8,
      rotation: -2,
      opacity: 0,
    },
    {
      y: () => vh(58),
      scale: 1,
      rotationX: 2,
      rotationY: -4,
      rotation: 0,
      opacity: 1,
      duration: 0.14,
      ease: 'power3.out',
    },
    0.46
  )
    .to(
      '[data-obj="laptop"]',
      { x: () => vw(51), scale: 0.62, rotationY: -6, duration: 0.08, ease: 'power2.inOut' },
      0.7
    )
    .to('[data-obj="laptop"]', { y: () => vh(48), opacity: 0.85, duration: 0.05 }, 0.95);

  /* Slow scroll of the capture inside the lid, so the site is actually
     recognisable. Skipped while USR-01 is missing: the placeholder fills
     the bezel exactly, so scrolling it would only reveal black. */
  const track = q<HTMLElement>('[data-laptop-track]');
  if (track?.dataset.hasCapture === '1') {
    tl.fromTo(track, { yPercent: 0 }, { yPercent: -44, duration: 0.16, ease: 'none' }, 0.52).to(
      track,
      { yPercent: -20, duration: 0.05, ease: 'none' },
      0.69
    );
  }

  /* ---------- FLOW · growth beat ----------------------------------- */
  tl.fromTo(
    '[data-obj="flow"]',
    { x: () => vw(84), y: () => vh(62), scale: 0.92, opacity: 0 },
    { x: () => vw(80), y: () => vh(56), scale: 1, opacity: 1, duration: 0.05 },
    0.72
  ).to('[data-obj="flow"]', { y: () => vh(46), opacity: 0.9, duration: 0.05 }, 0.95);

  // Nodes enter in order, ~110 ms of visual separation each.
  ['creatividad', 'visita', 'web', 'reserva'].forEach((id, i) => {
    tl.fromTo(
      `[data-flow-node="${id}"]`,
      { opacity: 0, y: 16, scale: 0.94 },
      { opacity: 1, y: 0, scale: 1, duration: 0.03 },
      0.735 + i * 0.026
    );
  });

  // Wires draw between the nodes they connect.
  [1, 2, 3].forEach((n, i) => {
    tl.to(`[data-wire="${n}"]`, { strokeDashoffset: 0, duration: 0.026, ease: 'none' }, 0.75 + i * 0.026);
  });

  // The spark runs the route exactly once, then rests.
  tl.to('[data-flow-spark]', { opacity: 1, duration: 0.004 }, 0.845)
    .add(sparkTween(0.04), 0.85)
    .to('[data-flow-spark]', { opacity: 0, duration: 0.008 }, 0.89);

  /* ---------- BEAT COPY -------------------------------------------- */
  const copyAt: Array<[string, number, number]> = [
    ['social', 0.29, 0.43],
    ['web', 0.52, 0.69],
    ['growth', 0.76, 0.93],
  ];
  for (const [id, tIn, tOut] of copyAt) {
    tl.set(`[data-beat-copy="${id}"]`, { opacity: 1 }, tIn)
      .fromTo(
        `[data-beat-copy="${id}"] [data-beat-line]`,
        { yPercent: 110 },
        { yPercent: 0, duration: 0.035, stagger: 0.014, ease: 'power3.out' },
        tIn
      )
      .fromTo(
        `[data-beat-copy="${id}"] [data-beat-sub]`,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.03 },
        tIn + 0.03
      )
      .to(`[data-beat-copy="${id}"]`, { opacity: 0, y: -18, duration: 0.028 }, tOut);
  }

  /* ---------- ATMOSPHERE ------------------------------------------- */
  // The camera rises: ground-side planes sink and leave frame, each at its
  // own rate. That difference is the whole point of splitting them.
  tl.to('[data-asset="HG-01"]', { y: () => vh(48), duration: 1, ease: 'none' }, 0)
    .to('[data-asset="HG-02"]', { y: () => vh(26), duration: 1, ease: 'none' }, 0)
    .to('[data-asset="HG-03"]', { y: () => vh(9), duration: 1, ease: 'none' }, 0);

  /* ---------- EXIT · through the clouds ---------------------------- */
  // HG-04 rises over everything so the hero ends by passing THROUGH cloud
  // rather than cutting to a white background.
  tl.to('[data-asset="HG-04"]', { opacity: 1, duration: 0.02 }, 0.93).to(
    '[data-asset="HG-04"]',
    { y: () => vh(-104), duration: 0.07, ease: 'power1.inOut' },
    0.93
  );

  /* The master timeline is normalised to a duration of exactly 1 so beat
     boundaries map straight onto scroll progress. A child that overruns
     silently rescales the scene, so fail loudly rather than ship a hero
     stuck on its end state. */
  const dur = tl.duration();
  if (Math.abs(dur - 1) > 0.001) {
    console.warn(
      `[hero] La timeline maestra dura ${dur.toFixed(3)} en lugar de 1. ` +
        'Los beats no coincidirán con el scroll — revisa las duraciones hijas.'
    );
  }

  return tl;
}

/* ------------------------------------------------------------------ *
 * Reduced motion — coherent static composition, beats by fade only
 * ------------------------------------------------------------------ */
function buildReduced(): void {
  gsap.set(STAGE_OBJS, { xPercent: -50, yPercent: -50 });
  gsap.set('[data-obj="laptop"]', { x: vw(46), y: vh(56), scale: 0.78, opacity: 1 });
  gsap.set('[data-obj="phone"]', { x: vw(84), y: vh(28), scale: 0.48, opacity: 0.9 });
  gsap.set('[data-obj="flow"]', { x: vw(78), y: vh(58), scale: 0.86, opacity: 1 });
  gsap.set('[data-flow-node]', { opacity: 1 });
  gsap.set('.flow__wire', { strokeDashoffset: 0 });
  gsap.set('[data-header-capsule]', { opacity: 1, y: 0, scale: 1 });
  gsap.set('[data-intro-text]', { opacity: 0 });
  gsap.set('[data-intro-cue]', { opacity: 0 });
  gsap.set('[data-beat-copy]', { opacity: 0 });
  gsap.set('[data-beat-copy="growth"]', { opacity: 1 });
  gsap.set('[data-beat-line]', { yPercent: 0 });
  gsap.set('[data-beat-sub]', { opacity: 1, y: 0 });
}

/* ------------------------------------------------------------------ *
 * Debug layers
 * ------------------------------------------------------------------ */
function initDebug(getState: () => { p: number; beat: (typeof beats)[number]; local: number }): void {
  const ab = q('[data-asset-overlay]');
  const hud = q('[data-hud]');
  const host = q('[data-hud-boxes]');
  const params = new URLSearchParams(window.location.search);
  if (ab && params.get('boxes') === '1') ab.hidden = false;
  if (hud && params.get('hud') === '1') hud.hidden = false;

  const tracked: Array<[string, string]> = [
    ['intro', '[data-intro-text]'],
    ['header', '[data-header-capsule]'],
    ['copy-social', '[data-beat-copy="social"]'],
    ['copy-web', '[data-beat-copy="web"]'],
    ['copy-growth', '[data-beat-copy="growth"]'],
    ['phone', '[data-obj="phone"]'],
    ['laptop', '[data-obj="laptop"]'],
    ['flow', '[data-obj="flow"]'],
    ['exit', '[data-asset="HG-04"]'],
  ];

  const boxes = new Map<string, HTMLElement>();
  if (host) {
    for (const [key] of tracked) {
      const d = document.createElement('div');
      d.className = 'bb';
      d.dataset.label = key;
      host.appendChild(d);
      boxes.set(key, d);
    }
  }

  const measureAssets = (): void => {
    if (!ab || ab.hidden) return;
    for (const box of ab.querySelectorAll<HTMLElement>('.ab__box')) {
      const id = box.querySelector('strong')?.textContent ?? '';
      const tag = ab.querySelector<HTMLElement>(`[data-ab-dims="${id}"]`);
      if (!tag) continue;
      const r = box.getBoundingClientRect();
      tag.textContent = `→ ${Math.round(r.width)}×${Math.round(r.height)} px`;
    }
  };

  const render = (): void => {
    if (!hud || hud.hidden) return;
    const { p, beat, local } = getState();
    const set = (sel: string, v: string): void => {
      const el = q(sel);
      if (el) el.textContent = v;
    };
    set('[data-hud-progress]', p.toFixed(3));
    set('[data-hud-beat]', `${beat.n} · ${beat.label}`);
    set('[data-hud-local]', local.toFixed(3));
    set('[data-hud-range]', `${Math.round(beat.from * 100)} – ${Math.round(beat.to * 100)} %`);

    for (const [key, sel] of tracked) {
      const el = q(sel);
      const box = boxes.get(key);
      const out = q(`[data-hud-bb="${key}"]`);
      if (!el || !box) continue;
      const r = el.getBoundingClientRect();
      const vis = Number(getComputedStyle(el).opacity) > 0.02 && r.width > 0;
      box.style.display = vis ? 'block' : 'none';
      Object.assign(box.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      if (out) {
        out.textContent = vis
          ? `${Math.round(r.left)},${Math.round(r.top)} · ${Math.round(r.width)}×${Math.round(r.height)}`
          : 'oculto';
      }
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'b' || e.key === 'B') {
      if (ab) ab.hidden = !ab.hidden;
      measureAssets();
    }
    if (e.key === 'g' || e.key === 'G') {
      if (hud) hud.hidden = !hud.hidden;
      render();
    }
  });
  window.addEventListener('resize', measureAssets, { passive: true });
  measureAssets();

  const loop = (): void => {
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
export function initHero(): void {
  const stage = q('[data-stage]');
  if (!stage) return;

  prepareWires();
  fitIntro();

  let progress = 0;
  const stateOf = () => {
    const beat = beats.find((b) => progress < b.to) ?? beats[beats.length - 1];
    const local = (progress - beat.from) / (beat.to - beat.from);
    return { p: progress, beat, local: Math.min(Math.max(local, 0), 1) };
  };

  const setReel = reelController();
  let lastBeat = -1;
  const publish = (p: number): void => {
    progress = p;
    const { beat } = stateOf();
    if (beat.n !== lastBeat) {
      lastBeat = beat.n;
      stage.setAttribute('data-beat', String(beat.n));
      setReel(beat.n);
    }
  };

  const mm = gsap.matchMedia();
  mm.add(
    {
      full: '(prefers-reduced-motion: no-preference)',
      reduced: '(prefers-reduced-motion: reduce)',
    },
    (ctx) => {
      const { full } = ctx.conditions as { full: boolean; reduced: boolean };
      if (full) {
        openingSequence(false);
        idleFloat();
        const stopPointer = cursorParallax();
        buildTimeline(publish);
        return () => stopPointer();
      }
      openingSequence(true);
      buildReduced();
      // Beats still advance so no content is ever unreachable.
      ScrollTrigger.create({
        trigger: '[data-hero]',
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => publish(self.progress),
      });
      return undefined;
    }
  );

  initDebug(stateOf);
}
