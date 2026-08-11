#!/usr/bin/env node

/**
 * Targeted QA for the Balanced visual iteration. It validates the sun state
 * machine, reel lifecycle, reversible device choreography, fast scroll and
 * the approved final composition, then captures the requested visual set.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4334';
const TIER = process.env.TIER === 'lite' ? 'lite' : 'balanced';
const OUT = path.resolve(process.env.OUT ?? `review/${TIER}-visual-iteration/final-qa`);
const CAPTURES = path.join(OUT, 'screenshots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOMENTS = [
  ['intro', 0.013077],
  ['phone', 0.13],
  ['miniweb-1', 0.32],
  ['miniweb-2', 0.46],
  ['miniweb-3', 0.59],
  ['monitor', 0.735],
  ['tablet', 0.825],
  ['flow', 0.915],
];

const VIEWPORTS = [
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

mkdirSync(CAPTURES, { recursive: true });

async function reachable() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensurePreview() {
  if (await reachable()) return { kind: 'existing', close: async () => {} };
  if (!existsSync(path.resolve('dist/index.html'))) throw new Error('Falta dist/index.html.');
  const target = new URL(BASE);
  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/astro/astro.js'), 'preview', '--host', target.hostname, '--port', target.port],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Preview terminó antes de tiempo:\n${stderr}`);
    if (await reachable()) {
      return { kind: 'astro-preview', close: async () => child.exitCode === null && child.kill() };
    }
    await sleep(120);
  }
  child.kill();
  throw new Error(`Preview no disponible:\n${stderr}`);
}

function url() {
  const target = new URL(BASE);
  target.searchParams.set('perf', TIER);
  target.searchParams.set('scrub', '0');
  return target.href;
}

async function prepare(page) {
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((tier) =>
    document.documentElement.dataset.performanceTier === tier &&
    document.querySelector('[data-hero-tier-phase="ready"]')
  , TIER, { timeout: 15_000 });
  await page.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}' });
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.waitForTimeout(140);
}

async function seek(page, progress, settle = 220) {
  await page.evaluate((fraction) => {
    const hero = document.querySelector('[data-hero]');
    if (!(hero instanceof HTMLElement)) throw new Error('Hero ausente');
    const top = hero.getBoundingClientRect().top + scrollY;
    const travel = Math.max(0, hero.offsetHeight - innerHeight);
    const destination = top + travel * fraction;
    scrollTo({ top: destination, left: 0, behavior: 'instant' });
    if (document.scrollingElement) document.scrollingElement.scrollTop = destination;
  }, progress);
  await page.waitForTimeout(settle);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function clickSun(page) {
  const sun = page.locator('[data-perf-easter="sun"]');
  const box = await sun.boundingBox();
  if (!box) throw new Error('Sol no visible');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function sunState(page) {
  return page.evaluate(() => {
    const message = document.querySelector('[data-perf-sun-message]');
    const bubble = document.querySelector('[data-perf-sun-bubble]');
    const sun = document.querySelector('[data-perf-easter="sun"]');
    return {
      fullHidden: message?.hidden,
      bubbleHidden: bubble?.hidden,
      stageOpen: document.querySelector('[data-performance-stage]')?.getAttribute('data-perf-sun-open'),
      sunAnimations: sun?.getAnimations().length ?? 0,
      messageCount: document.querySelectorAll('[data-perf-sun-message]').length,
      bubbleCount: document.querySelectorAll('[data-perf-sun-bubble]').length,
    };
  });
}

async function objectState(page) {
  return page.evaluate(() => {
    const opacity = (selector) => {
      const element = document.querySelector(selector);
      return element ? Number(getComputedStyle(element).opacity) : -1;
    };
    return {
      phone: opacity('[data-perf-object="phone"]'),
      laptop: opacity('[data-perf-object="laptop"]'),
      monitor: opacity('[data-perf-object="monitor"]'),
      tablet: opacity('[data-perf-object="tablet"]'),
      flow: opacity('[data-perf-object="flow"]'),
      beat: document.querySelector('[data-performance-hero]')?.getAttribute('data-performance-beat'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function interactionAudit(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });

  try {
    await prepare(page);
    const initialVideo = await page.evaluate(() => {
      const video = document.querySelector('[data-perf-reel]');
      return {
        paused: video?.paused,
        readyState: video?.readyState,
        currentSrc: video?.currentSrc,
        mp4Resources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.mp4')).length,
      };
    });
    check('reel-cold-before-beat', initialVideo.mp4Resources === 0 && !requests.some((item) => item.includes('.mp4')), initialVideo);

    await seek(page, 0.075, 180);
    await seek(page, 0.12, 900);
    const playing = await page.evaluate(() => {
      const video = document.querySelector('[data-perf-reel]');
      const quality = video?.getVideoPlaybackQuality?.();
      return {
        paused: video?.paused,
        readyState: video?.readyState,
        frames: quality?.totalVideoFrames ?? 0,
        dropped: quality?.droppedVideoFrames ?? 0,
      };
    });
    check('reel-plays-only-in-phone-beat', playing.paused === false && playing.frames > 0, playing);

    await seek(page, 0.19, 180);
    const pausedBefore = await page.evaluate(() => {
      const video = document.querySelector('[data-perf-reel]');
      return { paused: video?.paused, frames: video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 };
    });
    await page.waitForTimeout(650);
    const pausedAfter = await page.evaluate(() => {
      const video = document.querySelector('[data-perf-reel]');
      return { paused: video?.paused, frames: video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 };
    });
    check('reel-pauses-and-stops-decoding', pausedAfter.paused === true && pausedAfter.frames - pausedBefore.frames <= 1, { pausedBefore, pausedAfter });

    await seek(page, 0.12, 650);
    const reverseReel = await page.evaluate(() => {
      const video = document.querySelector('[data-perf-reel]');
      return { paused: video?.paused, frames: video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 };
    });
    check('reel-restarts-on-reverse-scroll', reverseReel.paused === false && reverseReel.frames > pausedAfter.frames, reverseReel);

    await seek(page, 0.013077, 180);
    const domBefore = await sunState(page);
    await clickSun(page);
    await page.waitForTimeout(180);
    const first = await sunState(page);
    check('sun-click-1-full-sky', first.fullHidden === false && first.stageOpen === '1' && first.bubbleHidden === true, first);
    await page.waitForTimeout(TIER === 'lite' ? 5250 : 6250);
    const orderedExit = await page.evaluate(() => {
      const message = document.querySelector('[data-perf-sun-message]');
      const intro = document.querySelector('[data-perf-sun-intro]');
      const line = document.querySelector('[data-perf-sun-line]');
      return {
        hidden: message?.hidden,
        skyOpacity: message ? Number(getComputedStyle(message).opacity) : 0,
        introOpacity: intro ? Number(getComputedStyle(intro).opacity) : 1,
        lineOpacity: line ? Number(getComputedStyle(line).opacity) : 1,
      };
    });
    check(
      'sun-exit-copy-before-sky',
      orderedExit.hidden === false &&
        orderedExit.skyOpacity >= 0.35 &&
        orderedExit.introOpacity <= 0.08 &&
        orderedExit.lineOpacity <= 0.08,
      orderedExit
    );
    await page.waitForTimeout(520);
    const closedAutomatically = await sunState(page);
    check(
      'sun-closes-automatically',
      closedAutomatically.fullHidden === true && closedAutomatically.stageOpen === null,
      closedAutomatically
    );

    await clickSun(page);
    await page.waitForTimeout(100);
    const second = await sunState(page);
    check('sun-click-2-pulse-only', second.fullHidden === true && second.bubbleHidden === true && second.sunAnimations > 0, second);
    await page.waitForTimeout(760);
    await clickSun(page);
    await page.waitForTimeout(100);
    const third = await sunState(page);
    check('sun-click-3-encore-only', third.fullHidden === true && third.bubbleHidden === false, third);

    await page.waitForTimeout(2140);
    await seek(page, 0.2, 80);
    await seek(page, 0.013077, 100);
    await clickSun(page);
    await page.waitForTimeout(100);
    const afterScrollEncore = await sunState(page);
    check('sun-state-persists-after-scroll', afterScrollEncore.fullHidden === true && afterScrollEncore.bubbleHidden === false, afterScrollEncore);
    check('sun-no-duplicate-dom', afterScrollEncore.messageCount === domBefore.messageCount && afterScrollEncore.bubbleCount === domBefore.bubbleCount, { domBefore, afterScrollEncore });

    const choreography = [
      ['phone', 0.13], ['laptop', 0.32], ['monitor', 0.72], ['tablet', 0.82], ['flow', 0.915],
    ];
    const forward = [];
    for (const [id, progress] of choreography) {
      await seek(page, progress, 120);
      forward.push({ id, state: await objectState(page) });
    }
    const reverse = [];
    for (const [id, progress] of [...choreography].reverse()) {
      await seek(page, progress, 120);
      reverse.push({ id, state: await objectState(page) });
    }
    const validFrame = ({ id, state }) => {
      const active = state[id];
      if (active < 0.72) return false;
      if (id === 'flow') return ['phone', 'laptop', 'monitor', 'tablet'].every((key) => state[key] <= 0.08);
      return true;
    };
    check('devices-exit-forward', forward.every(validFrame), forward);
    check('devices-return-on-reverse', reverse.every(validFrame), reverse);

    for (const progress of [0.02, 0.915, 0.12, 0.825, 0.32, 0.98, 0.915]) {
      await seek(page, progress, 12);
    }
    await page.waitForTimeout(240);
    const fast = await objectState(page);
    check('fast-scroll-settles-cleanly', fast.beat === 'system' && fast.flow >= 0.72 && fast.overflowX <= 1 && errors.length === 0, { fast, errors });

    await seek(page, 0.995, 160);
    const ending = await page.evaluate(() => {
      const fallback = document.querySelector('[data-hero-boot-fallback]');
      return {
        fallbackHidden: fallback?.hidden,
        fallbackDisplay: fallback ? getComputedStyle(fallback).display : null,
        debugHidden: document.querySelector('[data-performance-debug]')?.hidden,
        debugText: document.querySelector('[data-performance-debug-text]')?.textContent ?? '',
      };
    });
    check('no-invented-epilogue', ending.fallbackHidden === true && ending.fallbackDisplay === 'none', ending);
    check('debug-hidden-without-query', ending.debugHidden !== false && ending.debugText === '', ending);

    return { checks, passed: checks.every((item) => item.passed), errors, requests };
  } finally {
    await context.close();
  }
}

async function captureVisuals(browser) {
  const files = [];
  for (const viewport of VIEWPORTS) {
    const folder = path.join(CAPTURES, viewport.id);
    mkdirSync(folder, { recursive: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    await prepare(page);
    for (const [id, progress] of MOMENTS) {
      await seek(page, progress, id === 'phone' ? 700 : 280);
      if (id === 'flow') {
        await page.waitForFunction(() => {
          const image = document.querySelector('[data-perf-flow-image]');
          return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
        }, undefined, { timeout: 4000 });
      }
      const file = path.join(folder, `${id}.png`);
      await page.screenshot({ path: file });
      files.push(path.relative(OUT, file).replaceAll('\\', '/'));
    }
    await seek(page, 0.013077, 160);
    await clickSun(page);
    await page.waitForTimeout(1500);
    const easter = path.join(folder, 'easter-egg.png');
    await page.screenshot({ path: easter });
    files.push(path.relative(OUT, easter).replaceAll('\\', '/'));
    await context.close();
  }
  return files;
}

async function auditGrowthCopy(browser) {
  const cases = [];
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    await prepare(page);
    await seek(page, 0.915, 180);
    const state = await page.evaluate(() => {
      const copy = document.querySelector('[data-perf-copy="growth"]');
      const cloud = copy?.querySelector('.perf-copy__cloud');
      const lines = [...(copy?.querySelectorAll('[data-perf-copy-line]') ?? [])];
      const rect = (element) => {
        const value = element?.getBoundingClientRect();
        return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom } : null;
      };
      return {
        cloud: rect(cloud),
        lines: lines.map(rect),
        fontSize: Number.parseFloat(getComputedStyle(copy?.querySelector('.perf-copy__title') ?? document.body).fontSize),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const minimumAir = viewport.width <= 1152 ? 18 : 24;
    const passed = Boolean(
      state.cloud &&
      state.lines.length === 2 &&
      state.lines.every((line) => line &&
        line.left >= state.cloud.left + minimumAir &&
        line.right <= state.cloud.right - minimumAir &&
        line.top >= state.cloud.top + minimumAir &&
        line.bottom <= state.cloud.bottom - minimumAir
      ) &&
      state.fontSize >= 30 &&
      state.overflowX <= 1
    );
    cases.push({ viewport: viewport.id, passed, minimumAir, state });
    await context.close();
  }
  return cases;
}

const report = { startedAt: new Date().toISOString(), base: BASE, interaction: null, growthCopy: [], screenshots: [] };
let preview;
let browser;
try {
  preview = await ensurePreview();
  report.server = preview.kind;
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();
  report.interaction = await interactionAudit(browser);
  report.growthCopy = await auditGrowthCopy(browser);
  report.screenshots = await captureVisuals(browser);
} finally {
  if (browser) await browser.close();
  if (preview) await preview.close();
}
report.finishedAt = new Date().toISOString();
report.passed = Boolean(
  report.interaction?.passed &&
  report.growthCopy.every((item) => item.passed) &&
  report.screenshots.length === 18
);
writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Balanced visual QA: ${report.interaction.checks.filter((item) => item.passed).length}/${report.interaction.checks.length} checks PASS; copy ${report.growthCopy.filter((item) => item.passed).length}/${report.growthCopy.length}; ${report.screenshots.length}/18 screenshots.`);
console.log(`Informe: ${path.join(OUT, 'summary.json')}`);
if (!report.passed) process.exitCode = 1;
