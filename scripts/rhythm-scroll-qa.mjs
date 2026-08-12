#!/usr/bin/env node

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4335/';
const OUT = path.resolve('review/rhythm/scroll-qa.json');
const TIERS = ['balanced', 'lite'];
const HOLDS = {
  phone: [0.113, 0.178],
  laptop: [0.224, 0.643],
  monitor: [0.699, 0.758],
  tablet: [0.798, 0.852],
  flow: [0.903, 0.968],
};
const SCENES = { impact: 0.3, benefits: 0.43, results: 0.57 };

const browser = await chromium.launch({ headless: true });
const report = { checks: [], errors: [] };
const check = (id, pass, detail) => report.checks.push({ id, pass: Boolean(pass), detail });

async function open(tier) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(`${tier}: ${error.message}`));
  const url = new URL(BASE);
  url.searchParams.set('perf', tier);
  url.searchParams.set('scrub', '0');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-hero-tier-phase="ready"]').waitFor();
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  return { context, page };
}

async function seek(page, progress) {
  await page.evaluate((value) => {
    const hero = document.querySelector('[data-hero]');
    const travel = hero.offsetHeight - innerHeight;
    scrollTo(0, Math.round(travel * value));
  }, progress);
  await page.waitForTimeout(30);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    const visible = (selector) => Array.from(document.querySelectorAll(selector)).filter((element) => {
      const style = getComputedStyle(element);
      return Number(style.opacity) > 0.85 && style.visibility !== 'hidden';
    });
    return {
      progress: scrollY / Math.max(1, hero.offsetHeight - innerHeight),
      objects: visible('[data-perf-object]').map((element) => element.dataset.perfObject),
      copies: visible('[data-perf-copy]').map((element) => element.dataset.perfCopy),
      liveCtas: Array.from(document.querySelectorAll('[data-cloud-cta]')).filter((button) => {
        const copy = button.closest('[data-perf-copy]');
        return copy && !copy.inert && Number(getComputedStyle(button).opacity) > 0.9;
      }).length,
      scene: visible('[data-web-scene],[data-perf-web-scene]').map((element) => element.dataset.webScene ?? element.dataset.perfWebScene),
      scrollY,
      travel: hero.offsetHeight - innerHeight,
    };
  });
}

try {
  for (const tier of TIERS) {
    const { context, page } = await open(tier);
    const expectedTravelVh = tier === 'balanced' ? 1480 : 1400;
    const start = await snapshot(page);
    check(`${tier}/travel`, Math.abs(start.travel / 7.68 - expectedTravelVh) < 1, start);

    for (const [id, [from, to]] of Object.entries(HOLDS)) {
      await seek(page, (from + to) / 2);
      const state = await snapshot(page);
      check(`${tier}/hold/${id}`, state.objects.length === 1 && state.objects[0] === id && state.copies.length === 1 && state.liveCtas === 1, state);
    }

    for (const [id, progress] of Object.entries(SCENES)) {
      await seek(page, progress);
      const state = await snapshot(page);
      check(`${tier}/miniweb/${id}`, state.scene.length === 1 && state.scene[0] === id, state);
    }

    for (const progress of [0.91, 0.72, 0.81, 0.45, 0.14, 0]) {
      await seek(page, progress);
      const state = await snapshot(page);
      check(`${tier}/reverse/${progress}`, state.objects.length <= 1 && state.copies.length <= 1 && state.liveCtas <= 1, state);
    }

    await seek(page, 0);
    const wheel = [];
    for (let index = 0; index < 22; index += 1) {
      await page.mouse.wheel(0, 360);
      await page.waitForTimeout(24);
      wheel.push(await snapshot(page));
    }
    check(`${tier}/wheel`, wheel.every((state, index) => index === 0 || state.scrollY >= wheel[index - 1].scrollY) && wheel.every((state) => state.objects.length <= 1 && state.liveCtas <= 1), wheel.at(-1));

    await seek(page, 0.735);
    const before = await snapshot(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-hero-tier-phase="ready"]').waitFor();
    await page.waitForTimeout(180);
    const after = await snapshot(page);
    check(`${tier}/reload`, Math.abs(before.progress - after.progress) < 0.002 && after.objects.length <= 1 && after.copies.length <= 1, { before, after });

    await context.close();
  }
} finally {
  await browser.close();
}

report.summary = {
  passed: report.checks.filter((item) => item.pass).length,
  total: report.checks.length,
  errors: report.errors.length,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`Rhythm scroll QA: ${report.summary.passed}/${report.summary.total}; ${report.summary.errors} errors.`);
if (report.summary.passed !== report.summary.total || report.summary.errors) process.exitCode = 1;
