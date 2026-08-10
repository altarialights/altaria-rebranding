import gsap from 'gsap';

/**
 * The sun is independent from the scrubbed hero timeline. It paints a
 * temporary atmosphere above the scene, then restores every node to its
 * CSS starting state. No click creates DOM and no 3D ancestor is faded.
 */

interface Nodes {
  hit: HTMLElement;
  core: HTMLElement;
  veil: HTMLElement;
  intro: HTMLElement;
  line: HTMLElement;
  rays: HTMLElement;
  flare: HTMLElement;
  mist: HTMLElement;
  bubble: HTMLElement;
  clouds: HTMLElement[];
  particles: HTMLElement[];
  backdrops: HTMLElement[];
  sun: HTMLElement | null;
}

export interface SunSignature {
  dispose(): void;
}

const SCROLL_BAIL = 140;

export function sunSignature(): SunSignature | null {
  const hit = document.querySelector<HTMLElement>('[data-sun-hit]');
  const core = document.querySelector<HTMLElement>('[data-sun-core]');
  const veil = document.querySelector<HTMLElement>('[data-sig-veil]');
  const intro = document.querySelector<HTMLElement>('[data-sig-intro]');
  const line = document.querySelector<HTMLElement>('[data-sig-line]');
  const rays = document.querySelector<HTMLElement>('[data-sig-rays]');
  const flare = document.querySelector<HTMLElement>('[data-sig-flare]');
  const mist = document.querySelector<HTMLElement>('[data-sig-mist]');
  const bubble = document.querySelector<HTMLElement>('[data-sig-bubble]');

  if (!hit || !core || !veil || !intro || !line || !rays || !flare || !mist || !bubble) return null;

  const n: Nodes = {
    hit,
    core,
    veil,
    intro,
    line,
    rays,
    flare,
    mist,
    bubble,
    clouds: Array.from(document.querySelectorAll<HTMLElement>('[data-sig-cloud]')),
    particles: Array.from(document.querySelectorAll<HTMLElement>('[data-sig-particle]')),
    backdrops: Array.from(document.querySelectorAll<HTMLElement>('[data-sig-backdrop]')),
    sun: document.querySelector<HTMLElement>('[data-sky-sun]'),
  };
  const layer = hit.closest<HTMLElement>('[data-sun-layer]');

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const roomy = (): boolean => window.innerWidth >= 1020;

  let told = false;
  let clickCount = 0;
  let hovering = false;
  let showing: gsap.core.Timeline | null = null;
  let boostTl: gsap.core.Timeline | null = null;
  let bubbleTl: gsap.core.Timeline | null = null;
  let releaseCall: gsap.core.Tween | null = null;
  let scrollOrigin = 0;

  const prepareCompositor = (): void => {
    releaseCall?.kill();
    releaseCall = null;
    layer?.classList.add('is-compositor-ready');
  };

  const releaseCompositor = (delay = 0.12): void => {
    releaseCall?.kill();
    releaseCall = gsap.delayedCall(delay, () => {
      releaseCall = null;
      if (hovering || showing || boostTl || bubbleTl) return;
      layer?.classList.remove('is-compositor-ready');
    });
  };

  const glow = (on: boolean): void => {
    hovering = on;
    if (showing) return;
    if (on) prepareCompositor();
    gsap.to(n.core, {
      opacity: on ? 0.55 : 0,
      scale: on ? 1 : 0.86,
      duration: on ? 0.5 : 0.7,
      ease: on ? 'power2.out' : 'power2.inOut',
      overwrite: 'auto',
    });

    if (n.sun && !calm.matches) {
      gsap.to(n.sun, {
        scale: on ? 1.045 : 1,
        duration: on ? 0.6 : 0.9,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }

    if (!on) releaseCompositor(0.82);
  };

  const pulse = (): gsap.core.Timeline =>
    gsap
      .timeline()
      .to(n.core, { scale: 0.9, opacity: 0.78, duration: 0.1, ease: 'power2.in', overwrite: 'auto' })
      .to(n.core, { scale: 1.34, opacity: 0.9, duration: 0.32, ease: 'power2.out' })
      .to(n.core, {
        scale: hovering ? 1 : 0.86,
        opacity: hovering ? 0.55 : 0,
        duration: 0.66,
        ease: 'power2.inOut',
      });

  /** Later clicks acknowledge the user without replaying the reveal. */
  const intensify = (): void => {
    prepareCompositor();
    boostTl?.kill();
    const active = Boolean(showing);
    boostTl = gsap
      .timeline({
        onComplete: () => {
          boostTl = null;
          releaseCompositor();
        },
      })
      .to(n.flare, {
        opacity: 0.96,
        scale: 1.1,
        duration: 0.18,
        ease: 'power2.out',
        overwrite: 'auto',
      })
      .to(n.rays, { opacity: active ? 0.68 : 0.26, duration: 0.16, ease: 'power2.out' }, 0)
      .to(n.flare, {
        opacity: active ? 0.58 : 0,
        scale: 0.96,
        duration: 0.55,
        ease: 'power2.inOut',
      })
      .to(n.rays, { opacity: active ? 0.38 : 0, duration: 0.5, ease: 'power2.inOut' }, 0.2);

    if (n.sun && !calm.matches) {
      boostTl
        .to(n.sun, { scale: 1.085, duration: 0.18, ease: 'power2.out', overwrite: 'auto' }, 0)
        .to(n.sun, { scale: hovering ? 1.045 : 1, duration: 0.55, ease: 'power2.inOut' }, 0.18);
    }
  };

  const showBubble = (): void => {
    prepareCompositor();
    bubbleTl?.kill();
    bubbleTl = gsap
      .timeline({
        onComplete: () => {
          bubbleTl = null;
          releaseCompositor();
        },
      })
      .set(n.bubble, { opacity: 0, scale: 0.84, y: -5, rotation: -2 })
      .to(n.bubble, {
        opacity: 1,
        scale: 1,
        y: 0,
        rotation: 0,
        duration: calm.matches ? 0.18 : 0.38,
        ease: calm.matches ? 'power2.out' : 'back.out(2.2)',
      })
      .to(n.bubble, { y: 6, duration: 1.35, ease: 'sine.inOut' }, '>')
      .to(n.bubble, { opacity: 0, scale: 0.96, duration: 0.32, ease: 'power2.in' }, '>-0.2')
      .set(n.bubble, { clearProps: 'all' });
  };

  const onScrollAway = (): void => {
    if (!showing || Math.abs(window.scrollY - scrollOrigin) < SCROLL_BAIL) return;
    window.removeEventListener('scroll', onScrollAway);
    gsap.to(showing, { timeScale: 2.8, duration: 0.28, ease: 'power2.in', overwrite: true });
  };

  const say = (): void => {
    prepareCompositor();
    const soft = calm.matches;
    const cloudsTarget = [0.72, 0.67, 0.48];
    const decor = [...n.clouds, ...n.particles, ...n.backdrops, n.rays, n.flare, n.mist];

    const tl = gsap.timeline({
      onComplete: () => {
        showing = null;
        window.removeEventListener('scroll', onScrollAway);
        gsap.set([n.intro, n.line, n.veil, ...decor], { clearProps: 'all' });
        releaseCompositor();
      },
    });
    showing = tl;

    tl.add(pulse(), 0)
      .to(n.veil, { opacity: 1, duration: soft ? 0.28 : 0.72, ease: 'power2.out' }, 0.03)
      .fromTo(
        n.mist,
        { opacity: 0, y: soft ? 0 : 18 },
        { opacity: 1, y: 0, duration: soft ? 0.3 : 1.05, ease: 'power2.out' },
        0.12
      );

    if (n.sun && !soft) {
      tl.to(n.sun, { scale: 1.14, duration: 0.56, ease: 'power2.out' }, 0).to(
        n.sun,
        { scale: hovering ? 1.045 : 1, duration: 1.15, ease: 'power2.inOut' },
        0.56
      );
    }

    if (!soft) {
      tl.fromTo(
        n.rays,
        { opacity: 0, scale: 0.82, rotation: -10 },
        { opacity: 0.3, scale: 1, rotation: 0, duration: 1.25, ease: 'power2.out' },
        0.08
      )
        .fromTo(
          n.flare,
          { opacity: 0, scale: 0.78 },
          { opacity: 0.58, scale: 0.96, duration: 0.92, ease: 'power2.out' },
          0.08
        )
        .fromTo(
          n.clouds,
          { opacity: 0, y: 34 },
          {
            opacity: (index: number) => cloudsTarget[index] ?? 0.68,
            y: 0,
            duration: 1.15,
            stagger: 0.09,
            ease: 'power3.out',
          },
          0.16
        )
        .fromTo(
          n.particles,
          { opacity: 0, scale: 0.3 },
          { opacity: 0.82, scale: 1, duration: 0.52, stagger: 0.035, ease: 'power2.out' },
          0.5
        );
    } else {
      tl.set(n.rays, { opacity: 0 })
        .to(n.flare, { opacity: 0.5, duration: 0.25 }, 0.08)
        .to(n.clouds, { opacity: (index: number) => cloudsTarget[index] ?? 0.68, duration: 0.28 }, 0.1)
        .to(n.particles, { opacity: 0.66, duration: 0.25 }, 0.14);
    }

    tl.fromTo(
      n.backdrops,
      { opacity: 0, y: soft ? 0 : 12 },
      { opacity: 0.76, y: 0, duration: soft ? 0.25 : 0.8, stagger: 0.1, ease: 'power2.out' },
      0.38
    )
      .fromTo(
        n.intro,
        { opacity: 0, y: soft ? 0 : 12 },
        { opacity: 1, y: 0, duration: soft ? 0.25 : 0.52, ease: 'power2.out' },
        0.52
      )
      .fromTo(
        n.line,
        { opacity: 0, scale: soft ? 1 : 1.055, y: soft ? 0 : 16, filter: soft ? 'none' : 'blur(16px)' },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: soft ? 0.32 : 0.78,
          ease: 'power3.out',
        },
        0.72
      );

    const hold = soft ? 3.3 : 5.4;
    tl.to(n.intro, { opacity: 0, y: soft ? 0 : -8, duration: 0.42, ease: 'power2.in' }, hold)
      .to(
        n.line,
        {
          opacity: 0,
          scale: soft ? 1 : 1.035,
          y: soft ? 0 : -14,
          filter: soft ? 'none' : 'blur(12px)',
          duration: soft ? 0.42 : 0.76,
          ease: 'power2.in',
        },
        hold + 0.08
      )
      .to(n.backdrops, { opacity: 0, duration: 0.5, ease: 'power2.in' }, hold + 0.12)
      .to(n.particles, { opacity: 0, scale: 0.4, duration: 0.46, stagger: 0.015, ease: 'power2.in' }, hold + 0.12)
      .to(n.clouds, { opacity: 0, y: 24, duration: 0.72, ease: 'power2.inOut' }, hold + 0.18)
      .to([n.rays, n.flare, n.mist], { opacity: 0, duration: 0.62, ease: 'power2.inOut' }, hold + 0.24)
      .to(n.veil, { opacity: 0, duration: 0.78, ease: 'power2.inOut' }, hold + 0.34);

    scrollOrigin = window.scrollY;
    window.addEventListener('scroll', onScrollAway, { passive: true });
  };

  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    prepareCompositor();

    if (!roomy()) {
      pulse().eventCallback('onComplete', () => releaseCompositor());
      return;
    }

    clickCount += 1;
    if (!told) {
      told = true;
      say();
      return;
    }

    intensify();
    if (clickCount >= 3) showBubble();
  };

  const onPointerDown = (): void => {
    prepareCompositor();
    /* Pointerdown precedes click, giving the browser a frame boundary in
       which to honour the compositor hints before the strong reveal. */
    releaseCompositor(1.5);
  };
  const onEnter = (): void => glow(true);
  const onLeave = (): void => glow(false);

  hit.addEventListener('pointerdown', onPointerDown, { passive: true });
  hit.addEventListener('click', onClick);
  hit.addEventListener('mouseenter', onEnter);
  hit.addEventListener('mouseleave', onLeave);
  hit.addEventListener('focus', onEnter);
  hit.addEventListener('blur', onLeave);

  return {
    dispose(): void {
      hit.removeEventListener('pointerdown', onPointerDown);
      hit.removeEventListener('click', onClick);
      hit.removeEventListener('mouseenter', onEnter);
      hit.removeEventListener('mouseleave', onLeave);
      hit.removeEventListener('focus', onEnter);
      hit.removeEventListener('blur', onLeave);
      window.removeEventListener('scroll', onScrollAway);

      showing?.kill();
      boostTl?.kill();
      bubbleTl?.kill();
      releaseCall?.kill();
      showing = null;
      boostTl = null;
      bubbleTl = null;
      releaseCall = null;
      layer?.classList.remove('is-compositor-ready');

      const all = [
        n.core,
        n.veil,
        n.intro,
        n.line,
        n.rays,
        n.flare,
        n.mist,
        n.bubble,
        ...n.clouds,
        ...n.particles,
        ...n.backdrops,
        ...(n.sun ? [n.sun] : []),
      ];
      gsap.killTweensOf(all);
      gsap.set(all, { clearProps: 'all' });
    },
  };
}
