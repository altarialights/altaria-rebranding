/**
 * Review harness — Altaria Lights hero v7.
 *
 * Output goes to review/ — working images, never site assets.
 *
 * Usage:  pnpm build && pnpm preview   (one terminal)
 *         node scripts/shoot.mjs             (another)
 *
 * Optional:
 *   BASE_URL=…            something other than localhost:4321
 *   PW_CHROME=…           a specific Chromium binary
 *   node scripts/shoot.mjs devices|beats|faces|variants
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = 'review';
const only = process.argv[2] ?? 'all';

/**
 * Scroll fractions of the hero track.
 *
 * These come straight from PHONE_CUE / LAPTOP_CUE in
 * src/scripts/hero-timeline.ts — the master timeline is normalised to a
 * duration of exactly 1, so a cue IS a scroll fraction. If a cue moves
 * there, move it here.
 */
/* Scroll progress for every named capture.
   ------------------------------------------------------------------
   THESE MUST TRACK THE CUE SCHEDULE IN hero-timeline.ts. They did not:
   the numbers below were written for v4's three-beat timing and never
   moved when v8 added two services and re-timed everything, so every
   laptop and phone capture was landing AFTER the device had already
   exited — the harness was faithfully photographing an empty stage and
   reporting the exit rotation for months.
   Derived from PHONE_CUE / LAPTOP_CUE and the copy windows: each beat
   capture sits in the middle of the window where its copy is fully
   settled, and each device capture at the phase it is named after. */
const M = {
  'intro-statement': 0.013077,
  'header-transition': 0.065385,

  // Mid-window of each copy block, where it is completely still.
  'social-beat': 0.130769,
  'web-beat': 0.3,
  'web-impact': 0.32,
  'web-benefits': 0.46,
  'web-results': 0.59,
  'software-beat': 0.735,
  'brand-beat': 0.825,
  'growth-beat': 0.915,

  // Phone: rear shell → edge-on crossing → three-quarter → square.
  // Full PHONE_CUE a .083692 · b .116385 · c .149077 · exit .181769–.210538.
  'phone-back-stable': 0.099385,
  'phone-side-stable': 0.115077,
  'phone-front-stable': 0.160192,
  'mobile-entry-start': 0.091538,
  'mobile-entry-mid': 0.116385,
  'mobile-entry-final': 0.160192,
  'mobile-final': 0.160192,

  // Laptop: shut on the way up → lid breaking → fully open, keyboard held.
  // Full LAPTOP_CUE a .188308 · b .213808 · c .245846 · done .271346 · exit .661308.
  'laptop-closed': 0.196154,
  'laptop-half-open-keyboard': 0.230154,
  'laptop-open-keyboard': 0.59,
  'laptop-corners': 0.59,
  'laptop-opening': 0.230154,
  'laptop-open': 0.59,
};
/** Every viewport the brief asks to be proven, widest last. */
const VIEWPORTS = [
  { w: 1020, h: 640 },
  { w: 1152, h: 720 },
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
];

/** Named captures the brief requires, by viewport width. */
const REQUIRED = {
  1020: [
    'phone-back-stable',
    'phone-side-stable',
    'phone-front-stable',
    'laptop-half-open-keyboard',
    'laptop-open-keyboard',
    'laptop-corners',
  ],
  1366: [
    'phone-back-stable',
    'phone-side-stable',
    'phone-front-stable',
    'laptop-half-open-keyboard',
    'laptop-open-keyboard',
    'laptop-corners',
  ],
  1920: [
    'phone-back-stable',
    'phone-side-stable',
    'phone-front-stable',
    'laptop-half-open-keyboard',
    'laptop-open-keyboard',
    'laptop-corners',
  ],
};

/** Composition captures, kept from v5 so the beats stay reviewable. */
const BEATS = {
  1020: ['intro-statement', 'social-beat', 'web-impact', 'web-benefits', 'web-results', 'growth-beat'],
  1152: ['social-beat', 'web-impact', 'web-benefits', 'web-results', 'software-beat'],
  1280: ['social-beat', 'web-impact', 'web-benefits', 'web-results', 'brand-beat'],
  1366: ['intro-statement', 'social-beat', 'web-impact', 'web-benefits', 'web-results', 'software-beat', 'brand-beat', 'growth-beat'],
  1440: ['intro-statement', 'social-beat', 'web-impact', 'web-benefits', 'web-results', 'software-beat', 'brand-beat', 'growth-beat'],
  1920: [
    'intro-statement',
    'header-transition',
    'social-beat',
    'web-impact',
    'web-benefits',
    'web-results',
    'software-beat',
    'brand-beat',
    'growth-beat',
    'mobile-entry-start',
    'mobile-entry-mid',
    'mobile-entry-final',
    'laptop-closed',
    'laptop-opening',
    'laptop-open',
  ],
  2560: [
    'intro-statement',
    'social-beat',
    'web-impact',
    'web-benefits',
    'web-results',
    'software-beat',
    'brand-beat',
    'growth-beat',
    'laptop-open',
  ],
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || undefined,
  args: ['--force-color-profile=srgb', '--hide-scrollbars'],
});

const freeze = (page) =>
  page.evaluate(() => {
    for (const v of document.querySelectorAll('video')) {
      v.pause();
      v.currentTime = 0.6;
    }
  });

async function settle(page, p) {
  await page.evaluate((frac) => {
    const hero = document.querySelector('[data-hero]');
    const travel = hero.getBoundingClientRect().height - window.innerHeight;
    window.scrollTo(0, travel * frac);
  }, p);
  // scrub 0.9 means the timeline trails the scroll; give it room.
  await page.waitForTimeout(2200);
}

