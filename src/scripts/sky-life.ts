import gsap from "gsap";

/**
 * Sky events — scheduling and choreography.
 *
 * ------------------------------------------------------------------
 * WHY THESE DO NOT LIVE ON THE MASTER TIMELINE
 * ------------------------------------------------------------------
 * Everything else in the hero is scrubbed: scroll position IS time, and
 * scrolling back runs it backwards. That is right for the devices — a
 * laptop lid should close when you scroll up.
 *
 * It is wrong for a living thing. A bird whose wings beat backwards, a
 * contrail that un-draws itself, a rocket that descends tail-first: each
 * of those is worse than having no event at all, because it tells the
 * viewer the sky is a slider rather than a place. And a scrubbed event
 * plays at whatever speed the wheel is turning, so a flick makes the
 * flock teleport.
 *
 * So the scroll only decides WHEN. Once an event fires it runs on its own
 * clock at its own speed, exactly like monitorLife() does for the
 * dashboard, and it finishes whether the user keeps scrolling or not.
 * Nothing here touches the master timeline's duration.
 *
 * ------------------------------------------------------------------
 * DISCIPLINE
 * ------------------------------------------------------------------
 * · One at a time, always. The windows are far apart and a fire is
 *   refused while anything else is running, so the sky can never
 *   accumulate a flock, a jet and a rocket at once.
 * · Never during a flick (`activity.fast`) or on a hidden tab. Both are
 *   cases where the event would be spent without being seen, and firing
 *   it anyway means it will not be there when the user scrolls back.
 * · Re-armed only after leaving the neighbourhood of the trigger, so
 *   nudging the wheel around one point does not stutter it.
 */

interface Activity {
    readonly fast: boolean;
    readonly visible: boolean;
    onChange(fn: () => void): void;
}

export interface SkyLife {
    update(p: number): void;
    dispose(): void;
}

/** How far past the trigger you must scroll before it can fire again. */
const REARM = 0.035;

const vw = (n: number): number => (window.innerWidth * n) / 100;
const vh = (n: number): number => (window.innerHeight * n) / 100;

interface EventSpec {
    /** Progress at which it fires. */
    at: number;
    /** Selector of its root node. */
    sel: string;
    build(el: HTMLElement): gsap.core.Timeline;
}

/* ------------------------------------------------------------------ *
 * The four events
 * ------------------------------------------------------------------ *
 * Spacing is the design. 0.09 · 0.31 · 0.58 · 0.77 leaves three long
 * stretches — a fifth of the hero, a quarter, a fifth — where the sky
 * does nothing at all. Those gaps are what make the events read as
 * events.
 */
