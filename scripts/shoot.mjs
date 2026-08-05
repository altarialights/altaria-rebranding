/**
 * Review harness — Altaria Lights hero v4.
 *
 * Produces exactly the captures agreed for review. Output goes to
 * review/ — working images, never site assets.
 *
 * Usage:  npx astro build && npx astro preview   (one terminal)
 *         node scripts/shoot.mjs                 (another)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = 'review';

/** Scroll fractions of the hero track that land squarely in each moment. */
const MOMENTS = {
  'intro-statement': 0.02,
  'header-transition': 0.2,
  'social-beat': 0.36,
  'web-beat': 0.6,
  'growth-beat': 0.86,
};

const PLAN = [
  { w: 1440, h: 900, shots: ['intro-statement', 'social-beat', 'web-beat', 'growth-beat'] },
  {
    w: 1920,
    h: 1080,
    shots: ['intro-statement', 'header-transition', 'social-beat', 'web-beat', 'growth-beat'],
  },
  { w: 2560, h: 1440, shots: ['intro-statement', 'web-beat', 'growth-beat'] },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
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
  const y = await page.evaluate((frac) => {
    const hero = document.querySelector('[data-hero]');
    const travel = hero.getBoundingClientRect().height - window.innerHeight;
    const target = travel * frac;
    window.scrollTo(0, target);
    return target;
  }, p);
  // scrub 0.9 means the timeline trails the scroll; give it room.
  await page.waitForTimeout(2200);
  return y;
}

async function report(page, name) {
  const s = await page.evaluate(() => ({
    beat: document.querySelector('[data-stage]')?.dataset.beat,
    objs: Object.fromEntries(
      [...document.querySelectorAll('[data-obj]')].map((el) => {
        const r = el.getBoundingClientRect();
        return [
          el.dataset.obj,
          {
            cx: Math.round(r.left + r.width / 2),
            cy: Math.round(r.top + r.height / 2),
            w: Math.round(r.width),
            op: Number(getComputedStyle(el).opacity).toFixed(2),
          },
        ];
      })
    ),
  }));
  console.log(`${name} · ${JSON.stringify(s)}`);
}

for (const vp of PLAN) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  for (const shot of vp.shots) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100); // intro cue appears at 1.5 s
    await freeze(page);
    await settle(page, MOMENTS[shot]);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/${vp.w}-${shot}.png` });
    await report(page, `${vp.w}-${shot}`);
  }

  // --- 1920 only: node hover + the "Cómo funciona" section -----------
  if (vp.w === 1920) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);
    await freeze(page);
    await settle(page, MOMENTS['growth-beat']);
    // NOTE: page.hover() scrolls the target into view, which scrubs the
    // timeline backwards and captures a half-built scene. Move the mouse
    // to the node's coordinates instead — no scrolling, no re-scrub.
    const box = await page.locator('[data-flow-node="web"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/1920-node-hover.png` });
    console.log('1920-node-hover · tarjeta abierta:', await page.evaluate(() =>
      document.querySelector('[data-flow-tip="web"]')?.classList.contains('is-open')
    ));

    await page.goto(`${BASE}/#como-funciona`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/1920-how-it-works.png` });
  }

  await ctx.close();
}

// --- Debug pass (G layer) --------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const [name, key] of [
    ['social', 'social-beat'],
    ['web', 'web-beat'],
    ['growth', 'growth-beat'],
  ]) {
    await page.goto(`${BASE}/?hud=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);
    await freeze(page);
    await settle(page, MOMENTS[key]);
    await freeze(page);
    await page.screenshot({ path: `${OUT}/1920-debug-${name}.png` });
  }
  await ctx.close();
}

await browser.close();
console.log('done');