/** Reads the numbers a reviewer has to check, not just a pretty picture. */
async function report(page, name) {
  const s = await page.evaluate(() => {
    /* Read the angles GSAP WROTE, not a matrix decomposition. Decomposing
       is ambiguous past ±90° — a rotationY of 190° comes back as a
       different but equivalent triple — and 190° is exactly the value
       this report exists to verify. */
    const rot = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const t = el.style.transform || '';
      const pick = (fn) => {
        const m = t.match(new RegExp(`${fn}\\(([-\\d.]+)deg\\)`));
        return m ? Math.round(Number(m[1])) : 0;
      };
      return { rx: pick('rotateX'), ry: pick('rotateY'), rz: pick('rotate') };
    };
    const seen = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const on = r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
      return on ? `${Math.round(r.width)}×${Math.round(r.height)}` : 'fuera';
    };
    const video = document.querySelector('[data-reel]');
    return {
      beat: document.querySelector('[data-stage]')?.dataset.beat,
      phoneRot: rot('[data-spin="phone"]'),
      laptopRot: rot('[data-spin="laptop"]'),
      lidRot: rot('[data-laptop-lid]'),
      // The faces the brief says must never drop out.
      keys: seen('.laptop__keys'),
      deck: seen('.laptop__deck'),
      baseL: seen('.laptop__base-left'),
      baseR: seen('.laptop__base-right'),
      baseF: seen('.laptop__base-front'),
      phoneBack: seen('.phone__back'),
      phoneSide: seen('.phone__side--left'),
      reel: video ? (video.paused ? 'pausa' : 'play') : 'sin vídeo',
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(`${name} · ${JSON.stringify(s)}`);
  if (s.overflowX > 0) console.warn(`  ⚠ scroll horizontal: ${s.overflowX} px`);
  return s;
}

async function shoot(page, w, name, query = '') {
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2100); // intro cue appears at 1.5 s
  await freeze(page);
  await settle(page, M[name]);
  await freeze(page);

  if (name === 'laptop-corners') {
    // Tight crop on the base: the bottom corners are the thing under
    // review, and at full frame they are 40 px in a 1920 px picture.
    const box = await page.evaluate(() => {
      const el = document.querySelector('.laptop__base-group');
      const r = el.getBoundingClientRect();
      // Clamp on BOTH edges. The laptop leaves to the right now, so at
      // some moments its box starts past the viewport and Playwright
      // throws "clipped area is outside the image" instead of returning
      // an empty shot — which took the whole run down with it.
      const x = Math.max(0, Math.floor(r.left) - 40);
      const y = Math.max(0, Math.floor(r.top) - 24);
      return {
        x,
        y,
        width: Math.max(0, Math.min(innerWidth - x, Math.ceil(r.width) + 80)),
        height: Math.max(0, Math.min(innerHeight - y, Math.ceil(r.height) + 90)),
      };
    });
    if (box.width < 8 || box.height < 8) {
      console.log(`${w}-${name} · fuera de encuadre, sin recorte`);
      await page.screenshot({ path: `${OUT}/${w}-${name}.png` });
    } else {
      await page.screenshot({ path: `${OUT}/${w}-${name}.png`, clip: box });
    }
  } else {
    await page.screenshot({ path: `${OUT}/${w}-${name}.png` });
  }
  await report(page, `${w}-${name}`);
}

for (const vp of VIEWPORTS) {
  const list = [
    ...(only === 'beats' || only === 'all' ? (BEATS[vp.w] ?? []) : []),
    ...(only === 'devices' || only === 'all' ? (REQUIRED[vp.w] ?? []) : []),
  ];
  if (list.length === 0) continue;

  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const name of list) await shoot(page, vp.w, name);
  await ctx.close();
}

// --- Face debug (F layer) --------------------------------------------
if (only === 'all' || only === 'faces') {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const [file, moment] of [
    ['debug-phone-faces', 'mobile-entry-mid'],
    ['debug-laptop-faces', 'laptop-half-open-keyboard'],
  ]) {
    await page.goto(`${BASE}/?faces=1&hud=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);
    await freeze(page);
    await settle(page, M[moment]);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }
  await ctx.close();
}

// --- 1920 extras: node hover, "Cómo funciona", HUD --------------------
if (only === 'all') {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2100);
  await freeze(page);
  await settle(page, M['growth-beat']);
  // NOTE: page.hover() scrolls the target into view, which scrubs the
  // timeline backwards and captures a half-built scene. Move the mouse to
  // the node's coordinates instead — no scrolling, no re-scrub.
  const box = await page.locator('[data-flow-node="web"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
  await freeze(page);
  await page.screenshot({ path: `${OUT}/1920-node-hover.png` });

  await page.goto(`${BASE}/#como-funciona`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/1920-how-it-works.png` });

  for (const [name, key] of [
    ['laptop-open', 'laptop-open-keyboard'],
    ['mobile-entry', 'mobile-entry-mid'],
  ]) {
    await page.goto(`${BASE}/?hud=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);
    await freeze(page);
    await settle(page, M[key]);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/1920-debug-${name}.png` });
  }
  await ctx.close();
}

// --- Reduced motion + small screen ------------------------------------
if (only === 'all' || only === 'variants') {
  for (const v of [
    { name: 'reduced', w: 1920, h: 1080, reducedMotion: 'reduce', at: 0.69 },
    { name: 'small', w: 390, h: 844, reducedMotion: 'no-preference', at: 0.62 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      deviceScaleFactor: 1,
      reducedMotion: v.reducedMotion,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);
    await freeze(page);
    await settle(page, v.at);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/${v.w}-${v.name}.png` });
    await report(page, `${v.w}-${v.name}`);
    await ctx.close();
  }
}

await browser.close();
console.log('done');
