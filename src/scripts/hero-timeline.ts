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
 * Transform discipline: FIVE nested wrappers per 3D device, each owning
 * exactly one transform, so they can never fight.
 *   .obj        → position / scale / opacity   (this timeline)
 *   .obj__stage → perspective only, no transform
 *   .obj__float → idle drift
 *   .obj__point → cursor parallax
 *   .obj__spin  → entry rotation               (this timeline)
 * The flow cluster is flat and keeps the original .obj → .obj__float pair.
 *
 * Everything that listens to the window does so through ONE scroll
 * listener and ONE visibility listener, owned by stageActivity().
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { beats } from '../data/hero';
import { skyLife } from './sky-life';
import { sunSignature } from './sun-signature';

gsap.registerPlugin(ScrollTrigger);

const vw = (n: number): number => (window.innerWidth * n) / 100;
const vh = (n: number): number => (window.innerHeight * n) / 100;

const q = <T extends Element = HTMLElement>(s: string): T | null =>
  document.querySelector<T>(s);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * When each closing card becomes touchable.
 *
 * The five cards are `inert` in the markup and stay that way until the
 * one they belong to has actually arrived — filled in by buildTimeline
 * from the same numbers that drive the entry, so the two can never drift
 * apart. A card at one per cent opacity is not a link yet.
 */
const CARD_LIVE: Array<{ card: HTMLElement; from: number; to: number }> = [];

/**
 * Extra vh of headroom for the phone's entry, from --dev-top-clear.
 *
 * The floating header is a FIXED pixel height, so it occupies 5.6vh at
 * 1080 but 9.4vh at 640: a trajectory in vh that clears it on a large
 * screen runs straight through it on a 1020×640 laptop. tokens.css raises
 * this at each height breakpoint, and because every tween value here is a
 * function, `invalidateOnRefresh` picks up the new value on resize.
 */
const topClear = (): number => {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--dev-top-clear')
  );
  return Number.isFinite(v) ? v : 0;
};

const STAGE_OBJS =
  '[data-obj="phone"], [data-obj="laptop"], [data-obj="monitor"], [data-obj="tablet"], [data-obj="flow"]';

/* ------------------------------------------------------------------ *
 * Choreography schedule
 * ------------------------------------------------------------------ *
 * Every device cue in one place, as fractions of the master timeline
 * (which is normalised to exactly 1, so these ARE scroll fractions).
 * The debug HUD reads the same numbers — there is no second source.
 */
/**
 * v8 — five service beats instead of three.
 *
 * Every cue below moved, but NOTHING about the shape of the phone's turn
 * or the laptop's opening changed: the durations are expressed as
 * multiples of each device's own segment length, so retiming the schedule
 * rescales the choreography instead of rewriting it. `--hero-scroll` went
 * from 580vh to 820vh at the same time, which is what keeps each beat at
 * roughly the absolute amount of scrolling it had before.
 */
const PHONE_CUE = {
  /** Tramo A — leaves the upper-right corner, back to camera. */
  a: 0.128,
  /** Tramo B — crosses side-on and starts revealing the screen. */
  b: 0.178,
  /** Tramo C — settles as protagonist. */
  c: 0.228,
  /** Screen wakes: rotationY has come inside ~35°. */
  wake: 0.186,
  /** Retires into the top-right stack while the laptop takes over. */
  outFrom: 0.278,
  outTo: 0.322,
} as const;

/**
 * Laptop window: 0.442 → 0.745, split 20 / 25 / 20 / 35.
 *
 * The last third is the point. The machine is fully open and square to
 * camera from `done` (0.632) to `outFrom` (0.745) — 0.113 of the track,
 * about 52vh of scrolling, up from 37vh in v5. The keyboard is the payoff
 * of the whole beat and it no longer depends on catching one narrow
 * moment: you can scroll slowly, normally or briskly through it and the
 * open machine still holds the frame.
 */
const LAPTOP_CUE = {
  /** Fase A · 0–20 % — rises out of the cloud bank, still shut. */
  a: 0.288,
  /** Fase B · 20–45 % — swings square to camera, lid starts to lift. */
  b: 0.327,
  /** Fase C · 45–65 % — lid opens the rest of the way, body settles. */
  c: 0.376,
  /** 65 % — protagonist. The web copy lands just after this. */
  done: 0.415,
  /** Inner De Zamorano scroll. */
  scrollFrom: 0.423,
  scrollTo: 0.478,
  /** 100 % — retires into the stack. */
  outFrom: 0.482,
  outTo: 0.528,
} as const;

/** Monitor · software beat. Rises and turns square; no moving parts. */
const MONITOR_CUE = {
  a: 0.492,
  done: 0.575,
  outFrom: 0.638,
  outTo: 0.682,
} as const;

/** Tablet · brand beat. Turns in like the phone, then the canvas draws. */
const TABLET_CUE = {
  a: 0.648,
  /** Screen wakes once the face has come round. */
  wake: 0.694,
  done: 0.728,
  /** The mark, the palette and the type specimen draw themselves. */
  drawFrom: 0.716,
  drawTo: 0.772,
  outFrom: 0.778,
  outTo: 0.822,
} as const;

/**
 * Leaving the stage.
 *
 * v8 parked each device in a corner stack once its beat was over. It made
 * the argument literal — four services, one cluster — but it also meant
 * the closing beat was played against a pile of leftovers, and the pile
 * only ever grew. So each device now LEAVES: it drifts up and out through
 * the right edge, turning away as it goes.
 *
 * The turn matters. A device that slides out square to camera reads as a
 * card being swiped off; one that rotates away as it accelerates reads as
 * an object leaving a room. The opacity fade is held back to the last
 * half of the move so it exits the frame rather than dissolving in place.
 */
const EXIT = {
  x: 126,
  y: 16,
  scale: 0.62,
  rotationX: -2,
  rotationY: -36,
  rotationZ: 5,
} as const;

/** rotationY window, in degrees, inside which the reel may run. */
const REEL_GATE_DEG = 15;

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
 * Stage activity — the ONLY scroll and visibility listeners
 * ------------------------------------------------------------------ *
 * Float and cursor parallax both need to know whether the user is
 * scrolling hard and whether the tab is on screen. Each registering its
 * own listener would mean three scroll handlers competing on the same
 * frame, so this owns them and hands out a change notification.
 */
interface Activity {
  readonly fast: boolean;
  readonly scrolling: boolean;
  readonly visible: boolean;
  onChange(fn: () => void): void;
  dispose(): void;
}