const EVENTS: EventSpec[] = [
    /* 0.09 — the statement has just dissolved and the phone has not
     arrived. The stage is completely empty for the only time in the
     hero, which makes this the one moment a flock can have to itself. */
    {
        at: 0.09,
        sel: '[data-sky-event="birds-a"]',
        build: (el) => {
            const tl = gsap.timeline();
            const y = vh(15);
            tl.set(el, { x: vw(108), y, opacity: 0 })
                .to(el, { opacity: 1, duration: 1.1, ease: "power1.out" }, 0)
                // Right to left, and slightly downhill: birds crossing dead level
                // look like they are on a wire.
                .to(el, { x: -vw(22), duration: 15.5, ease: "none" }, 0)
                .to(
                    el,
                    { y: y + vh(4.5), duration: 15.5, ease: "sine.inOut" },
                    0,
                )
                .to(el, { opacity: 0, duration: 2.4, ease: "power1.in" }, 13.1);
            return tl;
        },
    },

    /* 0.31 — the phone has left and the laptop is still rising out of the
     cloud with its lid shut. Nothing is in the top band, and there is no
     headline on screen either: the gap between the social copy (ends
     0.272) and the web copy (starts 0.392) is the longest silence in the
     hero. The jet gets the whole of it. */
    {
        at: 0.31,
        sel: '[data-sky-event="jet"]',
        build: (el) => {
            const tl = gsap.timeline();
            const trail = el.querySelector<HTMLElement>("[data-jet-trail]");
            /* 14vh, not 11: the floating header ends at about 9vh and the
         contrail is a 44vw horizontal line. Any closer and the two read
         as one graphic element rather than as an aircraft passing behind
         the interface. */
            tl.set(el, { x: -vw(16), y: vh(14), opacity: 0, rotation: 0 })
                // opacity as well as scaleX: if this jet was shot down last time
                // round, the trail was faded out on the way down.
                .set(trail, { scaleX: 0, opacity: 1 })
                .to(el, { opacity: 1, duration: 1.6, ease: "power1.out" }, 0)
                .to(el, { x: vw(118), duration: 21, ease: "none" }, 0)
                // A hair of descent over 21 s. Real cruise is level, but a
                // perfectly horizontal line in a frame this soft looks ruled.
                .to(el, { y: vh(11.8), duration: 21, ease: "none" }, 0)
                // The contrail is produced, not revealed: it grows out of the
                // tail for the first third and then just follows.
                .to(
                    trail,
                    { scaleX: 1, duration: 7.5, ease: "power1.out" },
                    0.5,
                )
                .to(el, { opacity: 0, duration: 3.6, ease: "power1.in" }, 17.4);
            return tl;
        },
    },

    /* 0.58 — the monitor is protagonist and its top edge is at 28vh, so
     the band is clear. A smaller, faster, closer-together flock going the
     other way: the same event twice is a pattern, and a pattern is the
     one thing this layer must not become. */
    {
        at: 0.58,
        sel: '[data-sky-event="birds-b"]',
        build: (el) => {
            const tl = gsap.timeline();
            const y = vh(13);
            tl.set(el, { x: -vw(16), y, opacity: 0, scaleX: -1 })
                .to(el, { opacity: 0.85, duration: 0.9, ease: "power1.out" }, 0)
                .to(el, { x: vw(112), duration: 11.5, ease: "none" }, 0)
                .to(
                    el,
                    { y: y - vh(3.2), duration: 11.5, ease: "sine.inOut" },
                    0,
                )
                .to(el, { opacity: 0, duration: 2, ease: "power1.in" }, 9.5);
            return tl;
        },
    },

    /* 0.77 — the tablet is on its way out to the right and the closing
     copy has not started. The rocket climbs out of the lower left, the
     one region of the frame that is empty at every single point of the
     timeline, and it is already small and half faded by the time it
     reaches the height the headline occupies. It becomes the transition
     INTO the last beat: the last device leaves, something climbs, and
     the system assembles behind it. */
    {
        at: 0.77,
        sel: '[data-sky-event="rocket"]',
        build: (el) => {
            const tl = gsap.timeline();
            const plume = el.querySelector<HTMLElement>("[data-launch-plume]");
            tl.set(el, {
                x: vw(13),
                y: vh(104),
                opacity: 0,
                scale: 1,
                rotation: 4,
            })
                .set(plume, { scaleY: 0 })
                .to(el, { opacity: 1, duration: 0.7, ease: "power1.out" }, 0)
                /* power1.in, not a linear rise: a rocket accelerates, and that
           acceleration is most of why the shape reads as a launch rather
           than as something being lifted. */
                .to(el, { y: vh(21), duration: 7.4, ease: "power1.in" }, 0)
                // Leaning downrange as it gains altitude — the gravity turn is
                // the detail that makes it look observed rather than drawn.
                .to(
                    el,
                    {
                        x: vw(21),
                        rotation: 15,
                        duration: 7.4,
                        ease: "power2.in",
                    },
                    0,
                )
                // And receding: by the end it is a little more than half the size
                // it started, which is what sells the distance.
                .to(el, { scale: 0.56, duration: 7.4, ease: "power1.in" }, 0)
                .to(
                    plume,
                    { scaleY: 1, duration: 4.2, ease: "power1.out" },
                    0.25,
                )
                /* Gone before it ever shares a band with the closing headline.
           The fade starts at 58 % of the climb, which is around 55vh —
           the copy sits at 34–53vh. */
                .to(el, { opacity: 0, duration: 3, ease: "power2.in" }, 4.3);
            return tl;
        },
    },
];

