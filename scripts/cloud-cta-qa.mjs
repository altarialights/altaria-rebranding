#!/usr/bin/env node

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4334';
const OUT = path.resolve(process.env.OUT ?? 'review/cloud-cta-qa');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TIERS = ['full', 'balanced', 'lite'];
const LABELS = {
  social: 'Quiero más visibilidad',
  web: 'Quiero una web así',
  software: 'Tengo una idea',
  brand: 'Quiero mejorar mi marca',
  growth: 'Hablemos de mi negocio',
};
const MOMENTS = {
  full: { social: 0.15, web: 0.46, software: 0.754, brand: 0.84, growth: 0.915 },
  balanced: { social: 0.13, web: 0.32, software: 0.71, brand: 0.81, growth: 0.915 },
  lite: { social: 0.13, web: 0.32, software: 0.71, brand: 0.81, growth: 0.915 },
};
const CAPTURE_VIEWPORTS = [
  { id: '1366x768', width: 1366, height: 768 },
  { id: '1920x1080', width: 1920, height: 1080 },
];
const RESPONSIVE_VIEWPORTS = [
  { id: '1020x640', width: 1020, height: 640 },
  { id: '1152x720', width: 1152, height: 720 },
  { id: '1280x720', width: 1280, height: 720 },
  { id: '1366x768', width: 1366, height: 768 },
  { id: '1440x900', width: 1440, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '2560x1440', width: 2560, height: 1440 },
];

mkdirSync(OUT, { recursive: true });

async function reachable() {
  try {
    return (await fetch(BASE, { signal: AbortSignal.timeout(1200) })).ok;
  } catch {
    return false;
  }
}

async function ensurePreview() {
  if (await reachable()) return { close() {} };
  if (!existsSync(path.resolve('dist/index.html'))) throw new Error('Falta dist/index.html.');
  const url = new URL(BASE);
  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/astro/astro.js'), 'preview', '--host', url.hostname, '--port', url.port],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Preview terminó antes de tiempo:\n${stderr}`);
    if (await reachable()) return { close: () => child.exitCode === null && child.kill() };
    await sleep(120);
  }
  child.kill();
  throw new Error(`Preview no disponible:\n${stderr}`);
}

async function prepare(page, tier) {
  const target = new URL(BASE);
  target.searchParams.set('perf', tier);
  target.searchParams.set('scrub', '0');
  target.searchParams.set('still', '1');
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) =>
    document.documentElement.dataset.performanceTier === expected &&
    document.querySelector('[data-hero-tier-phase="ready"]')
  , tier, { timeout: 15_000 });
  await page.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}' });
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.waitForTimeout(120);
}

async function seek(page, progress, settle = 150) {
  await page.evaluate((fraction) => {
    const hero = document.querySelector('[data-hero]');
    if (!(hero instanceof HTMLElement)) throw new Error('Hero ausente');
    const top = hero.getBoundingClientRect().top + scrollY;
    const destination = top + Math.max(0, hero.offsetHeight - innerHeight) * fraction;
    scrollTo({ top: destination, left: 0, behavior: 'instant' });
    if (document.scrollingElement) document.scrollingElement.scrollTop = destination;
  }, progress);
  await page.waitForTimeout(settle);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function state(page, tier, id) {
  return page.evaluate(({ tier, id }) => {
    const objectId = { social: 'phone', web: 'laptop', software: 'monitor', brand: 'tablet', growth: 'flow' }[id];
    const selector = tier === 'full'
      ? `[data-beat-copy="${id}"]`
      : `[data-perf-copy="${id}"]`;
    const copy = document.querySelector(selector);
    const button = copy?.querySelector('[data-cloud-cta]');
    const cloud = copy?.querySelector(tier === 'full' ? '[data-copy-cloud]' : '.perf-copy__cloud');
    if (!(copy instanceof HTMLElement) || !(button instanceof HTMLButtonElement) || !(cloud instanceof HTMLElement || cloud instanceof SVGElement)) {
      return { missing: true };
    }
    const buttonRect = button.getBoundingClientRect();
    const cloudRect = cloud.getBoundingClientRect();
    const object = document.querySelector(tier === 'full' ? `[data-obj="${objectId}"]` : `[data-perf-object="${objectId}"]`);
    const objectRect = object?.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      missing: false,
      text: button.textContent?.replace('→', '').trim(),
      type: button.type,
      inert: copy.inert,
      opacity: Number(style.opacity),
      pointer: style.pointerEvents,
      cursor: style.cursor,
      rect: { left: buttonRect.left, top: buttonRect.top, right: buttonRect.right, bottom: buttonRect.bottom, width: buttonRect.width, height: buttonRect.height },
      cloud: { left: cloudRect.left, top: cloudRect.top, right: cloudRect.right, bottom: cloudRect.bottom },
      object: objectRect ? { left: objectRect.left, top: objectRect.top, right: objectRect.right, bottom: objectRect.bottom } : null,
      viewport: { width: innerWidth, height: innerHeight },
      allCount: document.querySelectorAll('[data-cloud-cta]').length,
      activeCount: Array.from(document.querySelectorAll('[data-cloud-cta]')).filter((item) => {
        const parent = item.closest('[data-beat-copy],[data-perf-copy]');
        return parent instanceof HTMLElement && !parent.inert && Number(getComputedStyle(item).opacity) > 0.5;
      }).length,
    };
  }, { tier, id });
}