function stageActivity(): Activity {
  let fast = false;
  let scrolling = false;
  let visible = document.visibilityState === 'visible';
  let lastY = window.scrollY;
  let lastT = performance.now();
  let idle = 0;

  const subs: Array<() => void> = [];
  const notify = (): void => {
    for (const fn of subs) fn();
  };

  const onScroll = (): void => {
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    // px/s. 1500 is roughly "flicked the wheel", not "reading".
    const v = (Math.abs(window.scrollY - lastY) / dt) * 1000;
    lastY = window.scrollY;
    lastT = now;

    const nextFast = v > 1500;
    let changed = false;
    if (nextFast !== fast) {
      fast = nextFast;
      changed = true;
    }
    if (!scrolling) {
      scrolling = true;
      changed = true;
    }
    if (changed) notify();

    window.clearTimeout(idle);
    idle = window.setTimeout(() => {
      scrolling = false;
      fast = false;
      notify();
    }, 260);
  };

  const onVisibility = (): void => {
    visible = document.visibilityState === 'visible';
    notify();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get fast() {
      return fast;
    },
    get scrolling() {
      return scrolling;
    },
    get visible() {
      return visible;
    },
    onChange(fn) {
      subs.push(fn);
    },
    dispose() {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(idle);
      subs.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * A NOTE ON will-change — deliberately absent from this file
 * ------------------------------------------------------------------ *
 * v5 armed `will-change: transform, opacity` on every transformed node on
 * scroll start and dropped it 260 ms after the user stopped. It looked
 * like good hygiene. It was the bug.
 *
 * scripts/diagnose-faces.mjs parks the scroll, freezes the float and the
 * cursor, and screenshots the same clip ten times. A stable renderer must
 * return ten identical PNGs. v5 returned two distinct renders at 7 of 7
 * probe positions, and always with the same shape: the first capture
 * differed from every later one. That first capture lands inside the
 * will-change window; the rest land after it expires.
 *
 * Adding or removing a compositing hint forces Chromium to create or
 * destroy a render surface and re-rasterise the preserve-3d subtree with
 * a different strategy. Faces pop. And because it re-armed on EVERY
 * scroll event, it fired on the smallest wheel tick, not just on fast
 * scrolling — which is exactly how the fault was reported.
 *
 * Promotion now lives in CSS, once, permanently, on .obj--phone and
 * .obj--laptop only: those sit ABOVE the perspective, so a layer there
 * cannot split the 3D context. No `will-change: opacity` anywhere near a
 * 3D scene — that flattens the whole solid into a single texture.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Idle float
 * ------------------------------------------------------------------ *
 * Deliberately NOT running from the start: an object still flying in has
 * no business bobbing. Each float is created paused and switched on when
 * its object reaches its resting state, then damped while the user is
 * scrolling hard so it never competes with the scroll.
 */
type FloatKey = 'phone' | 'laptop' | 'monitor' | 'tablet' | 'flow';

function floatController(activity: Activity): (key: FloatKey, on: boolean) => void {
  /* Slightly different periods on purpose: four devices drifting in
     lockstep would read as one rigid object, not as four. */
  const spec: Array<[FloatKey, string, number, number, number]> = [
    ['phone', '[data-float="phone"]', 8, 0.8, 3.2],
    ['laptop', '[data-float="laptop"]', 6, 0.5, 3.9],
    ['monitor', '[data-float="monitor"]', 5, 0.35, 4.4],
    ['tablet', '[data-float="tablet"]', 7, 0.55, 3.5],
    ['flow', '[data-float="flow"]', 7, 0.45, 3.6],
  ];

  const handles = new Map<
    FloatKey,
    { tw: gsap.core.Tween; el: HTMLElement; on: boolean }
  >();

  for (const [key, sel, dy, rot, dur] of spec) {
    const el = q<HTMLElement>(sel);
    if (!el) continue;
    const tw = gsap.to(el, {
      y: dy,
      rotation: rot,
      duration: dur,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      paused: true,
    });
    handles.set(key, { tw, el, on: false });
  }

  activity.onChange(() => {
    const target = activity.fast || !activity.visible ? 0.12 : 1;
    for (const h of handles.values()) {
      if (!h.on) continue;
      gsap.to(h.tw, { timeScale: target, duration: 0.4, ease: 'power2.out', overwrite: true });
    }
  });

  return (key, on) => {
    const h = handles.get(key);
    if (!h || h.on === on) return;
    h.on = on;
    if (on) {
      h.tw.timeScale(activity.fast ? 0.12 : 1).play();
      return;
    }
    h.tw.pause();
    // No will-change here either. .obj__float sits INSIDE the perspective,
    // so promoting it splits the 3D context — the same fault, one level
    // down. See the note above.
    gsap.to(h.el, { y: 0, rotation: 0, duration: 0.4, ease: 'power2.out' });
  };
}

/* ------------------------------------------------------------------ *
 * The monitor's interface, alive
 * ------------------------------------------------------------------ *
 * On its OWN clock, not on the scroll. A dashboard that only moves while
 * you drag the scrollbar is not a system, it is a picture of one — and the
 * brief for this beat is "software running inside a company", which has to
 * keep running when the user stops.
 *
 * Same shape as floatController: created paused, switched on only while
 * the monitor is protagonist, damped while the user is scrolling hard, and
 * silent on a hidden tab. Transform and opacity only, all of it inside a
 * transform-style: flat face, so none of it can touch the 3D sorting.
 */
function monitorLife(activity: Activity): (on: boolean) => void {
  const tl = gsap.timeline({ paused: true, repeat: -1, yoyo: true });
  const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-ui-bar]'));
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-ui-tile]'));
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-ui-row]'));

  /* Bars breathe on individually irrational periods. Equal periods would
     make eight bars pulse as one block, which reads as a loading state. */
  bars.forEach((bar, i) => {
    gsap.set(bar, { transformOrigin: '50% 100%' });
    tl.to(
      bar,
      {
        scaleY: 0.58 + ((i * 37) % 60) / 100,
        duration: 1.6 + ((i * 29) % 90) / 100,
        ease: 'sine.inOut',
      },
      i * 0.11
    );
  });

  tiles.forEach((tile, i) => {
    tl.to(tile, { y: -3, duration: 2.2 + i * 0.4, ease: 'sine.inOut' }, i * 0.35);
  });

  rows.forEach((row, i) => {
    tl.to(row, { opacity: 0.45, duration: 1.5 + i * 0.25, ease: 'sine.inOut' }, 0.2 + i * 0.3);
  });

  // Independent loops: these read better travelling than ping-ponging.
  const extras: gsap.core.Tween[] = [];
  const scan = q<HTMLElement>('[data-ui-scan]');
  if (scan) {
    extras.push(
      gsap.fromTo(
        scan,
        { yPercent: -120 },
        { yPercent: 560, duration: 3.4, ease: 'none', repeat: -1, paused: true }
      )
    );
  }
  const live = q<HTMLElement>('[data-ui-live]');
  if (live) {
    extras.push(
      gsap.to(live, {
        boxShadow: '0 0 0 6px rgba(37,183,154,0)',
        opacity: 0.55,
        duration: 1.5,
        ease: 'power2.out',
        repeat: -1,
        paused: true,
      })
    );
  }
  const dot = q<HTMLElement>('[data-ui-dot]');
  if (dot) {
    // Centred here rather than in CSS: a transform in the stylesheet
    // would be overwritten the moment GSAP animates scale.
    gsap.set(dot, { xPercent: -50, yPercent: -50, transformOrigin: '50% 50%' });
    extras.push(
      gsap.to(dot, {
        scale: 1.45,
        opacity: 0.45,
        duration: 1.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        paused: true,
      })
    );
  }

  let on = false;
  activity.onChange(() => {
    if (!on) return;
    const t = activity.fast || !activity.visible ? 0.15 : 1;
    gsap.to([tl, ...extras], { timeScale: t, duration: 0.4, overwrite: true });
  });

  return (next) => {
    if (on === next) return;
    on = next;
    if (next) {
      tl.play();
      for (const e of extras) e.play();
    } else {
      tl.pause();
      for (const e of extras) e.pause();
    }
  };
}

/* ------------------------------------------------------------------ *
 * Cursor parallax
 * ------------------------------------------------------------------ *
 * Tiny on purpose — it is a lighting cue, not a toy. Never runs during
 * the entry: it only switches on once the object is protagonist, and
 * switches off while scrolling fast, off-screen, or on a hidden tab.
 */
interface PointerTarget {
  key: FloatKey;
  el: HTMLElement;
  px: number;
  rx: number;
  ry: number;
  active: boolean;
  inView: boolean;
  setX: (v: number) => void;
  setY: (v: number) => void;
  setRX: (v: number) => void;
  setRY: (v: number) => void;
}

