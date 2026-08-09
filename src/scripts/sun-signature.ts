import gsap from 'gsap';

/**
 * The sun easter egg.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS NOT IN sky-life.ts
 * ------------------------------------------------------------------
 * The birds, the jet and the rocket are scheduled: they exist for a few
 * seconds at four points of the scroll and are gone. The sun is on screen
 * for the whole hero and belongs to no beat, so it has no schedule and no
 * arming — it is simply always there, waiting.
 *
 * It also has to work where the sky events deliberately do not. Under
 * reduced motion the flock never flies, because a flock is motion for its
 * own sake; but the studio's signature is content, and removing content
 * because someone is sensitive to movement would be the wrong reading of
 * that preference. So the whole thing runs there too, on a shorter, flatter
 * version of the same sequence.
 *
 * ------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ------------------------------------------------------------------
 * It never touches the master timeline, never moves the scroll, never
 * changes the opacity of anything the timeline owns. The dimming is a
 * separate veil painted over the scene — the moment a reaction writes to
 * a property the scrub also writes to, the next wheel tick undoes it and
 * the two fight for the rest of the page.
 */

interface Nodes {
  hit: HTMLElement;
  core: HTMLElement;
  veil: HTMLElement;
  sig: HTMLElement;
  intro: HTMLElement;
  line: HTMLElement;
  sun: HTMLElement | null;
}

export interface SunSignature {
  dispose(): void;
}

/** How much scrolling it takes to decide the user has moved on. */
const SCROLL_BAIL = 140;