/* ------------------------------------------------------------------ *
 * Reactions — the sky answers back
 * ------------------------------------------------------------------ *
 * Click a bird, the jet or the rocket and it reacts. Nobody is told this
 * exists; the only hint is that the thing grows slightly under the
 * cursor, which is the difference between an easter egg and a minigame.
 *
 * Three rules hold the whole feature together:
 *
 *   ONE REACTION PER APPEARANCE. Not per click — per appearance. The
 *   flock that just got shouted at is the flock that leaves; clicking it
 *   again does nothing, and the next flock, twenty per cent of the hero
 *   later, is a fresh one. There is no way to farm the joke.
 *
 *   NOTHING IS EVER CREATED. Eight puff nodes, one ring, one bubble,
 *   built with the page and reused. A compulsive clicker cannot make the
 *   scene accumulate anything because there is nothing to accumulate.
 *
 *   THE REACTION NEVER OWNS A NODE THE CHOREOGRAPHY IS USING. The flock's
 *   root carries the crossing, so the scatter goes on the individual
 *   birds; the jet's root carries the crossing, so the shudder goes on
 *   the craft inside it. Speed changes go through the event timeline's
 *   timeScale, which is the one thing that can be changed mid-flight
 *   without fighting anything.
 */

interface Reactor {
    bubble(text: string, cx: number, cy: number): void;
    puff(cx: number, cy: number, opt: PuffOpts): void;
    ring(cx: number, cy: number): void;
    clear(): void;
}

interface PuffOpts {
    /** How many of the eight to use. */
    count: number;
    /** Radius they travel to, in px. */
    reach: number;
    /** Extra push along this angle, in radians — the jet's wake. */
    bias?: number;
    scale?: number;
    duration?: number;
}