async function interactionState(page) {
  return page.evaluate(() => {
    const copies = Array.from(document.querySelectorAll('[data-beat-copy],[data-perf-copy]'));
    const live = copies.filter((item) => item instanceof HTMLElement && !item.inert);
    const inertButtons = copies
      .filter((item) => item instanceof HTMLElement && item.inert)
      .map((item) => item.querySelector('[data-cloud-cta]'))
      .filter((item) => item instanceof HTMLButtonElement);
    return {
      live: live.map((item) => item.getAttribute('data-beat-copy') ?? item.getAttribute('data-perf-copy')),
      inertPointerViolations: inertButtons.filter((button) => getComputedStyle(button).pointerEvents !== 'none').length,
    };
  });
}

const report = { checks: [], screenshots: [], errors: [] };
const check = (id, passed, detail) => report.checks.push({ id, passed: Boolean(passed), detail });
const preview = await ensurePreview();
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of CAPTURE_VIEWPORTS) {
    for (const tier of TIERS) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(`${tier}/${viewport.id}: ${error.message}`));
      await prepare(page, tier);
      for (const [id, progress] of Object.entries(MOMENTS[tier])) {
        await seek(page, progress);
        const folder = path.join(OUT, 'screenshots', tier, viewport.id);
        mkdirSync(folder, { recursive: true });
        const file = path.join(folder, `${id}.png`);
        await page.screenshot({ path: file });
        report.screenshots.push(file);
      }
      await context.close();
    }
  }

  for (const viewport of RESPONSIVE_VIEWPORTS) {
    for (const tier of TIERS) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(`${tier}/${viewport.id}: ${error.message}`));
      await prepare(page, tier);

      const initial = await page.evaluate(() => ({
        count: document.querySelectorAll('[data-cloud-cta]').length,
        live: Array.from(document.querySelectorAll('[data-beat-copy],[data-perf-copy]')).filter((item) => !item.inert).length,
      }));
      check(`${tier}/${viewport.id}/initial-inert`, initial.count === 5 && initial.live === 0, initial);

      for (const [id, progress] of Object.entries(MOMENTS[tier])) {
        await seek(page, progress);
        const current = await state(page, tier, id);
        const r = current.rect;
        const c = current.cloud;
        const contained = r && c && r.left >= c.left + 10 && r.right <= c.right - 10 && r.bottom <= c.bottom - 20;
        const viewportSafe = r && r.left >= 12 && r.right <= current.viewport.width - 12 && r.top >= 0 && r.bottom <= current.viewport.height;
        const o = current.object;
        const separated = c && o && (c.right <= o.left || o.right <= c.left || c.bottom <= o.top || o.bottom <= c.top);
        check(`${tier}/${viewport.id}/${id}`, !current.missing && current.text === LABELS[id] && current.type === 'button' && !current.inert && current.opacity > 0.9 && current.pointer === 'auto' && current.cursor === 'pointer' && current.allCount === 5 && current.activeCount === 1 && contained && viewportSafe && separated, current);
      }

      await seek(page, 0.99);
      const finalLive = await page.evaluate(() => Array.from(document.querySelectorAll('[data-beat-copy],[data-perf-copy]')).filter((item) => !item.inert).length);
      check(`${tier}/${viewport.id}/final-inert`, finalLive === 0, { finalLive });

      await seek(page, MOMENTS[tier].growth);
      const before = await page.evaluate(() => ({ scrollY, href: location.href }));
      await page.locator('[data-cloud-cta]').filter({ hasText: LABELS.growth }).evaluate((button) => button.click());
      const after = await page.evaluate(() => ({ scrollY, href: location.href }));
      check(`${tier}/${viewport.id}/click-noop`, before.href === after.href && Math.abs(before.scrollY - after.scrollY) < 1, { before, after });

      await context.close();
    }
  }

  for (const tier of TIERS) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(`${tier}/motion: ${error.message}`));
    await prepare(page, tier);

    const sequences = {
      slow: Array.from({ length: 41 }, (_, index) => index / 40),
      normal: Array.from({ length: 17 }, (_, index) => index / 16),
      rapid: [0, 0.915, 0.15, 0.84, 0.46, 0.99],
      reverse: Array.from({ length: 21 }, (_, index) => 1 - index / 20),
      jumps: [0, 0.84, 0.15, 0.99, 0.46, 0],
    };
    for (const [name, sequence] of Object.entries(sequences)) {
      const samples = [];
      for (const progress of sequence) {
        await seek(page, progress, name === 'slow' ? 18 : 35);
        samples.push(await interactionState(page));
      }
      check(`${tier}/motion/${name}`, samples.every((sample) => sample.live.length <= 1 && sample.inertPointerViolations === 0), samples.filter((sample) => sample.live.length > 1 || sample.inertPointerViolations));
    }

    await seek(page, 0);
    const pageDownSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(45);
      pageDownSamples.push(await interactionState(page));
    }
    check(`${tier}/motion/page-down`, pageDownSamples.every((sample) => sample.live.length <= 1 && sample.inertPointerViolations === 0), pageDownSamples.filter((sample) => sample.live.length > 1 || sample.inertPointerViolations));

    /* Keyboard focus gets a clean navigation: PageDown intentionally leaves
       native scrolling momentum that must not contaminate this assertion. */
    await prepare(page, tier);
    await seek(page, MOMENTS[tier].growth);
    const copySelector = tier === 'full' ? '[data-beat-copy="growth"]' : '[data-perf-copy="growth"]';
    await page.waitForFunction((selector) => {
      const copy = document.querySelector(selector);
      const button = copy?.querySelector('[data-cloud-cta]');
      return copy instanceof HTMLElement && !copy.inert && button instanceof HTMLButtonElement && Number(getComputedStyle(button).opacity) > 0.9;
    }, copySelector);
    const button = page.locator(`${copySelector} [data-cloud-cta]`);
    await page.mouse.move(0, 0);
    const arrow = button.locator('.cloud-cta__arrow');
    const beforeTransform = await arrow.evaluate((element) => getComputedStyle(element).transform);
    await button.hover();
    await page.waitForTimeout(240);
    const afterTransform = await arrow.evaluate((element) => getComputedStyle(element).transform);
    check(`${tier}/hover-arrow`, beforeTransform !== afterTransform, { beforeTransform, afterTransform });

    await page.keyboard.press('Tab');
    await seek(page, MOMENTS[tier].growth);
    await button.evaluate((element) => element.focus({ preventScroll: true }));
    const focus = await button.evaluate((element) => ({
      active: document.activeElement === element,
      visible: element.matches(':focus-visible'),
      outline: getComputedStyle(element).outlineStyle,
      width: parseFloat(getComputedStyle(element).outlineWidth),
    }));
    check(`${tier}/focus-visible`, focus.active && focus.visible && focus.outline !== 'none' && focus.width >= 2, focus);

    await context.close();
  }
} finally {
  await browser.close();
  preview.close();
}

report.summary = {
  passed: report.checks.filter((item) => item.passed).length,
  total: report.checks.length,
  screenshots: report.screenshots.length,
  errors: report.errors.length,
};
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
console.log(`Cloud CTA QA: ${report.summary.passed}/${report.summary.total} checks; ${report.summary.screenshots}/30 screenshots; ${report.summary.errors} errors.`);
if (report.summary.passed !== report.summary.total || report.summary.screenshots !== 30 || report.summary.errors) process.exitCode = 1;
