import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4321';
const OUT = 'review/full-exit-qa';
const viewports = [
  { width: 1905, height: 669 },
  { width: 1920, height: 1080 },
  { width: 2400, height: 900 },
];
const moments = [
  ['intro', 0.013077],
  ['flow', 0.915],
  ['exit-start', 0.965],
  ['exit-mid', 0.978],
  ['exit-late', 0.99],
  ['exit-end', 1],
  ['after-hero', 1.025],
  ['flow-reverse', 0.915],
];

mkdirSync(OUT, { recursive: true });

async function isReady() {
  try {
    const response = await fetch(BASE);
    return response.ok;
  } catch {
    return false;
  }
}

let preview;
if (!(await isReady())) {
  preview = spawn('pnpm astro preview --host 127.0.0.1 --port 4321', {
    shell: true,
    stdio: 'ignore',
  });
  const deadline = Date.now() + 20_000;
  while (!(await isReady())) {
    if (Date.now() > deadline) throw new Error('Astro preview did not start');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const browser = await chromium.launch({ args: ['--hide-scrollbars'] });
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE}/?perf=full&scrub=0&still=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.performanceTier === 'full' &&
        document.querySelector('[data-hero-tier-outlet]')?.dataset.heroTierPhase === 'ready'
    );

    for (const [name, progress] of moments) {
      await page.evaluate((fraction) => {
        const hero = document.querySelector('[data-hero]');
        if (!(hero instanceof HTMLElement)) throw new Error('Full hero not found');
        const top = hero.getBoundingClientRect().top + scrollY;
        const travel = Math.max(0, hero.offsetHeight - innerHeight);
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo({ top: top + travel * fraction, behavior: 'instant' });
      }, progress);
      await page.waitForTimeout(350);

      const audit = await page.evaluate(() => {
        const style = (selector) => {
          const element = document.querySelector(selector);
          return element ? getComputedStyle(element) : null;
        };
        const flow = style('[data-obj="flow"]');
        const line = style('.intro__line');
        const vapour = style('.intro__vapour');
        const fallback = document.querySelector('[data-hero-boot-fallback]');
        const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
        const hero = document.querySelector('[data-hero]');
        const nextSection = document.querySelector('#como-funciona');
        const nextHeading = document.querySelector('#how-title');
        const heroRect = hero?.getBoundingClientRect();
        const nextRect = nextSection?.getBoundingClientRect();
        const nextHeadingRect = nextHeading?.getBoundingClientRect();
        const stageRect = document.querySelector('[data-stage]')?.getBoundingClientRect();
        const exitRect = document
          .querySelector('[data-asset="HG-04"]')
          ?.getBoundingClientRect();
        return {
          flowOpacity: flow ? Number(flow.opacity) : null,
          introTextShadow: line?.textShadow ?? null,
          introVapourOpacity: vapour ? Number(vapour.opacity) : null,
          fallbackDisplay: fallbackStyle?.display ?? null,
          fallbackHeight: fallback?.getBoundingClientRect().height ?? null,
          sectionGap:
            heroRect && nextRect ? Math.round(nextRect.top - heroRect.bottom) : null,
          headingInset:
            nextRect && nextHeadingRect
              ? Math.round(nextHeadingRect.top - nextRect.top)
              : null,
          exitCoverageGap:
            stageRect && exitRect ? Math.round(stageRect.bottom - exitRect.bottom) : null,
          stageBeat: document.querySelector('[data-stage]')?.dataset.beat ?? null,
          scrollY: Math.round(scrollY),
        };
      });
      results.push({ viewport, name, progress, ...audit });
      await page.screenshot({
        path: `${OUT}/${viewport.width}x${viewport.height}-${name}.png`,
      });
    }

    await context.close();
  }
} finally {
  await browser.close();
  preview?.kill();
}

const failures = results.filter(
  (result) =>
    result.introTextShadow !== 'none' ||
    result.introVapourOpacity !== 0 ||
    result.fallbackDisplay !== 'none' ||
    result.fallbackHeight !== 0 ||
    result.sectionGap !== 0 ||
    (result.headingInset ?? Infinity) > 32 ||
    ((result.name === 'exit-end' || result.name === 'after-hero') &&
      (result.exitCoverageGap ?? Infinity) > 0) ||
    (result.name === 'exit-mid' && (result.flowOpacity ?? 1) > 0.2) ||
    ((result.name === 'exit-end' || result.name === 'after-hero') &&
      (result.flowOpacity ?? 1) > 0.01) ||
    (result.name === 'flow-reverse' && (result.flowOpacity ?? 0) < 0.99)
);

console.table(results);
if (failures.length) {
  console.error('Full exit QA failed:', failures);
  process.exitCode = 1;
} else {
  console.log(`Full exit QA passed (${results.length}/${results.length}).`);
}