function cursorParallax(activity: Activity): {
  setActive(key: FloatKey, on: boolean): void;
  dispose(): void;
} {
  // key, selector, max px, max rotationX°, max rotationY°
  const spec: Array<[FloatKey, string, number, number, number]> = [
    ['phone', '[data-point="phone"]', 10, 1.5, 2.5],
    ['laptop', '[data-point="laptop"]', 6, 0.8, 1.2],
    ['monitor', '[data-point="monitor"]', 5, 0.7, 1.1],
    ['tablet', '[data-point="tablet"]', 8, 1.1, 1.8],
  ];

  const targets: PointerTarget[] = [];
  for (const [key, sel, px, rx, ry] of spec) {
    const el = q<HTMLElement>(sel);
    if (!el) continue;
    const opts = { duration: 0.7, ease: 'power2.out' };
    targets.push({
      key,
      el,
      px,
      rx,
      ry,
      active: false,
      inView: true,
      setX: gsap.quickTo(el, 'x', opts),
      setY: gsap.quickTo(el, 'y', opts),
      setRX: gsap.quickTo(el, 'rotationX', opts),
      setRY: gsap.quickTo(el, 'rotationY', opts),
    });
  }

  let nx = 0;
  let ny = 0;

  const apply = (): void => {
    const gate = activity.visible && !activity.fast;
    for (const t of targets) {
      const live = gate && t.active && t.inView;
      const gx = live ? nx : 0;
      const gy = live ? ny : 0;
      t.setX(gx * t.px);
      t.setY(gy * t.px * 0.6);
      // Mouse low on screen → we look from below → rotationX negative.
      t.setRX(-gy * t.rx);
      t.setRY(gx * t.ry);
    }
  };

  const onMove = (e: MouseEvent): void => {
    nx = (e.clientX / window.innerWidth) * 2 - 1;
    ny = (e.clientY / window.innerHeight) * 2 - 1;
    apply();
  };

  window.addEventListener('mousemove', onMove, { passive: true });
  activity.onChange(apply);

  // Objects leave the frame during the choreography; IntersectionObserver
  // reflects transforms, so this genuinely tracks the rendered position.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.obj as FloatKey | undefined;
        const t = targets.find((x) => x.key === key);
        if (t) t.inView = entry.isIntersecting;
      }
      apply();
    },
    { threshold: 0.05 }
  );
  for (const sel of [
    '[data-obj="phone"]',
    '[data-obj="laptop"]',
    '[data-obj="monitor"]',
    '[data-obj="tablet"]',
  ]) {
    const el = q(sel);
    if (el) io.observe(el);
  }

  return {
    setActive(key, on) {
      const t = targets.find((x) => x.key === key);
      if (!t || t.active === on) return;
      t.active = on;
      apply();
    },
    dispose() {
      window.removeEventListener('mousemove', onMove);
      io.disconnect();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Reel — gated on the phone's actual rotation, not on the beat
 * ------------------------------------------------------------------ *
 * The screen must never play while it is turned away from the viewer, so
 * the gate reads the rendered rotationY of the spin wrapper: playback
 * starts as the device comes inside ±15° and stops again when it turns
 * back out to −18° for the secondary position. One rule covers both.
 */
interface Reel {
  update(p: number, rotationY: number): void;
  readonly label: string;
}

function reelController(): Reel {
  const video = q<HTMLVideoElement>('[data-reel]');
  let armed = false;
  let label = 'sin cargar';

  return {
    update(p, rotationY) {
      if (!video) return;

      // Buffer while the device is still on its way in, so the first
      // frame after the reveal is not a stall.
      if (!armed && p > 0.1 && p < 0.36) {
        video.preload = 'auto';
        video.load();
        armed = true;
      }

      const facing = Math.abs(rotationY) <= REEL_GATE_DEG;
      const onStage = p >= PHONE_CUE.a && p < PHONE_CUE.outTo;
      const wants = armed && facing && onStage;

      if (wants && video.paused) {
        void video.play().catch(() => {
          /* autoplay refused — the poster stays, which is acceptable */
        });
      } else if (!wants && !video.paused) {
        video.pause();
      }

      label = !armed
        ? 'sin cargar'
        : video.paused
          ? facing
            ? 'en pausa'
            : `en pausa · pantalla a ${Math.round(rotationY)}°`
          : 'reproduciendo';
    },
    get label() {
      return label;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Master timeline
 * ------------------------------------------------------------------ */
type Mode = 'full' | 'compact';

function buildTimeline(mode: Mode, onRender: (p: number) => void): gsap.core.Timeline {
  /* `?scrub=0` removes the 0.9 s trail so a scripted scroll renders the
     exact frame it asked for. Review harness only (scripts/preview-video),
     never a production path — the trail is half of why the hero feels
     smooth. */
  const lag = new URLSearchParams(window.location.search).get('scrub') === '0' ? true : 0.9;

  const tl = gsap.timeline({
    defaults: { ease: 'power2.out' },
    // Reading progress on the timeline's own render (not on the
    // ScrollTrigger's) is what makes the reel gate honest: with scrub the
    // timeline trails the scroll, and the gate must see what is on screen.
    onUpdate: () => onRender(tl.progress()),
    scrollTrigger: {
      trigger: '[data-hero]',
      start: 'top top',
      end: 'bottom bottom',
      scrub: lag,
      invalidateOnRefresh: true,
      onRefresh: () => onRender(tl.progress()),
    },
  });

  gsap.set(STAGE_OBJS, { xPercent: -50, yPercent: -50 });
  gsap.set('[data-laptop-shadow], [data-monitor-shadow]', { xPercent: -50, yPercent: -50 });

  /* Prepare every copy before ScrollTrigger can render its first frame.
     The old delayed `fromTo` setup initialised and rasterised Puffy in
     the same frame that the scrub first revealed it, which caused the
     small first-entry hitch. Fixed pixel translation also means a late
     font-metric change cannot alter a percentage transform. */
  gsap.set('[data-beat-copy]', { opacity: 0, y: 0, scale: 1 });
  gsap.set('[data-copy-cloud]', { opacity: 0, scale: 0.93, y: 26 });
  gsap.set('[data-beat-line]', { opacity: 0, y: 26, scale: 1, force3D: false });
  gsap.set('[data-beat-sub]', { opacity: 0, y: 16, force3D: false });

  /* ---------- INTRO STATEMENT · 0 – 22 % --------------------------- */
  // Not an opacity fade: the crisp copy lifts and thins while its blurred
  // twin swells and drifts, and an SVG turbulence displacement ramps up so
  // the letterforms actually break apart into the sky.
  tl.to('[data-intro-cue]', { opacity: 0, duration: 0.021 }, 0.037)
    .to(
      '[data-intro-line]',
      { y: () => vh(-3), duration: 0.037, ease: 'none', stagger: 0.006 },
      0.037
    )
    .to(
      '[data-intro-line]',
      { y: () => vh(-11), opacity: 0, duration: 0.042, stagger: 0.01, ease: 'power1.in' },
      0.073
    )
    .to(
      '.intro__vapour',
      {
        opacity: 0,
        scale: 1.16,
        filter: 'blur(46px)',
        duration: 0.047,
        stagger: 0.01,
        ease: 'power1.in',
      },
      0.068
    )
    .to('[data-vapour-map]', { attr: { scale: 46 }, duration: 0.047, ease: 'power2.in' }, 0.068)
    .to('[data-intro-text]', { opacity: 0, duration: 0.011 }, 0.11);

  /* ---------- HEADER · enters while the statement dissolves -------- */
  tl.to(
    '[data-header-capsule]',
    { opacity: 1, y: 0, scale: 1, duration: 0.037, ease: 'power3.out' },
    0.094
  );

  /* Web copy waits for the lid. On the compact variant there is no lid
     animation to wait for, so it keeps the original slot. */
  /* The sentence used to wait for the lid to finish opening (0.415) and
     then leave almost at once. It was the shortest window in the hero and
     it read as the caption arriving late to its own beat. It now lands
     while the lid is on its last stretch — the machine is plainly a
     laptop by then — and holds until the next service is already on its
     way in. */
  const webCopyIn = mode === 'full' ? 0.392 : 0.34;
  const webCopyOut = mode === 'full' ? 0.492 : 0.46;

  if (mode === 'full') {
    buildPhoneFull(tl);
    buildLaptopFull(tl);
    buildMonitorFull(tl);
    buildTabletFull(tl);
  } else {
    buildDevicesCompact(tl);
  }

  /* ---------- FLOW · growth beat ----------------------------------- */
  tl.fromTo(
    '[data-obj="flow"]',
    { x: () => vw(70), y: () => vh(60), scale: 0.94, opacity: 0 },
    {
      x: () => vw(68),
      y: () => vh(52 + topClear() * 0.35),
      scale: 1,
      opacity: 1,
      duration: 0.04,
    },
    0.786
  ).to(
    '[data-obj="flow"]',
    { y: () => vh(48 + topClear() * 0.6), opacity: 0.94, duration: 0.04 },
    0.955
  );

  /* The business is the stable nucleus. It settles first; the CSS orbit
     and its light points activate around it, then the existing cards
     arrive on the same stagger they have always used. */
  tl.fromTo(
    '[data-flow-core]',
    { opacity: 0, scale: 0.82, y: 18 },
    { opacity: 1, scale: 1, y: 0, duration: 0.072, ease: 'power3.out' },
    0.79
  )
    .fromTo(
      '[data-flow-orbit]',
      { opacity: 0 },
      { opacity: 1, duration: 0.065, stagger: 0.012, ease: 'power2.out' },
      0.802
    )
    .fromTo(
      '[data-flow-point]',
      { opacity: 0 },
      { opacity: 1, duration: 0.034, stagger: 0.005, ease: 'power2.out' },
      0.818
    );

  /* Nodes light up around the ring in the order the hero showed them,
     so the closing beat replays the sequence you have just scrolled
     through — and then the last wire returns to the first node, which is
     the only way a circuit reads as closed rather than as a list. */
  /* The ring assembles itself.
     ---------------------------------------------------------------
     Each card starts pushed 44 % of the way back towards the middle of
     the circle and settles OUTWARD into its place, one after another,
     clockwise from twelve. Nothing is drawn between them: the circle is
     built by five arrivals along five different radii, which reads as a
     system opening out rather than as a diagram being labelled.

     The offsets are functions of the live layout, so `invalidateOnRefresh`
     re-derives them and the choreography survives a resize. */
  const cluster = q<HTMLElement>('[data-flow-cluster]');
  const radial = (el: HTMLElement, axis: 'x' | 'y'): number => {
    if (!cluster) return 0;
    const cw = cluster.clientWidth;
    const ch = cluster.clientHeight;
    return axis === 'x'
      ? -(el.offsetLeft + el.offsetWidth / 2 - cw / 2) * 0.44
      : -(el.offsetTop + el.offsetHeight / 2 - ch / 2) * 0.44;
  };

  ['contenido', 'marca', 'web', 'software', 'contacto'].forEach((id, i) => {
    const card = q<HTMLElement>(`[data-flow-node="${id}"]`);
    if (!card) return;
    tl.fromTo(
      card,
      {
        opacity: 0,
        scale: 0.82,
        rotationX: 16,
        x: () => radial(card, 'x'),
        y: () => radial(card, 'y'),
      },
      {
        opacity: 1,
        scale: 1,
        rotationX: 0,
        x: 0,
        y: 0,
        duration: 0.042,
        ease: 'power3.out',
      },
      0.796 + i * 0.021
    );
  });

  /* CARD_LIVE mirrors the schedule above: card i is written into the
     scene at 0.796 + i·0.021 over 0.042, and only becomes touchable once
     it is roughly three quarters of the way in. The upper bound is where
     the ring itself starts to leave. Exported so the render loop can
     enforce it in both scroll directions. */
  CARD_LIVE.length = 0;
  ['contenido', 'marca', 'web', 'software', 'contacto'].forEach((id, i) => {
    const card = q<HTMLElement>(`[data-flow-node="${id}"]`);
    /* 0.985, not the moment the ring starts drifting: the exit bank only
       finishes covering it at the very end of the track, and a card that
       is still plainly on screen has to still be a link. */
    if (card) CARD_LIVE.push({ card, from: 0.796 + i * 0.021 + 0.031, to: 0.985 });
  });

  // The aura fills in behind them as the ring closes.
  tl.fromTo(
    '[data-flow-aura]',
    { opacity: 0, scale: 0.7 },
    { opacity: 1, scale: 1, duration: 0.09, ease: 'power2.out' },
    0.8
  );

  /* ---------- BEAT COPY -------------------------------------------- */
  /* Each headline now spans nearly the whole of its beat: in as the
     device starts arriving, out only once the next one has begun. The
     copy is what makes the beat legible, so it should be on screen for
     as much of it as the composition allows. */
  const copyAt: Array<[string, number, number]> = [
    ['social', 0.132, 0.272],
    ['web', webCopyIn, webCopyOut],
    ['software', 0.502, 0.632],
    ['brand', 0.66, 0.772],
    ['growth', 0.788, 0.94],
  ];
  /* The block builds in three overlapping moves and then STOPS.
     ------------------------------------------------------------------
     The cloud goes first and alone for a beat — it condenses out of the
     sky, gaining density and settling the last few pixels — and the
     headline resolves out of it a moment later, line by line. That order
     is the whole idea: the cloud is not a panel the text was placed on,
     it is where the text came from.

     Everything is transform and opacity. There is no blur anywhere in
     here, and that is a decision rather than an omission: these tweens
     are SCRUBBED, so a 0.04 slice of the timeline is about 45vh of
     scrolling, and animating a filter across 45vh of wheel events means
     re-rasterising a 900px block on every one of them.

     The ordered entrance completes in about 0.084 and the exit in 0.024;
     every beat still retains a long, completely static reading hold. */
  for (const [id, tIn, tOut] of copyAt) {
    const q = (sel: string): string => `[data-beat-copy="${id}"] ${sel}`;
    const lines = Array.from(document.querySelectorAll<HTMLElement>(q('[data-beat-line]')));

    tl.set(`[data-beat-copy="${id}"]`, { opacity: 1, y: 0, scale: 1 }, tIn)
      .to(
        q('[data-copy-cloud]'),
        { opacity: 1, scale: 1, y: 0, duration: 0.05, ease: 'power3.out' },
        tIn
      );

    /* DOM order is choreography order. Giving each line its own tween
       guarantees that line one starts gaining density before line two,
       even on the first large wheel step. No scale means no glyph
       re-rasterisation or tiny snap when the tween settles. */
    lines.forEach((line, index) => {
      tl.to(
        line,
        {
          opacity: 1,
          y: 0,
          duration: 0.038,
          ease: 'power2.out',
          force3D: false,
          lazy: false,
        },
        tIn + 0.012 + index * 0.016
      );
    });

    tl.to(
      q('[data-beat-sub]'),
      { opacity: 1, y: 0, duration: 0.03, ease: 'power2.out', force3D: false, lazy: false },
      tIn + 0.054
    )
      /* Out as one piece: the block loses density, grows a hair and
         drifts, which reads as it going back into the sky rather than
         being switched off. transform-origin is on the copy's own anchor
         (see .beat), so it dissipates away from where it arrived. */
      .to(
        `[data-beat-copy="${id}"]`,
        { opacity: 0, y: -22, scale: 1.035, duration: 0.024, ease: 'power2.in' },
        tOut
      );
  }

  /* ---------- ATMOSPHERE ------------------------------------------- */
  // The camera rises: ground-side planes sink and leave frame, each at its
  // own rate. That difference is the whole point of splitting them.
  // The drifting clouds get the smallest sink of all — they are the
  // farthest thing in the scene, and something that high barely moves
  // when the camera climbs. Leaving them at 0 would have read as a
  // painted backdrop the moment the banks started to descend.
  tl.to('[data-asset="HG-01"]', { y: () => vh(48), duration: 1, ease: 'none' }, 0)
    .to('[data-asset="HG-02"]', { y: () => vh(26), duration: 1, ease: 'none' }, 0)
    .to('[data-asset="HG-03"]', { y: () => vh(9), duration: 1, ease: 'none' }, 0)
    .to('[data-drifters]', { y: () => vh(4.5), duration: 1, ease: 'none' }, 0);

  /* ---------- EXIT · through the clouds ---------------------------- */
  // HG-04 rises over everything so the hero ends by passing THROUGH cloud
  // rather than cutting to a white background.
  tl.to('[data-asset="HG-04"]', { opacity: 1, duration: 0.015 }, 0.945).to(
    '[data-asset="HG-04"]',
    { y: () => vh(-104), duration: 0.055, ease: 'power1.inOut' },
    0.945
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
 * PHONE · social beat — three tramos, one arc
 * ------------------------------------------------------------------ *
 * The path is curved because x and y run on DIFFERENT eases over
 * DIFFERENT spans: x eases in hard and lands early, y keeps falling after
 * x has arrived. Straight-line interpolation is exactly what a curve like
 * this avoids, and it costs no plugin.
 *
 * The rotation is a 198° sweep: 190° (back to camera) → 70° (past the
 * side-on crossing, where the rims are all you see) → −8° (screen facing
 * you, held a touch off-square so it never reads as a flat card).
 */
function buildPhoneFull(tl: gsap.core.Timeline): void {
  const P = PHONE_CUE;
  /* Durations as MULTIPLES of the entry's own segment length, not
     literals. The v8 retiming moved every cue; expressing them this way
     is what let the schedule change without the turn changing shape. */
  const seg = P.b - P.a;

  tl.fromTo(
    '[data-obj="phone"]',
    { x: () => vw(107), y: () => vh(6 + topClear()), scale: 0.46, opacity: 0 },
    { opacity: 1, duration: seg * 0.373, ease: 'power1.out' },
    P.a
  )
    /* x — enters FAST and then decelerates. This is the load-bearing
       choice: the turn is a slow inOut, so if x crawled in as well the
       phone would spend its whole back-to-camera phase off-canvas and the
       reveal would happen where nobody can see it. It arrives early and
       waits, turning, inside the frame. */
    .to('[data-obj="phone"]', { x: () => vw(80), duration: seg, ease: 'power2.out' }, P.a)
    .to('[data-obj="phone"]', { x: () => vw(73), duration: seg, ease: 'power2.out' }, P.b)
    // y — gentler ease over a longer span, finishing after x has settled.
    // That mismatch is what bows the path instead of ruling a line.
    .to(
      '[data-obj="phone"]',
      { y: () => vh(34 + topClear() * 0.7), duration: seg * 1.267, ease: 'power1.out' },
      P.a
    )
    .to(
      '[data-obj="phone"]',
      { y: () => vh(50), duration: seg * 0.733, ease: 'power2.inOut' },
      P.a + seg * 1.267
    )
    // scale
    .to('[data-obj="phone"]', { scale: 0.82, duration: seg, ease: 'power2.out' }, P.a)
    .to('[data-obj="phone"]', { scale: 1, duration: seg, ease: 'power3.out' }, P.b);

  /* The ease matters more than the angles here.
     At exactly 90° a phone IS a thin metal rod — that is not a bug, it is
     what an edge-on phone looks like, and now that the four side walls
     exist it renders as a solid rod rather than vanishing. But it is the
     least legible instant of the turn, so the rotation must cross it
     FAST and spend its time in the two three-quarter views either side.
     power2.in reaches its top speed at the end of tramo A, and 90° falls
     at 94 % of tramo A — so the crossing takes about 1vh of scrolling
     instead of the ~8vh a symmetric inOut spent lingering on it. */
  tl.fromTo(
    '[data-spin="phone"]',
    { rotationX: -12, rotationY: 190, rotationZ: 24 },
    { rotationX: -3, rotationY: 70, rotationZ: 10, duration: seg, ease: 'power2.in' },
    P.a
  ).to(
    '[data-spin="phone"]',
    // −2, not +2: negative rotationX is the "seen from slightly above"
    // sign, which is the same camera the laptop settles into.
    { rotationX: -2, rotationY: -8, rotationZ: 3, duration: seg, ease: 'power3.out' },
    P.b
  );

  // The screen is dark until it has actually turned to camera. This is a
  // wake, not a fade-in: the reel gate below fires around the same moment.
  tl.fromTo(
    '[data-phone-off]',
    { opacity: 1 },
    { opacity: 0, duration: seg * 0.347, ease: 'power2.out' },
    P.wake
  );

  /* Into the stack. rotationY −22 also takes it outside the reel gate, so
     playback stops without a second rule. */
  exitRight(tl, 'phone', P.outFrom, P.outTo);
}

/* ------------------------------------------------------------------ *
 * Retiring a device into the top-right stack
 * ------------------------------------------------------------------ *
 * One helper, four devices, identical grammar — which is the point. The
 * corner has to read as a deliberate cluster, and it only will if every
 * device arrives there the same way.
 */
type DeviceKey = 'phone' | 'laptop' | 'monitor' | 'tablet';

function exitRight(tl: gsap.core.Timeline, key: DeviceKey, from: number, to: number): void {
  const dur = to - from;

  tl.to(
    `[data-obj="${key}"]`,
    {
      x: () => vw(EXIT.x),
      y: () => vh(EXIT.y + topClear() * 0.6),
      scale: EXIT.scale,
      duration: dur,
      // Accelerating out: it starts to go before it has gone.
      ease: 'power2.in',
    },
    from
  )
    // Held back on purpose — it should clear the frame, not dissolve in it.
    .to(
      `[data-obj="${key}"]`,
      { opacity: 0, duration: dur * 0.5, ease: 'power1.in' },
      from + dur * 0.5
    )
    .to(
      `[data-spin="${key}"]`,
      {
        rotationX: EXIT.rotationX,
        rotationY: EXIT.rotationY,
        rotationZ: EXIT.rotationZ,
        duration: dur,
        ease: 'power2.inOut',
      },
      from
    );
}

/* ------------------------------------------------------------------ *
 * LAPTOP · web beat — rises shut, then opens
 * ------------------------------------------------------------------ *
 * Fase A  rises out of the cloud bank, lid shut, shadow wide and weak.
 * Fase B  swings square to camera; the lid breaks its seal.
 * Fase C  the lid completes and the body settles. The web copy lands
 *         immediately after — the machine finishes before the sentence.
 *
 * The lid's two segments are power2.in then power2.out, which composes to
 * one power2.inOut across the whole opening: no stop at the halfway
 * angle, no bounce at the end.
 */
function buildLaptopFull(tl: gsap.core.Timeline): void {
  const L = LAPTOP_CUE;
  const durA = L.b - L.a;
  const durB = L.c - L.b;
  const durC = L.done - L.c;

  // Painted shut in CSS too, so the very first frame is never an open
  // laptop; this pins it for reverse scrubbing.
  tl.set('[data-laptop-lid]', { rotationX: -90 }, 0);

  tl.fromTo(
    '[data-obj="laptop"]',
    { x: () => vw(70), y: () => vh(96), scale: 0.62, opacity: 0 },
    { opacity: 1, duration: 0.03 },
    L.a
  )
    /* y is NOT monotonic, and that is deliberate. The .obj box is the
       upright lid; while the lid is shut it lies flat towards the camera
       and the rendered mass hangs ~340 px BELOW that box. So the closed
       machine has to be carried high (34vh) to sit in frame, and then
       settle back down (44 → 48vh) as the lid stands up and the mass
       returns to the box. The composition stays still while the object
       unfolds — which is the whole illusion. */
    .to(
      '[data-obj="laptop"]',
      { x: () => vw(68), y: () => vh(34), scale: 0.74, duration: durA, ease: 'power2.out' },
      L.a
    )
    .to(
      '[data-obj="laptop"]',
      { x: () => vw(57.5), y: () => vh(44), scale: 0.86, duration: durB, ease: 'power2.inOut' },
      L.b
    )
    .to(
      '[data-obj="laptop"]',
      { x: () => vw(69), y: () => vh(48), scale: 1, duration: durC, ease: 'power3.out' },
      L.c
    );

  /* Camera angle — NEGATIVE rotationX is the one that looks DOWN on this
     object, and the sign is not a matter of taste.
     rotateX(+C) rolls the object's +y towards +z. The base extends along
     +z (out of the hinge, towards the camera), so a positive C lifts its
     near edge UP the screen and leans the lid TOWARDS the viewer: the
     machine is being seen from underneath, the deck collapses to a
     30 px sliver, and the closed lid presents its screen instead of its
     shell. Negative C drops the near edge, leans the lid back the way a
     real one rests, and makes backface-visibility resolve correctly.
     It starts steep (−24°) because the object is SHUT for the whole of
     fase A, and a closed laptop near eye level is a wedge of nothing;
     the gentle ease keeps the angle high while it is most legible. */
  tl.fromTo(
    '[data-spin="laptop"]',
    { rotationX: -24, rotationY: 20, rotationZ: -5 },
    { rotationX: -17, rotationY: 14, rotationZ: -3, duration: durA, ease: 'power1.out' },
    L.a
  )
    .to(
      '[data-spin="laptop"]',
      { rotationX: -12, rotationY: 8, rotationZ: -1, duration: durB, ease: 'power2.inOut' },
      L.b
    )
    .to(
      '[data-spin="laptop"]',
      { rotationX: -9, rotationY: -4, rotationZ: 0, duration: durC, ease: 'power3.out' },
      L.c
    );

  // Lid. Shut through the whole ascent, then one continuous opening.
  tl.to('[data-laptop-lid]', { rotationX: -52, duration: durB, ease: 'power2.in' }, L.b).to(
    '[data-laptop-lid]',
    { rotationX: 0, duration: durC, ease: 'power2.out' },
    L.c
  );

  /* The screen wakes as the lid clears ~55°: aluminium while shut, De
     Zamorano once the lid has opened far enough to actually see it. */
  tl.fromTo(
    '[data-laptop-off]',
    { opacity: 1 },
    { opacity: 0, duration: 0.045, ease: 'power2.out' },
    L.c - 0.012
  );

  /* Shadow. Far away it is wide, weak and very diffuse; as the object
     arrives it tightens and the denser layer cross-fades in. Only scale
     and opacity animate — the two blurs are static, which is cheaper than
     tweening filter: blur() every frame and reads the same. */
  tl.fromTo(
    '[data-laptop-shadow]',
    { opacity: 0, scaleX: 0.6, scaleY: 0.46 },
    { opacity: 0.55, scaleX: 0.8, scaleY: 0.68, duration: durA, ease: 'power3.out' },
    L.a
  )
    .to(
      '[data-laptop-shadow]',
      { opacity: 0.85, scaleX: 0.93, scaleY: 0.88, duration: durB, ease: 'power2.inOut' },
      L.b
    )
    .to(
      '[data-laptop-shadow]',
      { opacity: 1, scaleX: 1, scaleY: 1, duration: durC, ease: 'power3.out' },
      L.c
    )
    .fromTo(
      '.laptop__shadow-tight',
      { opacity: 0 },
      { opacity: 1, duration: durB + durC, ease: 'power2.in' },
      L.b
    );

  /* Slow scroll of the capture inside the lid, so the site is actually
     recognisable. Starts only once the lid is fully open, and only when
     USR-01 exists: the placeholder fills the bezel exactly, so scrolling
     it would reveal black. */
  const track = q<HTMLElement>('[data-laptop-track]');
  if (track?.dataset.hasCapture === '1') {
    tl.fromTo(
      track,
      { yPercent: 0 },
      { yPercent: -44, duration: L.scrollTo - L.scrollFrom, ease: 'none' },
      L.scrollFrom
    ).to(track, { yPercent: -22, duration: 0.03, ease: 'none' }, L.scrollTo);
  }

  /* Into the stack, lid still open — the service stays legible up there.
     Its contact shadow goes with it: a shadow makes sense under the
     protagonist resting on cloud, not under a card in a corner. */
  exitRight(tl, 'laptop', L.outFrom, L.outTo);
  tl.to(
    '[data-laptop-shadow]',
    { opacity: 0, scaleX: 0.7, scaleY: 0.6, duration: (L.outTo - L.outFrom) * 0.6 },
    L.outFrom
  );
}

/* ------------------------------------------------------------------ *
 * MONITOR · software beat
 * ------------------------------------------------------------------ *
 * The desktop machine has no moving parts, so its entrance has to come
 * from the camera instead: it rises out of the cloud already assembled,
 * turned well off-axis, and swings square while the panel wakes. Calmer
 * than the phone's turn and shorter than the laptop's opening — three
 * identical entrances in a row would flatten the whole sequence.
 */
function buildMonitorFull(tl: gsap.core.Timeline): void {
  const M = MONITOR_CUE;
  const span = M.done - M.a;

  tl.fromTo(
    '[data-obj="monitor"]',
    { x: () => vw(62), y: () => vh(112), scale: 0.7, opacity: 0 },
    { opacity: 1, duration: span * 0.3 },
    M.a
  )
    .to(
      '[data-obj="monitor"]',
      { y: () => vh(64), scale: 0.88, duration: span * 0.62, ease: 'power2.out' },
      M.a
    )
    .to(
      '[data-obj="monitor"]',
      { x: () => vw(66), y: () => vh(47), scale: 1, duration: span * 0.5, ease: 'power3.out' },
      M.a + span * 0.5
    );

  tl.fromTo(
    '[data-spin="monitor"]',
    { rotationX: -16, rotationY: 26, rotationZ: -4 },
    { rotationX: -11, rotationY: 15, rotationZ: -2, duration: span * 0.55, ease: 'power1.out' },
    M.a
  ).to(
    '[data-spin="monitor"]',
    { rotationX: -7, rotationY: -3, rotationZ: 0, duration: span * 0.55, ease: 'power3.out' },
    M.a + span * 0.5
  );

  tl.fromTo(
    '[data-monitor-shadow]',
    { opacity: 0, scaleX: 0.6, scaleY: 0.5 },
    { opacity: 0.9, scaleX: 1, scaleY: 1, duration: span, ease: 'power2.out' },
    M.a
  );

  /* The plotted line draws itself once the panel is square to camera.
     It is the only motion inside the screen, and it is what says
     "working tool" rather than "picture of a tool". */
  const line = q<SVGPathElement>('[data-ui-line]');
  if (line) {
    tl.fromTo(
      line,
      { strokeDashoffset: () => line.getTotalLength() },
      { strokeDashoffset: 0, duration: span * 0.6, ease: 'power1.inOut' },
      M.a + span * 0.62
    ).fromTo(
      '[data-ui-area]',
      { opacity: 0 },
      { opacity: 1, duration: span * 0.4, ease: 'power1.out' },
      M.a + span * 0.85
    );
  }

  exitRight(tl, 'monitor', M.outFrom, M.outTo);
  tl.to(
    '[data-monitor-shadow]',
    { opacity: 0, scaleX: 0.7, duration: (M.outTo - M.outFrom) * 0.6 },
    M.outFrom
  );
}

/* ------------------------------------------------------------------ *
 * TABLET · brand beat
 * ------------------------------------------------------------------ *
 * Turns in like the phone — same family of movement, deliberately, since
 * both are hand-held slabs — but landscape, shallower (about 150° rather
 * than 198°) and slower out of the corner, because the payoff here is not
 * the turn: it is what draws itself on the canvas once it lands.
 */
function buildTabletFull(tl: gsap.core.Timeline): void {
  const T = TABLET_CUE;
  const span = T.done - T.a;

  tl.fromTo(
    '[data-obj="tablet"]',
    { x: () => vw(101), y: () => vh(14 + topClear()), scale: 0.5, opacity: 0 },
    { opacity: 1, duration: span * 0.28 },
    T.a
  )
    .to(
      '[data-obj="tablet"]',
      { x: () => vw(74), duration: span * 0.62, ease: 'power2.out' },
      T.a
    )
    .to('[data-obj="tablet"]', { x: () => vw(62), duration: span * 0.5, ease: 'power3.out' }, T.a + span * 0.5)
    .to(
      '[data-obj="tablet"]',
      { y: () => vh(40), duration: span * 0.72, ease: 'power1.out' },
      T.a
    )
    .to('[data-obj="tablet"]', { y: () => vh(49), duration: span * 0.35, ease: 'power2.inOut' }, T.a + span * 0.7)
    .to('[data-obj="tablet"]', { scale: 0.84, duration: span * 0.55, ease: 'power2.out' }, T.a)
    .to('[data-obj="tablet"]', { scale: 1, duration: span * 0.5, ease: 'power3.out' }, T.a + span * 0.5);

  // 152° of turn: enough to show the back and cross the profile, not so
  // much that it competes with the phone's entrance from the same corner.
  tl.fromTo(
    '[data-spin="tablet"]',
    { rotationX: -14, rotationY: 148, rotationZ: 16 },
    { rotationX: -6, rotationY: 62, rotationZ: 8, duration: span * 0.55, ease: 'power2.in' },
    T.a
  ).to(
    '[data-spin="tablet"]',
    { rotationX: -3, rotationY: -4, rotationZ: 2, duration: span * 0.5, ease: 'power3.out' },
    T.a + span * 0.5
  );

  tl.fromTo(
    '[data-tablet-off]',
    { opacity: 1 },
    { opacity: 0, duration: span * 0.3, ease: 'power2.out' },
    T.wake
  );

  /* The canvas. Guides first, then the mark draws itself, then the palette
     lands one swatch at a time. It reads as a designer working, which is
     the whole claim of the beat. */
  const draw = T.drawTo - T.drawFrom;
  tl.fromTo(
    '[data-brand-guides]',
    { opacity: 0 },
    { opacity: 1, duration: draw * 0.18, ease: 'power1.out' },
    T.drawFrom
  );

  document.querySelectorAll<SVGPathElement>('[data-brand-stroke]').forEach((path, i) => {
    tl.fromTo(
      path,
      { strokeDashoffset: () => path.getTotalLength() },
      { strokeDashoffset: 0, duration: draw * 0.46, ease: 'power1.inOut' },
      T.drawFrom + draw * (0.12 + i * 0.28)
    );
  });

  tl.fromTo(
    '[data-brand-swatch]',
    { opacity: 0, scale: 0.7 },
    { opacity: 1, scale: 1, duration: draw * 0.12, stagger: draw * 0.06, ease: 'back.out(2)' },
    T.drawFrom + draw * 0.5
  );

  exitRight(tl, 'tablet', T.outFrom, T.outTo);
}

/* ------------------------------------------------------------------ *
 * Small screens — same beats, none of the 3D
 * ------------------------------------------------------------------ *
 * A 198° turn and a hinged lid are desktop pleasures: on a phone they
 * cost frames, they are read at a quarter of the size, and half of the
 * arc happens off-canvas. Translate, scale and fade only. The lid is
 * pinned open and the devices are pinned square to camera.
 */
function buildDevicesCompact(tl: gsap.core.Timeline): void {
  gsap.set('[data-laptop-lid]', { rotationX: 0 });
  gsap.set('[data-spin="phone"]', { rotationX: 0, rotationY: 0, rotationZ: 0 });
  gsap.set('[data-spin="laptop"]', { rotationX: -4, rotationY: 0, rotationZ: 0 });
  gsap.set('[data-spin="monitor"]', { rotationX: -3, rotationY: 0, rotationZ: 0 });
  gsap.set('[data-spin="tablet"]', { rotationX: 0, rotationY: 0, rotationZ: 0 });
  gsap.set('[data-phone-off], [data-laptop-off], [data-tablet-off]', { opacity: 0 });
  gsap.set('[data-laptop-shadow]', { opacity: 0.7, scaleX: 0.9, scaleY: 0.8 });
  gsap.set('[data-monitor-shadow]', { opacity: 0.7, scaleX: 0.9, scaleY: 0.8 });
  gsap.set('.laptop__shadow-tight', { opacity: 1 });
  gsap.set('[data-brand-guides]', { opacity: 1 });

  /* Same five beats, none of the 3D. Each device rises, holds the centre
     and then fades out — no corner stack: at this width four parked
     devices would be four illegible smudges, and the copy is doing the
     work anyway. */
  const show: Array<[string, number, number, number]> = [
    ['phone', 0.14, 0.62, 0.3],
    ['laptop', 0.34, 0.68, 0.5],
    ['monitor', 0.53, 0.66, 0.69],
    ['tablet', 0.7, 0.64, 0.85],
  ];

  for (const [key, at, restY, out] of show) {
    tl.fromTo(
      `[data-obj="${key}"]`,
      { x: () => vw(54), y: () => vh(restY + 34), scale: 0.88, opacity: 0 },
      { y: () => vh(restY), scale: 1, opacity: 1, duration: 0.075, ease: 'power3.out' },
      at
    ).to(
      `[data-obj="${key}"]`,
      { y: () => vh(restY - 8), scale: 0.72, opacity: 0, duration: 0.05, ease: 'power2.inOut' },
      out
    );
  }

  // The canvas still draws itself — it is the point of the brand beat.
  document.querySelectorAll<SVGPathElement>('[data-brand-stroke]').forEach((path, i) => {
    tl.fromTo(
      path,
      { strokeDashoffset: () => path.getTotalLength() },
      { strokeDashoffset: 0, duration: 0.03, ease: 'power1.inOut' },
      0.755 + i * 0.02
    );
  });
  tl.fromTo(
    '[data-brand-swatch]',
    { opacity: 0, scale: 0.7 },
    { opacity: 1, scale: 1, duration: 0.012, stagger: 0.006 },
    0.79
  );
  const cLine = q<SVGPathElement>('[data-ui-line]');
  if (cLine) {
    tl.fromTo(
      cLine,
      { strokeDashoffset: () => cLine.getTotalLength() },
      { strokeDashoffset: 0, duration: 0.04, ease: 'power1.inOut' },
      0.575
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reduced motion — coherent static composition, beats by fade only
 * ------------------------------------------------------------------ */
function buildReduced(): void {
  gsap.set(STAGE_OBJS, { xPercent: -50, yPercent: -50 });
  gsap.set('[data-laptop-shadow], [data-monitor-shadow]', {
    xPercent: -50,
    yPercent: -50,
    opacity: 0.7,
  });
  gsap.set('.laptop__shadow-tight', { opacity: 1 });
  // No turn, no hinge: the laptop is simply open and the phone simply
  // faces you. Nothing here depends on having seen it move.
  gsap.set('[data-laptop-lid]', { rotationX: 0 });
  gsap.set('[data-spin="laptop"]', { rotationX: -7, rotationY: -4, rotationZ: 0 });
  gsap.set('[data-spin="phone"]', { rotationX: 0, rotationY: -6, rotationZ: 2 });
  gsap.set('[data-spin="monitor"]', { rotationX: -5, rotationY: -3, rotationZ: 0 });
  gsap.set('[data-spin="tablet"]', { rotationX: -3, rotationY: -4, rotationZ: 1 });
  gsap.set('[data-phone-off], [data-laptop-off], [data-tablet-off]', { opacity: 0 });

  /* One coherent still life instead of a sequence: all five services on
     stage at once, the laptop leading and the rest arranged around it.
     Nothing here depends on having watched anything move. */
  gsap.set('[data-obj="laptop"]', { x: vw(34), y: vh(52), scale: 0.62, opacity: 1 });
  gsap.set('[data-obj="monitor"]', { x: vw(56), y: vh(36), scale: 0.5, opacity: 0.92 });
  gsap.set('[data-obj="tablet"]', { x: vw(52), y: vh(64), scale: 0.44, opacity: 0.92 });
  gsap.set('[data-obj="phone"]', { x: vw(72), y: vh(60), scale: 0.34, opacity: 0.9 });
  gsap.set('[data-obj="flow"]', { x: vw(80), y: vh(38), scale: 0.7, opacity: 1 });
  gsap.set('[data-brand-guides]', { opacity: 1 });
  gsap.set('[data-brand-swatch]', { opacity: 1, scale: 1 });
  gsap.set('[data-brand-stroke], [data-ui-line]', { strokeDashoffset: 0 });
  /* Reduced motion shows the closing composition as a still, so the cards
     are visible from the start and must be usable from the start. */
  gsap.set('[data-flow-node]', { opacity: 1 });
  for (const el of document.querySelectorAll<HTMLElement>('[data-flow-node]')) el.inert = false;
  gsap.set('[data-flow-aura]', { opacity: 1, scale: 1 });
  gsap.set('[data-flow-core]', { opacity: 1, scale: 1, y: 0 });
  gsap.set('[data-flow-orbit], [data-flow-point]', { opacity: 1 });
  gsap.set('[data-header-capsule]', { opacity: 1, y: 0, scale: 1 });
  gsap.set('[data-intro-text]', { opacity: 0 });
  gsap.set('[data-intro-cue]', { opacity: 0 });
  gsap.set('[data-beat-copy]', { opacity: 0 });
  gsap.set('[data-beat-copy="growth"]', { opacity: 1 });
  gsap.set('[data-copy-cloud]', { opacity: 1, scale: 1, y: 0 });
  gsap.set('[data-beat-line]', { opacity: 1, yPercent: 0, scale: 1 });
  gsap.set('[data-beat-sub]', { opacity: 1, y: 0 });
}

/* ------------------------------------------------------------------ *
 * Debug layers
 * ------------------------------------------------------------------ */
interface HudState {
  p: number;
  beat: (typeof beats)[number];
  local: number;
  reel: string;
}

function initDebug(getState: () => HudState): void {
  const ab = q('[data-asset-overlay]');
  const hud = q('[data-hud]');
  const host = q('[data-hud-boxes]');
  const stage = q<HTMLElement>('[data-stage]');
  const params = new URLSearchParams(window.location.search);
  if (ab && params.get('boxes') === '1') ab.hidden = false;
  if (hud && params.get('hud') === '1') hud.hidden = false;
  if (stage && params.get('faces') === '1') stage.dataset.faces = '1';

  const tracked: Array<[string, string]> = [
    ['intro', '[data-intro-text]'],
    ['header', '[data-header-capsule]'],
    ['copy-social', '[data-beat-copy="social"]'],
    ['copy-web', '[data-beat-copy="web"]'],
    ['copy-software', '[data-beat-copy="software"]'],
    ['copy-brand', '[data-beat-copy="brand"]'],
    ['copy-growth', '[data-beat-copy="growth"]'],
    ['phone', '[data-obj="phone"]'],
    ['laptop', '[data-obj="laptop"]'],
    ['monitor', '[data-obj="monitor"]'],
    ['tablet', '[data-obj="tablet"]'],
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

  const deg = (el: Element | null, prop: string): number =>
    el ? Number(gsap.getProperty(el, prop)) : 0;

  const triplet = (sel: string): string => {
    const el = q(sel);
    if (!el) return '—';
    return `${deg(el, 'rotationX').toFixed(1)} / ${deg(el, 'rotationY').toFixed(1)} / ${deg(
      el,
      'rotationZ'
    ).toFixed(1)}°`;
  };

  const span = (p: number, from: number, to: number): string =>
    `${Math.round(clamp01((p - from) / (to - from)) * 100)} %`;

  const render = (): void => {
    if (!hud || hud.hidden) return;
    const { p, beat, local, reel } = getState();
    const set = (sel: string, v: string): void => {
      const el = q(sel);
      if (el) el.textContent = v;
    };
    set('[data-hud-progress]', p.toFixed(3));
    set('[data-hud-beat]', `${beat.n} · ${beat.label}`);
    set('[data-hud-local]', local.toFixed(3));
    set('[data-hud-range]', `${Math.round(beat.from * 100)} – ${Math.round(beat.to * 100)} %`);

    /* --- device telemetry ------------------------------------------ */
    set('[data-hud-rot="phone"]', triplet('[data-spin="phone"]'));
    set('[data-hud-rot="laptop"]', triplet('[data-spin="laptop"]'));
    set('[data-hud-rot="monitor"]', triplet('[data-spin="monitor"]'));
    set('[data-hud-rot="tablet"]', triplet('[data-spin="tablet"]'));

    const lid = q('[data-laptop-lid]');
    const lidX = deg(lid, 'rotationX');
    set(
      '[data-hud-lid]',
      lid ? `${lidX.toFixed(1)}°  ${lidX < -80 ? '· cerrada' : lidX > -4 ? '· abierta' : '· abriendo'}` : '—'
    );

    set('[data-hud-entry="phone"]', span(p, PHONE_CUE.a, PHONE_CUE.c));
    set('[data-hud-entry="laptop"]', span(p, LAPTOP_CUE.a, LAPTOP_CUE.done));
    set('[data-hud-entry="monitor"]', span(p, MONITOR_CUE.a, MONITOR_CUE.done));
    set('[data-hud-entry="tablet"]', span(p, TABLET_CUE.a, TABLET_CUE.done));

    // How many services have finished and parked in the corner.
    const parked = [PHONE_CUE.outTo, LAPTOP_CUE.outTo, MONITOR_CUE.outTo, TABLET_CUE.outTo]
      .filter((t) => p >= t).length;
    set('[data-hud-stack]', `${parked} / 4 en la esquina`);
    set('[data-hud-reel]', reel);

    const track = q<HTMLElement>('[data-laptop-track]');
    if (track) {
      const active = track.dataset.hasCapture === '1';
      set(
        '[data-hud-dz]',
        active
          ? `${Number(gsap.getProperty(track, 'yPercent')).toFixed(1)} %  ${
              p >= LAPTOP_CUE.scrollFrom && p <= LAPTOP_CUE.scrollTo ? '· activo' : '· parado'
            }`
          : 'sin captura (USR-01)'
      );
    }

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
    if (e.key === 'f' || e.key === 'F') {
      if (stage) stage.dataset.faces = stage.dataset.faces === '1' ? '0' : '1';
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
  const stage = q<HTMLElement>('[data-stage]');
  if (!stage) return;

  /* Published to the DOM as well as read below, because the sky is now
     partly animated in CSS — the cloud drift, the bird flap, the light
     breathing. A stability probe that parks the scroll and screenshots the
     same clip twice must get two identical PNGs, and it cannot do that
     while a cloud is crossing the frame. global.css pauses every animation
     under this attribute. Review harness only. */
  if (new URLSearchParams(window.location.search).get('still') === '1') {
    stage.dataset.still = '1';
  }

  fitIntro();

  /* Outside matchMedia on purpose. Every other interactive layer belongs
     to one branch of the choreography; the sun belongs to none of them —
     it is on screen for the whole hero, in every branch, including
     reduced motion, where it runs a shorter version of the same
     sequence. Skipped only for the review harness. */
  if (stage.dataset.still !== '1') sunSignature();

  let progress = 0;
  const reel = reelController();

  const stateOf = (): HudState => {
    const beat = beats.find((b) => progress < b.to) ?? beats[beats.length - 1];
    const local = (progress - beat.from) / (beat.to - beat.from);
    return { p: progress, beat, local: clamp01(local), reel: reel.label };
  };

  const mm = gsap.matchMedia();
  mm.add(
    {
      /* 1020, not 1200 or 1280: a 1020-wide laptop screen gets the WHOLE
         hero — statement, phone turn, reel, lid opening, keyboard, growth.
         Only the proportions give way, via the breakpoints and --dev-k in
         tokens.css. Below 1020 the choreography is genuinely simplified. */
      full: '(prefers-reduced-motion: no-preference) and (min-width: 1020px)',
      compact: '(prefers-reduced-motion: no-preference) and (max-width: 1019px)',
      reduced: '(prefers-reduced-motion: reduce)',
    },
    (ctx) => {
      const { full, compact } = ctx.conditions as {
        full: boolean;
        compact: boolean;
        reduced: boolean;
      };

      if (!full && !compact) {
        openingSequence(true);
        buildReduced();
        // Beats still advance so no content is ever unreachable.
        ScrollTrigger.create({
          trigger: '[data-hero]',
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: (self) => {
            progress = self.progress;
            const { beat } = stateOf();
            stage.setAttribute('data-beat', String(beat.n));
          },
        });
        return undefined;
      }

      /* `?still=1` freezes the idle float and the cursor parallax so a
         scripted probe can capture the SAME frame twice and compare it
         byte for byte. Without it every capture differs by the float's
         own drift and a stability test proves nothing. Review harness
         only — see scripts/diagnose-faces.mjs. */
      const still = new URLSearchParams(window.location.search).get('still') === '1';

      const activity = stageActivity();
      const setFloat = floatController(activity);
      const pointer = cursorParallax(activity);
      const setLife = monitorLife(activity);
      /* Sky events are a desktop affordance. Below 1020 the copy moves up
         to 12vh — into the exact band the birds and the jet cross — so
         there is nowhere for them to go that is not on top of a headline.
         Reduced motion never reaches this branch at all. */
      const sky = full && !still ? skyLife(activity) : null;

      const spinPhone = q('[data-spin="phone"]');
      let lastBeat = -1;

      const onRender = (p: number): void => {
        progress = p;

        const { beat } = stateOf();
        if (beat.n !== lastBeat) {
          lastBeat = beat.n;
          stage.setAttribute('data-beat', String(beat.n));
        }

        /* Before `still`: this is not decoration, and a review capture
           must not leave five live links over an empty sky either. */
        for (const c of CARD_LIVE) c.card.inert = !(p >= c.from && p < c.to);

        if (still) return;

        sky?.update(p);

        if (full) {
          // The reel follows the device's rendered rotation, so it can
          // never run while the screen is turned away.
          reel.update(p, spinPhone ? Number(gsap.getProperty(spinPhone, 'rotationY')) : 0);

          /* Float from the moment a device settles until the scene
             leaves — including all the time it spends in the corner
             stack, because a stack of dead rectangles looks dead.
             Cursor parallax, by contrast, is ONLY for the protagonist:
             four devices reacting to the mouse at once would be noise. */
          const settled: Array<[DeviceKey, number, number]> = [
            ['phone', PHONE_CUE.c, PHONE_CUE.outFrom],
            ['laptop', LAPTOP_CUE.done, LAPTOP_CUE.outFrom],
            ['monitor', MONITOR_CUE.done, MONITOR_CUE.outFrom],
            ['tablet', TABLET_CUE.done, TABLET_CUE.outFrom],
          ];
          for (const [key, done, out] of settled) {
            // Both stop at `out`: once it is on its way off stage, an idle
            // drift only fights the exit.
            setFloat(key, p >= done && p < out);
            pointer.setActive(key, p >= done && p < out);
          }
          setFloat('flow', p >= 0.83 && p < 0.955);
          // The interface runs from the moment the panel is square to
          // camera until the machine starts leaving.
          setLife(p >= MONITOR_CUE.done - 0.02 && p < MONITOR_CUE.outFrom + 0.01);
        } else {
          reel.update(p, 0);
          setFloat('phone', p >= 0.22 && p < 0.34);
          setFloat('laptop', p >= 0.42 && p < 0.54);
          setFloat('monitor', p >= 0.58 && p < 0.7);
          setFloat('tablet', p >= 0.74 && p < 0.86);
          setFloat('flow', p >= 0.83 && p < 0.955);
          setLife(p >= 0.56 && p < 0.7);
        }
      };

      openingSequence(false);
      buildTimeline(full ? 'full' : 'compact', onRender);

      return () => {
        sky?.dispose();
        pointer.dispose();
        activity.dispose();
      };
    }
  );

  initDebug(stateOf);
}