function reactor(): Reactor | null {
    const layer = document.querySelector<HTMLElement>("[data-fx]");
    const bubbleEl = document.querySelector<HTMLElement>("[data-fx-bubble]");
    const ringEl = document.querySelector<HTMLElement>("[data-fx-ring]");
    const puffHost = document.querySelector<HTMLElement>("[data-fx-puffs]");
    if (!layer || !bubbleEl || !ringEl || !puffHost) return null;

    const puffs = Array.from(puffHost.querySelectorAll<HTMLElement>("i"));
    /* Stage-local coordinates. The stage is the pinned viewport box while
     the hero is on screen, so this is a subtraction, not a projection —
     but doing it properly costs nothing and survives the stage ever
     being offset. */
    const local = (cx: number, cy: number): [number, number] => {
        const r = layer.getBoundingClientRect();
        return [cx - r.left, cy - r.top];
    };

    let bubbleTl: gsap.core.Timeline | null = null;

    return {
        bubble(text, cx, cy) {
            const [x, y] = local(cx, cy);
            bubbleTl?.kill();
            bubbleEl.textContent = text;

            /* Kept inside the frame, and the TAIL moves instead of the bubble.
         The line is one nowrap phrase about 190 px wide, and a bird can
         easily be clicked 60 px from the right edge — the first version
         just let it run off the screen. Clamping the box and then
         pointing the tail back at the click keeps it attached to what
         was clicked wherever that happened to be. */
            const w = bubbleEl.offsetWidth;
            const h = bubbleEl.offsetHeight;
            const lw = layer.clientWidth;
            const bx = Math.min(Math.max(x - w * 0.16, 14), lw - w - 14);
            // Above the pointer, unless there is no room — then below it.
            const above = y - h - 20;
            const by = above < 14 ? y + 26 : above;
            const tail = `${Math.min(Math.max(((x - bx) / w) * 100, 12), 88)}%`;
            bubbleEl.style.setProperty("--tail", tail);
            bubbleEl.classList.toggle("is-under", above < 14);

            bubbleTl = gsap
                .timeline()
                .set(bubbleEl, {
                    x: bx,
                    y: by,
                    opacity: 0,
                    scale: 0.86,
                    rotation: -2,
                })
                .to(bubbleEl, {
                    opacity: 1,
                    scale: 1,
                    rotation: 0,
                    duration: 0.42,
                    // A hint of overshoot. Any more and it becomes a cartoon.
                    ease: "back.out(2.4)",
                })
                .to(
                    bubbleEl,
                    { y: by - 9, duration: 1.5, ease: "sine.out" },
                    0.42,
                )
                .to(
                    bubbleEl,
                    {
                        opacity: 0,
                        scale: 0.96,
                        duration: 0.34,
                        ease: "power2.in",
                    },
                    1.62,
                );
        },

        puff(cx, cy, opt) {
            const [x, y] = local(cx, cy);
            const n = Math.min(opt.count, puffs.length);
            const reach = opt.reach;
            const dur = opt.duration ?? 0.72;

            for (let i = 0; i < puffs.length; i++) {
                const el = puffs[i];
                gsap.killTweensOf(el);
                if (i >= n) {
                    gsap.set(el, { opacity: 0 });
                    continue;
                }

                /* Golden-angle spacing rather than an even ring: evenly spaced
           blobs read as a diagram, this reads as vapour. */
                const a = i * 2.399 + (opt.bias ?? 0) * 0.0001;
                const push =
                    opt.bias === undefined
                        ? 1
                        : 1 + Math.cos(a - opt.bias) * 0.55;
                const d = reach * (0.55 + ((i * 37) % 45) / 100) * push;
                const s = (opt.scale ?? 1) * (0.55 + ((i * 53) % 60) / 100);

                gsap.timeline()
                    .set(el, { x, y, scale: 0.18, opacity: 0 })
                    .to(el, {
                        scale: s,
                        opacity: 0.95,
                        duration: dur * 0.26,
                        ease: "power2.out",
                    })
                    .to(
                        el,
                        {
                            x: x + Math.cos(a) * d,
                            y: y + Math.sin(a) * d - reach * 0.16,
                            scale: s * 1.5,
                            duration: dur,
                            ease: "power2.out",
                        },
                        0,
                    )
                    .to(
                        el,
                        { opacity: 0, duration: dur * 0.62, ease: "power1.in" },
                        dur * 0.38,
                    );
            }
        },

        ring(cx, cy) {
            const [x, y] = local(cx, cy);
            gsap.killTweensOf(ringEl);
            gsap.timeline()
                .set(ringEl, { x, y, scale: 0.3, opacity: 0.9 })
                .to(ringEl, { scale: 4.6, duration: 0.62, ease: "power2.out" })
                .to(
                    ringEl,
                    { opacity: 0, duration: 0.5, ease: "power1.in" },
                    0.12,
                );
        },

        clear() {
            bubbleTl?.kill();
            bubbleTl = null;
            gsap.killTweensOf([bubbleEl, ringEl, ...puffs]);
            gsap.set([bubbleEl, ringEl, ...puffs], { opacity: 0 });
        },
    };
}

const BIRD_LINE = "CUIDADO QUE LOS ASUSTAS!";
/* The second layer, and the only one that is not tied to an element:
   once someone has poked all three, the sky comments on it. Once per
   page load, and never again — a running gag stops being one the second
   time. */
const CAUGHT_LINE = "Eso no estaba en el briefing.";