export function sunSignature(): SunSignature | null {
  const hit = document.querySelector<HTMLElement>('[data-sun-hit]');
  const core = document.querySelector<HTMLElement>('[data-sun-core]');
  const veil = document.querySelector<HTMLElement>('[data-sig-veil]');
  const sig = document.querySelector<HTMLElement>('[data-sig]');
  const intro = document.querySelector<HTMLElement>('[data-sig-intro]');
  const line = document.querySelector<HTMLElement>('[data-sig-line]');
  if (!hit || !core || !veil || !sig || !intro || !line) return null;

  const n: Nodes = { hit, core, veil, sig, intro, line, sun: document.querySelector('[data-sky-sun]') };
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  /* The message needs room. Below the full desktop experience the copy
     climbs into the middle of the frame and there is nowhere to put a
     five-word headline that is not on top of it, so the sun still reacts
     but it does not speak. */
  const roomy = (): boolean => window.innerWidth >= 1020;

  let told = false;
  let showing: gsap.core.Timeline | null = null;
  let hovering = false;

  /* --- Hover ------------------------------------------------------- *
   * The whole affordance. The halo swells about four per cent and a
   * warm disc comes up under it: enough that the sun looks like it
   * noticed the cursor, not enough that anyone would call it a button.
   * Deliberately slow on the way in and slower on the way out — a snappy
   * hover state is exactly what would give it away. */
  const glow = (on: boolean): void => {
    if (showing) return;
    hovering = on;
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
  };

  /** The press itself — squash, then bloom. Used on every click. */
  const pulse = (): gsap.core.Timeline =>
    gsap
      .timeline()
      .to(n.core, { scale: 0.88, opacity: 0.75, duration: 0.11, ease: 'power2.in' })
      .to(n.core, { scale: 1.34, opacity: 0.82, duration: 0.34, ease: 'power2.out' })
      .to(
        n.core,
        { scale: hovering ? 1 : 0.86, opacity: hovering ? 0.55 : 0, duration: 0.7, ease: 'power2.inOut' },
        '>-0.05'
      );

  const say = (): void => {
    const soft = calm.matches;
    const tl = gsap.timeline({
      onComplete: () => {
        showing = null;
        window.removeEventListener('scroll', onScrollAway);
      },
    });
    showing = tl;

    // 1 · the sun answers, and the halo opens up behind it.
    tl.add(pulse(), 0);
    if (n.sun && !soft) {
      tl.to(n.sun, { scale: 1.13, duration: 0.5, ease: 'power2.out' }, 0).to(
        n.sun,
        { scale: hovering ? 1.045 : 1, duration: 1.1, ease: 'power2.inOut' },
        0.5
      );
    }

    // 2 · the sky settles. Never a black scrim — a soft deepening that
    // is strongest where the words are about to be.
    tl.to(n.veil, { opacity: 1, duration: soft ? 0.3 : 0.55, ease: 'power2.out' }, 0.05);

    // 3 · the credit line, then the line that matters.
    tl.fromTo(
      n.intro,
      { opacity: 0, y: soft ? 0 : 10 },
      { opacity: 1, y: 0, duration: soft ? 0.3 : 0.5, ease: 'power2.out' },
      0.24
    );

    if (soft) {
      tl.fromTo(n.line, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' }, 0.44);
    } else {
      /* Arrives slightly large and slightly out of focus and resolves —
         the same "condensing out of the sky" idea the opening statement
         dissolves INTO, run backwards. */
      tl.fromTo(
        n.line,
        { opacity: 0, scale: 1.06, filter: 'blur(14px)' },
        {
          opacity: 1,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.66,
          ease: 'power3.out',
        },
        0.4
      )
        // 4 · sunlight crossing the letters. Once, quickly, warm.
        .fromTo(
          n.line,
          { backgroundPosition: '140% 0' },
          { backgroundPosition: '-40% 0', duration: 0.92, ease: 'power2.inOut' },
          0.72
        );
    }

    const hold = soft ? 2.1 : 2.35;
    const out = soft ? 1.3 : 1.06;

    /* 5 · it comes apart rather than switching off. The line loses
       density and drifts up as it goes: vapour, not a fade. */
    if (soft) {
      tl.to(n.line, { opacity: 0, duration: 0.45, ease: 'power2.in' }, hold)
        .to(n.intro, { opacity: 0, duration: 0.4, ease: 'power2.in' }, hold - 0.1);
    } else {
      tl.to(n.intro, { opacity: 0, y: -8, duration: 0.5, ease: 'power2.in' }, hold - 0.12)
        .to(
          n.line,
          {
            opacity: 0,
            scale: 1.05,
            y: -16,
            filter: 'blur(16px)',
            duration: 0.9,
            ease: 'power2.in',
          },
          hold
        );
    }

    tl.to(n.veil, { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, hold + out * 0.35);
    // Leave the nodes exactly as they were found.
    tl.set([n.line, n.intro], { clearProps: 'all' });

    /* If the user carries on scrolling, the moment gets out of the way
       instead of hanging over a beat it no longer belongs to. It is not
       cancelled — it finishes, just faster. */
    let from = window.scrollY;
    const onScrollAway = (): void => {
      if (Math.abs(window.scrollY - from) < SCROLL_BAIL) return;
      window.removeEventListener('scroll', onScrollAway);
      gsap.to(tl, { timeScale: 2.6, duration: 0.3, ease: 'power2.in', overwrite: true });
    };
    from = window.scrollY;
    window.addEventListener('scroll', onScrollAway, { passive: true });
  };

  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    // While it is speaking, further presses do nothing at all.
    if (showing) return;
    if (told || !roomy()) {
      // Every press after the first: the sun acknowledges you and that
      // is all. Saying it again would turn a signature into a toy.
      pulse();
      return;
    }
    told = true;
    say();
  };

  hit.addEventListener('click', onClick);
  hit.addEventListener('mouseenter', () => glow(true));
  hit.addEventListener('mouseleave', () => glow(false));
  hit.addEventListener('focus', () => glow(true));
  hit.addEventListener('blur', () => glow(false));

  return {
    dispose(): void {
      hit.removeEventListener('click', onClick);
      showing?.kill();
      showing = null;
      gsap.killTweensOf([n.core, n.veil, n.line, n.intro, n.sun].filter(Boolean) as Element[]);
      gsap.set([n.core, n.veil], { opacity: 0 });
      gsap.set([n.line, n.intro], { clearProps: 'all' });
      if (n.sun) gsap.set(n.sun, { scale: 1 });
    },
  };
}