export function skyLife(activity: Activity): SkyLife {
    const live: Array<{ spec: EventSpec; el: HTMLElement; armed: boolean }> =
        [];
    /* The sun's hit disc sits at 87% / 8% and reaches down to about 16vh —
     straight across the lane the jet and the second flock fly through.
     Whichever of them is on screen wins, because it is the one that is
     leaving: the sun will still be there in fifteen seconds. This flag
     is what lets the sun stand aside; see .sun-hit in SunSignature. */
    const stage = document.querySelector<HTMLElement>("[data-stage]");
    const busy = (on: boolean): void => {
        if (!stage) return;
        if (on) stage.dataset.skyBusy = "1";
        else delete stage.dataset.skyBusy;
    };

    for (const spec of EVENTS) {
        const el = document.querySelector<HTMLElement>(spec.sel);
        if (el) live.push({ spec, el, armed: true });
    }

    const fx = reactor();
    let running: {
        tl: gsap.core.Timeline;
        el: HTMLElement;
        id: string;
        used: boolean;
    } | null = null;
    const poked = new Set<string>();
    let caught = false;
    let caughtCall: gsap.core.Tween | null = null;

    /**
     * Parks an event that has ended, however it ended — ran its course, or
     * was shot down. Resets everything the reaction touched so the next
     * appearance starts from the same place the first one did.
     */
    const finish = (el: HTMLElement): void => {
        gsap.set(el, { opacity: 0 });
        el.classList.remove("is-live", "is-startled");
        gsap.set(el.querySelectorAll("[data-bird], [data-jet-craft]"), {
            clearProps: "transform",
        });
        if (running?.el === el) {
            running = null;
            busy(false);
        }
    };

    /** Puts an event away: fades it out, kills it, resets what it touched. */
    const retire = (r: { tl: gsap.core.Timeline; el: HTMLElement }): void => {
        r.tl.kill();
        r.el.classList.remove("is-live", "is-startled");
        gsap.to(r.el, {
            opacity: 0,
            duration: 0.4,
            ease: "power1.in",
            onComplete: () => {
                gsap.set(
                    r.el.querySelectorAll("[data-bird], [data-jet-craft]"),
                    {
                        clearProps: "transform",
                    },
                );
            },
        });
        if (running?.el === r.el) running = null;
    };

    const react = (e: MouseEvent): void => {
        if (!fx || !running || running.used) return;
        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
            ".hit",
        );
        if (!target || !running.el.contains(target)) return;
        // Ignore the tail of a fade: reacting to something already leaving
        // feels like a bug rather than a joke.
        if (Number(gsap.getProperty(running.el, "opacity")) < 0.2) return;

        running.used = true;
        running.el.classList.remove("is-live");

        const r = target.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const kind = running.id.startsWith("birds") ? "birds" : running.id;

        if (kind === "birds") {
            fx.bubble(BIRD_LINE, e.clientX, e.clientY);
            running.el.classList.add("is-startled");
            /* The formation breaks: each bird jinks its own way and by its own
         amount. A flock that scatters as one block is a sprite. */
            const birds = Array.from(
                running.el.querySelectorAll<HTMLElement>("[data-bird]"),
            );
            birds.forEach((bird, i) => {
                gsap.to(bird, {
                    x: (i % 2 ? -1 : 1) * (7 + i * 5),
                    y: (i % 3 === 0 ? -1 : 1) * (9 + i * 4),
                    duration: 0.46 + i * 0.05,
                    ease: "power3.out",
                });
            });
            // And they get out. Two and a half times the speed for the rest of
            // the crossing, fade included.
            gsap.to(running.tl, {
                timeScale: 2.6,
                duration: 0.55,
                ease: "power2.in",
            });
        } else if (kind === "jet") {
            /* A cloud bursts ABOVE it, and then it goes down.
         ----------------------------------------------------------------
         The first version was a shudder and a small wake, and it was too
         well mannered to notice — which is a real failure for a joke:
         if you have to be told it happened, it did not happen.

         Now the puff sits over the aircraft, big and unmistakable, and
         the aircraft stops flying. Not a nosedive: it stalls, hangs its
         nose up for a moment, and then sinks along a half parabola while
         it keeps most of its forward speed. That shape — horizontal
         momentum bleeding off while the fall accelerates — is the whole
         reason it reads as cartoon slapstick rather than as a crash. */
            const el = running.el;
            const craft = el.querySelector<HTMLElement>("[data-jet-craft]");
            const trail = el.querySelector<HTMLElement>("[data-jet-trail]");

            fx.puff(cx, cy - 16, {
                count: 8,
                reach: 62,
                bias: -Math.PI / 2,
                scale: 1.3,
                duration: 0.9,
            });

            // Hand the aircraft over: the cruise timeline no longer owns it.
            const cruise = running.tl;
            const x0 = Number(gsap.getProperty(el, "x"));
            cruise.kill();

            gsap.timeline({ onComplete: () => finish(el) })
                // Forward momentum, bleeding off. It does not stop dead.
                .to(
                    el,
                    { x: x0 + vw(23), duration: 3.1, ease: "power1.out" },
                    0.12,
                )
                // The fall, accelerating: half a parabola, not a dive.
                .to(el, { y: vh(96), duration: 3.1, ease: "power2.in" }, 0.12)
                // Nose up first — the stall — then clearly over and down.
                // It reaches the falling angle before the cloud-bank fade,
                // otherwise most of the pitch happens after it stops reading.
                .to(
                    craft,
                    { rotation: -12, duration: 0.34, ease: "power2.out" },
                    0.12,
                )
                .to(
                    craft,
                    { rotation: 48, duration: 1.45, ease: "power2.inOut" },
                    0.48,
                )
                // The contrail stops being produced and comes apart.
                .to(
                    trail,
                    { opacity: 0, scaleX: 0.6, duration: 1, ease: "power2.in" },
                    0.12,
                )
                /* Gone into the cloud bank rather than fading in clear air: the
           near bank sits at 71vh and paints OVER this layer, so if the
           fade is timed to it the aircraft disappears behind cloud. */
                .to(el, { opacity: 0, duration: 0.9, ease: "power1.in" }, 2.2);
        } else {
            // Rocket: a ring of vapour, and then it is simply gone.
            fx.ring(cx, cy);
            fx.puff(cx, cy, {
                count: 8,
                reach: 54,
                scale: 1.05,
                duration: 0.8,
            });
            const plume = running.el.querySelector<HTMLElement>(
                "[data-launch-plume]",
            );
            if (plume) {
                gsap.timeline()
                    .to(plume, {
                        scaleX: 1.5,
                        opacity: 1,
                        duration: 0.16,
                        ease: "power2.out",
                    })
                    .to(plume, {
                        scaleX: 1,
                        duration: 0.9,
                        ease: "power2.out",
                    });
            }
            gsap.to(running.tl, {
                timeScale: 3.6,
                duration: 0.42,
                ease: "power2.in",
            });
        }

        poked.add(kind);
        if (!caught && poked.size === 3) {
            caught = true;
            // Late enough that it lands as a separate thought, not as a second
            // half of the reaction you just triggered.
            caughtCall = gsap.delayedCall(2.1, () =>
                fx.bubble(CAUGHT_LINE, e.clientX + 22, e.clientY + 34),
            );
        }
    };

    document.addEventListener("click", react);
    activity.onChange(() => {
        if (!running) return;
        if (activity.visible) running.tl.resume();
        else running.tl.pause();
    });

    const update = (p: number): void => {
        for (const item of live) {
            const { at } = item.spec;

            // Re-arm once the user is clearly away from the trigger again.
            if (!item.armed && (p < at - REARM || p > at + REARM * 4)) {
                item.armed = true;
                continue;
            }
            if (!item.armed || p < at || p > at + 0.06) continue;
            if (activity.fast || !activity.visible) continue;

            /* One at a time — but by RETIRING the previous one, not by refusing
         the new one.
         The first version just skipped the fire if anything was running,
         and the arithmetic makes that a starvation bug: the flock crosses
         in 15.5 s and the next trigger is 22 % of the hero away, which at
         a reading pace is comfortably less than that. The jet would
         simply never appear for anyone who scrolls at a normal speed.
         Retiring is also the honest answer — the user has scrolled past
         where the old event belonged. */
            if (running) retire(running);

            item.armed = false;
            const tl = item.spec.build(item.el);
            const id = item.el.dataset.skyEvent ?? "";
            running = { tl, el: item.el, id, used: false };
            item.el.classList.add("is-live");
            busy(true);

            tl.eventCallback("onComplete", () => finish(item.el));
        }
    };

    return {
        update,
        dispose(): void {
            document.removeEventListener("click", react);
            busy(false);
            caughtCall?.kill();
            caughtCall = null;
            running?.tl.kill();
            running = null;
            fx?.clear();
            for (const item of live) {
                item.el.classList.remove("is-live", "is-startled");
                gsap.set(item.el, { clearProps: "all", opacity: 0 });
            }
            live.length = 0;
        },
    };
}
