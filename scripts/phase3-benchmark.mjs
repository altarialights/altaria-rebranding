/**
 * Phase 3 baseline / tier runner for Altaria Lights.
 *
 * It deliberately lives outside the hero implementation. It can capture the
 * current production baseline (no `perf` query) and, later, a forced tier.
 *
 * Examples:
 *   node scripts/phase3-benchmark.mjs
 *   TIER=full OUT=review/phase3/full node scripts/phase3-benchmark.mjs
 *   node scripts/phase3-benchmark.mjs --tier balanced --out review/phase3/balanced
 *   node scripts/phase3-benchmark.mjs --static-root review/archive/dist --out review/archive/result
 *
 * Environment: BASE_URL, OUT, TIER, CPU_RATE, PW_CHROME.
 * If BASE_URL is not reachable, the script starts `astro preview` itself and
 * stops that child when the run finishes. A production `dist/` must exist.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';

const arg = (name, fallback) => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const EXPLICIT_BASE = arg('base', process.env.BASE_URL);
const STATIC_ROOT_INPUT = arg('static-root', process.env.STATIC_ROOT);
if (EXPLICIT_BASE && STATIC_ROOT_INPUT) {
  throw new Error('Usa --base/BASE_URL o --static-root, no ambos a la vez.');
}
let BASE = EXPLICIT_BASE ?? 'http://127.0.0.1:4321';
const OUT = path.resolve(arg('out', process.env.OUT ?? 'review/phase3-baseline'));
const TIER = arg('tier', process.env.TIER ?? 'baseline').toLowerCase();
const CPU_RATE = Number(arg('cpu', process.env.CPU_RATE ?? 6));
const PERF_GLOBAL_MS = Number(arg('duration', process.env.PERF_DURATION_MS ?? 6000));
const PERF_BEAT_MS = Number(arg('beat-duration', process.env.PERF_BEAT_MS ?? 720));
const PERF_IDLE_MS = Number(arg('idle-duration', process.env.PERF_IDLE_MS ?? 1500));

if (!['baseline', 'auto', 'full', 'balanced', 'lite'].includes(TIER)) {
  throw new Error(`TIER no valido: ${TIER}`);
}
if (!Number.isFinite(CPU_RATE) || CPU_RATE < 1) throw new Error('CPU_RATE debe ser >= 1');
if (!Number.isFinite(PERF_IDLE_MS) || PERF_IDLE_MS < 250) {
  throw new Error('--idle-duration debe ser >= 250 ms');
}

const VIEWPORTS = [
  { width: 1366, height: 768, id: '1366x768' },
  { width: 1920, height: 1080, id: '1920x1080' },
];

// These are the same stable Full moments used by scripts/shoot.mjs.
const MOMENTS = [
  { id: 'intro', label: 'INTRO', progress: 0.013077 },
  { id: 'phone', label: 'MOVIL', progress: 0.160192 },
  { id: 'laptop', label: 'PORTATIL', progress: 0.230154 },
  { id: 'miniweb-1', label: 'MINIWEB 1', progress: 0.32 },
  { id: 'miniweb-2', label: 'MINIWEB 2', progress: 0.46 },
  { id: 'miniweb-3', label: 'MINIWEB 3', progress: 0.59 },
  { id: 'monitor', label: 'MONITOR', progress: 0.735 },
  { id: 'tablet', label: 'TABLET', progress: 0.825 },
  { id: 'flow', label: 'FLOW', progress: 0.915 },
];

const makeUrl = ({ deterministic = false, scrubOnly = false } = {}) => {
  const url = new URL(BASE);
  if (['full', 'balanced', 'lite'].includes(TIER)) url.searchParams.set('perf', TIER);
  if (deterministic || scrubOnly) {
    url.searchParams.set('scrub', '0');
  }
  if (deterministic) {
    url.searchParams.set('still', '1');
  }
  return url.href;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1800) });
    return response.ok;
  } catch {
    return false;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function insideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveStaticFile(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://runner.local').pathname);
  } catch {
    return { error: 400 };
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return { error: 400 };
  const unresolved = path.resolve(root, `.${pathname}`);
  if (!insideRoot(root, unresolved)) return { error: 403 };

  let candidate = unresolved;
  try {
    if (statSync(candidate).isDirectory()) candidate = path.join(candidate, 'index.html');
  } catch {
    // Astro's static home is enough for this runner, but an extensionless
    // route may still legitimately map to the archived root document.
    if (!path.extname(pathname)) candidate = path.join(root, 'index.html');
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return { error: 404 };

  // Resolve symlinks before serving so a link inside the archive cannot
  // escape the selected static root.
  const realCandidate = realpathSync(candidate);
  if (!insideRoot(root, realCandidate)) return { error: 403 };
  return { file: realCandidate, stat: statSync(realCandidate) };
}

function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

async function startStaticArchive() {
  const inputRoot = path.resolve(STATIC_ROOT_INPUT);
  if (!existsSync(inputRoot) || !statSync(inputRoot).isDirectory()) {
    throw new Error(`--static-root no es un directorio: ${inputRoot}`);
  }
  const root = realpathSync(inputRoot);
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(`El dist archivado no contiene index.html: ${root}`);
  }

  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const resolved = resolveStaticFile(root, request.url ?? '/');
    if (!resolved.file) {
      response.writeHead(resolved.error ?? 404);
      response.end();
      return;
    }

    const size = resolved.stat.size;
    const range = parseByteRange(request.headers.range, size);
    if (range?.invalid) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      response.end();
      return;
    }
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES[path.extname(resolved.file).toLowerCase()] ?? 'application/octet-stream',
    };
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(resolved.file, { start, end });
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo resolver el puerto estatico.');
  BASE = `http://127.0.0.1:${address.port}`;
  return {
    kind: 'static-root',
    root,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function ensurePreview() {
  if (STATIC_ROOT_INPUT) return startStaticArchive();
  if (await reachable()) return null;
  if (!existsSync(path.resolve('dist/index.html'))) {
    throw new Error('BASE_URL no responde y no existe dist/index.html. Ejecuta primero el build.');
  }

  const astroBin = path.resolve('node_modules/astro/astro.js');
  if (!existsSync(astroBin)) throw new Error('No se encuentra Astro en node_modules.');
  const target = new URL(BASE);
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  const child = spawn(
    process.execPath,
    [astroBin, 'preview', '--host', target.hostname, '--port', port],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });

  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`astro preview termino antes de arrancar:\n${stderr}`);
    if (await reachable()) {
      return {
        kind: 'astro-preview',
        close: async () => {
          if (child.exitCode === null) child.kill();
        },
      };
    }
    await sleep(250);
  }
  child.kill();
  throw new Error(`astro preview no respondio a tiempo:\n${stderr}`);
}

async function waitForHero(page) {
  await page.waitForSelector('[data-hero]', { timeout: 15000 });
  // Harness-only override. CSS `scroll-behavior:smooth` otherwise lets a
  // requested beat keep moving while its screenshot/metrics are sampled.
  await page.addStyleTag({ content: 'html, body { scroll-behavior: auto !important; }' });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
  });
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  // The timed opening is settled after 1.5 s in the current production hero.
  await page.waitForTimeout(2100);
}

async function seek(page, progress, settle = 180) {
  const target = await page.evaluate((fraction) => {
    const hero = document.querySelector('[data-hero]');
    if (!(hero instanceof HTMLElement)) throw new Error('[data-hero] ausente');
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
    const top = hero.getBoundingClientRect().top + window.scrollY;
    const travel = Math.max(0, hero.getBoundingClientRect().height - window.innerHeight);
    const destination = top + travel * fraction;
    window.scrollTo({ top: destination, left: 0, behavior: 'instant' });
    if (document.scrollingElement) document.scrollingElement.scrollTop = destination;
    return destination;
  }, progress);
  await page.waitForFunction(
    (destination) => Math.abs(window.scrollY - destination) < 1,
    target,
    { timeout: 3000 }
  );
  await page.waitForTimeout(settle);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function freezeMedia(page) {
  await page.evaluate(async () => {
    for (const video of document.querySelectorAll('video')) {
      video.pause();
      if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
        const target = Math.min(0.6, Math.max(0, video.duration - 0.05));
        if (Math.abs(video.currentTime - target) > 0.02) {
          video.currentTime = target;
          await Promise.race([
            new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true })),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        }
      }
    }
    await Promise.all(
      [...document.images]
        .filter((image) => image.currentSrc && image.complete)
        .map((image) => image.decode?.().catch(() => undefined))
    );
  });
}

async function pageState(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    const stage = document.querySelector('[data-stage]');
    const root = document.documentElement;
    const travel = hero ? Math.max(0, hero.getBoundingClientRect().height - innerHeight) : 0;
    const top = hero ? hero.getBoundingClientRect().top + scrollY : 0;
    return {
      detectedTier:
        root.dataset.performanceTier ||
        document.querySelector('[data-hero-tier]')?.getAttribute('data-hero-tier') ||
        null,
      beat: stage?.getAttribute('data-beat') ?? null,
      progress: travel ? (scrollY - top) / travel : 0,
      scrollY,
      heroTravel: travel,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function captureBaseline(browser) {
  const captures = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.goto(makeUrl({ deterministic: true }), { waitUntil: 'networkidle' });
    await waitForHero(page);
    const folder = path.join(OUT, 'captures', viewport.id);
    mkdirSync(folder, { recursive: true });

    for (const moment of MOMENTS) {
      await seek(page, moment.progress);
      await freezeMedia(page);
      const file = path.join(folder, `${moment.id}.png`);
      const png = await page.screenshot({ path: file, animations: 'disabled' });
      captures.push({
        viewport: viewport.id,
        moment: moment.id,
        requestedProgress: moment.progress,
        file: path.relative(OUT, file).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(png).digest('hex'),
        ...(await pageState(page)),
      });
    }
    await context.close();
  }
  return captures;
}

function percentile95(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

function frameStats(stamps) {
  const deltas = [];
  for (let index = 1; index < stamps.length; index++) {
    const delta = stamps[index] - stamps[index - 1];
    if (delta > 0) deltas.push(delta);
  }
  const elapsed = deltas.reduce((sum, value) => sum + value, 0);
  return {
    frameIntervals: deltas.length,
    elapsedMs: elapsed,
    fpsApprox: elapsed > 0 ? (deltas.length * 1000) / elapsed : null,
    meanFrameMs: deltas.length ? elapsed / deltas.length : null,
    p95FrameMs: percentile95(deltas),
    maxFrameMs: deltas.length ? Math.max(...deltas) : null,
  };
}

const metricObject = (result) =>
  Object.fromEntries((result.metrics ?? []).map(({ name, value }) => [name, value]));

function metricDelta(before, after) {
  const output = {};
  for (const [name, value] of Object.entries(after)) {
    if (Number.isFinite(value) && Number.isFinite(before[name])) output[name] = value - before[name];
  }
  return output;
}

async function drive(page, from, to, durationMs) {
  return page.evaluate(
    ({ from, to, durationMs }) =>
      new Promise((resolve) => {
        const hero = document.querySelector('[data-hero]');
        if (!(hero instanceof HTMLElement)) throw new Error('[data-hero] ausente');
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
        document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
        const top = hero.getBoundingClientRect().top + scrollY;
        const travel = Math.max(0, hero.getBoundingClientRect().height - innerHeight);
        const stamps = [];
        let started;
        const frame = (now) => {
          if (started === undefined) started = now;
          const ratio = Math.min(1, (now - started) / durationMs);
          const eased = ratio * ratio * (3 - 2 * ratio);
          const destination = top + travel * (from + (to - from) * eased);
          scrollTo({ top: destination, left: 0, behavior: 'instant' });
          if (document.scrollingElement) document.scrollingElement.scrollTop = destination;
          stamps.push(now);
          if (ratio < 1) requestAnimationFrame(frame);
          else resolve(stamps);
        };
        requestAnimationFrame(frame);
      }),
    { from, to, durationMs }
  );
}

async function observeFrames(page, durationMs) {
  return page.evaluate(
    (windowMs) =>
      new Promise((resolve) => {
        const stamps = [];
        let started;
        const frame = (now) => {
          if (started === undefined) started = now;
          stamps.push(now);
          if (now - started < windowMs) requestAnimationFrame(frame);
          else resolve({ stamps, scrollY: window.scrollY, visibility: document.visibilityState });
        };
        requestAnimationFrame(frame);
      }),
    durationMs
  );
}

async function measureSegment(page, cdp, id, from, to, durationMs) {
  await seek(page, from, 900);
  const before = metricObject(await cdp.send('Performance.getMetrics'));
  const stamps = await drive(page, from, to, durationMs);
  const after = metricObject(await cdp.send('Performance.getMetrics'));
  const delta = metricDelta(before, after);
  return {
    id,
    from,
    to,
    durationRequestedMs: durationMs,
    ...frameStats(stamps),
    taskDurationMs: Number.isFinite(delta.TaskDuration) ? delta.TaskDuration * 1000 : null,
    scriptDurationMs: Number.isFinite(delta.ScriptDuration) ? delta.ScriptDuration * 1000 : null,
    layoutDurationMs: Number.isFinite(delta.LayoutDuration) ? delta.LayoutDuration * 1000 : null,
    recalcStyleDurationMs: Number.isFinite(delta.RecalcStyleDuration)
      ? delta.RecalcStyleDuration * 1000
      : null,
    performanceMetricDelta: delta,
  };
}

async function measureIdle(page, cdp, durationMs) {
  // 0.46 is a long reading hold inside the open-laptop beat and is kept
  // away from the punctual sky triggers at roughly 0.31 and 0.58.
  const state = MOMENTS.find((moment) => moment.id === 'miniweb-2');
  await seek(page, state.progress, 1300);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const before = metricObject(await cdp.send('Performance.getMetrics'));
  const observed = await observeFrames(page, durationMs);
  const after = metricObject(await cdp.send('Performance.getMetrics'));
  const delta = metricDelta(before, after);
  const frames = frameStats(observed.stamps);
  const taskDurationMs = Number.isFinite(delta.TaskDuration) ? delta.TaskDuration * 1000 : null;
  return {
    state: state.id,
    progress: state.progress,
    durationRequestedMs: durationMs,
    methodology:
      'rAF cadence and CDP Performance metric deltas while parked at a stable state; no scroll is driven during this window',
    ...frames,
    taskDurationMs,
    scriptDurationMs: Number.isFinite(delta.ScriptDuration) ? delta.ScriptDuration * 1000 : null,
    layoutDurationMs: Number.isFinite(delta.LayoutDuration) ? delta.LayoutDuration * 1000 : null,
    recalcStyleDurationMs: Number.isFinite(delta.RecalcStyleDuration)
      ? delta.RecalcStyleDuration * 1000
      : null,
    mainThreadIdleShareApprox:
      taskDurationMs !== null && frames.elapsedMs > 0
        ? Math.max(0, 1 - taskDurationMs / frames.elapsedMs)
        : null,
    scrollBefore,
    scrollAfter: observed.scrollY,
    scrollDeltaPx: observed.scrollY - scrollBefore,
    documentVisibility: observed.visibility,
    performanceMetricDelta: delta,
  };
}

async function measureVideoPlayback(page, cdp) {
  const hasVideo = await page.evaluate(() => Boolean(document.querySelector('video')));
  if (!hasVideo) return null;

  /* Warm just before the social beat, then drive a human-scale pass through
     it under the same CPU throttle. This separates decoder cadence from the
     direct-seek audit used for network/DOM snapshots. */
  await seek(page, 0.055, 650);
  const readQuality = () => page.evaluate(() => {
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) return null;
    const quality = typeof video.getVideoPlaybackQuality === 'function'
      ? video.getVideoPlaybackQuality()
      : null;
    return {
      currentTime: video.currentTime,
      paused: video.paused,
      readyState: video.readyState,
      totalVideoFrames: quality?.totalVideoFrames ?? null,
      droppedVideoFrames: quality?.droppedVideoFrames ?? null,
      corruptedVideoFrames: quality?.corruptedVideoFrames ?? null,
    };
  });
  const beforeQuality = await readQuality();
  const beforeMetrics = metricObject(await cdp.send('Performance.getMetrics'));
  const stamps = await drive(page, 0.055, 0.165, 2500);
  await page.waitForTimeout(180);
  const afterMetrics = metricObject(await cdp.send('Performance.getMetrics'));
  const afterQuality = await readQuality();
  const delta = metricDelta(beforeMetrics, afterMetrics);
  const frames = frameStats(stamps);
  const videoFrameDelta =
    beforeQuality?.totalVideoFrames !== null && afterQuality?.totalVideoFrames !== null
      ? afterQuality.totalVideoFrames - beforeQuality.totalVideoFrames
      : null;
  const droppedFrameDelta =
    beforeQuality?.droppedVideoFrames !== null && afterQuality?.droppedVideoFrames !== null
      ? afterQuality.droppedVideoFrames - beforeQuality.droppedVideoFrames
      : null;

  return {
    methodology: 'prebuffer at p=.055, then normalized scroll p=.055→.165 over 2500 ms under the configured CPU throttle',
    ...frames,
    taskDurationMs: Number.isFinite(delta.TaskDuration) ? delta.TaskDuration * 1000 : null,
    scriptDurationMs: Number.isFinite(delta.ScriptDuration) ? delta.ScriptDuration * 1000 : null,
    before: beforeQuality,
    after: afterQuality,
    videoFrameDelta,
    droppedFrameDelta,
    droppedFrameRatio:
      videoFrameDelta > 0 && droppedFrameDelta !== null
        ? droppedFrameDelta / videoFrameDelta
        : null,
  };
}

async function performanceRun(browser) {
  const viewport = VIEWPORTS[0];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.goto(makeUrl(), { waitUntil: 'networkidle' });
  await waitForHero(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  // Warm all lazy surfaces before measuring runtime; cold transfer is audited separately.
  for (const moment of MOMENTS) await seek(page, moment.progress, 90);
  await seek(page, 0, 1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });

  const halfWindow = 0.018;
  const beats = [];
  try {
    for (const moment of MOMENTS) {
      beats.push(
        await measureSegment(
          page,
          cdp,
          moment.id,
          Math.max(0, moment.progress - halfWindow),
          Math.min(0.964, moment.progress + halfWindow),
          PERF_BEAT_MS
        )
      );
    }
    const global = await measureSegment(page, cdp, 'global', 0, 0.964, PERF_GLOBAL_MS);
    const idle = await measureIdle(page, cdp, PERF_IDLE_MS);
    const video = await measureVideoPlayback(page, cdp);
    return {
      viewport: viewport.id,
      cpuThrottlingRate: CPU_RATE,
      methodology:
        'requestAnimationFrame cadence while a normalized real scroll drives the production timeline; proxy for presented FPS',
      detectedTier: (await pageState(page)).detectedTier,
      beats,
      global,
      idle,
      video,
      availablePerformanceMetrics: Object.keys(
        metricObject(await cdp.send('Performance.getMetrics'))
      ).sort(),
      paint: { available: false, reason: 'Performance.getMetrics does not expose Paint in this Chromium; trace required' },
      layerize: { available: false, reason: 'Performance.getMetrics does not expose Layerize; no value fabricated' },
      layerTree: { available: false, reason: 'LayerTree not probed by this minimal baseline run' },
    };
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
    await context.close();
  }
}

function networkCategory(item) {
  const type = item.type?.toLowerCase() ?? '';
  if (type === 'document') return 'document';
  if (type === 'stylesheet') return 'css';
  if (type === 'script') return 'js';
  if (type === 'font') return 'fonts';
  if (type === 'image') return 'images';
  if (type === 'media') return 'video';
  return 'other';
}

function summarizeRequests(items) {
  const categories = {};
  for (const item of items) {
    const key = networkCategory(item);
    categories[key] ??= { requests: 0, transferBytes: 0 };
    categories[key].requests++;
    categories[key].transferBytes += item.encodedDataLength ?? 0;
  }
  return {
    requests: items.length,
    transferBytes: items.reduce((sum, item) => sum + (item.encodedDataLength ?? 0), 0),
    categories,
  };
}

async function domSnapshot(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    const elements = hero ? [...hero.querySelectorAll('*')] : [];
    let renderedBoxes = 0;
    let viewportPaintCandidates = 0;
    let filters = 0;
    let backdropFilters = 0;
    let preserve3d = 0;
    for (const element of elements) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) renderedBoxes++;
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < innerWidth &&
        rect.top < innerHeight
      ) viewportPaintCandidates++;
      if (style.filter !== 'none') filters++;
      if (style.backdropFilter !== 'none') backdropFilters++;
      if (style.transformStyle === 'preserve-3d') preserve3d++;
    }
    const images = [...document.images].filter((image) => image.currentSrc && image.naturalWidth);
    const uniqueImages = new Map();
    for (const image of images) {
      const previous = uniqueImages.get(image.currentSrc) ?? 0;
      uniqueImages.set(image.currentSrc, Math.max(previous, image.naturalWidth * image.naturalHeight * 4));
    }
    return {
      documentElements: document.querySelectorAll('*').length,
      heroElements: elements.length + (hero ? 1 : 0),
      renderedBoxes,
      viewportPaintCandidates,
      filters,
      backdropFilters,
      preserve3d,
      imageElementsLoaded: images.length,
      uniqueDecodedImagesApprox: uniqueImages.size,
      decodedImageRgbaBytesApprox: [...uniqueImages.values()].reduce((sum, value) => sum + value, 0),
      videos: [...document.querySelectorAll('video')].map((video) => {
        const quality = typeof video.getVideoPlaybackQuality === 'function'
          ? video.getVideoPlaybackQuality()
          : null;
        return {
          srcAttribute: video.getAttribute('src'),
          currentSrc: video.currentSrc || null,
          readyState: video.readyState,
          paused: video.paused,
          currentTime: video.currentTime,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          totalVideoFrames: quality?.totalVideoFrames ?? null,
          droppedVideoFrames: quality?.droppedVideoFrames ?? null,
          corruptedVideoFrames: quality?.corruptedVideoFrames ?? null,
        };
      }),
    };
  });
}

async function auditRun(browser) {
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
    deviceScaleFactor: 1,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Performance.enable');
  const requests = new Map();
  let phase = 'initial';
  cdp.on('Network.responseReceived', ({ requestId, type, response }) => {
    requests.set(requestId, {
      requestId,
      url: response.url,
      status: response.status,
      mimeType: response.mimeType,
      type,
      phase,
      encodedDataLength: response.encodedDataLength ?? 0,
      complete: false,
    });
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const item = requests.get(requestId);
    if (item) Object.assign(item, { encodedDataLength, complete: true, phase });
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const item = requests.get(requestId);
    if (item) Object.assign(item, { failed: errorText, complete: true, phase });
  });

  // Keep the real lifecycle active here: `still=1` intentionally skips the
  // reel controller, which would make a Full network audit miss the MP4.
  await page.goto(makeUrl({ scrubOnly: true }), { waitUntil: 'networkidle' });
  await waitForHero(page);
  const initialDom = await domSnapshot(page);
  const initialItems = [...requests.values()].filter((item) => item.complete);
  phase = 'hero';
  const states = [];
  for (const moment of MOMENTS) {
    await seek(page, moment.progress, moment.id === 'phone' ? 850 : 180);
    states.push({ id: moment.id, progress: moment.progress, dom: await domSnapshot(page) });
  }
  await page.waitForTimeout(900);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
  const [runtimeHeap, domCounters, metrics] = await Promise.all([
    cdp.send('Runtime.getHeapUsage').catch(() => null),
    cdp.send('Memory.getDOMCounters').catch(() => null),
    cdp.send('Performance.getMetrics').then(metricObject),
  ]);
  const allItems = [...requests.values()].filter((item) => item.complete);
  const result = {
    viewport: VIEWPORTS[0].id,
    detectedTier: (await pageState(page)).detectedTier,
    network: {
      note: 'CDP Network.loadingFinished encodedDataLength with cache disabled; local Astro preview is comparative, not CDN transfer',
      initial: summarizeRequests(initialItems),
      afterHeroTotal: summarizeRequests(allItems),
      requests: allItems.map(({ requestId, ...item }) => item),
    },
    dom: { initial: initialDom, states },
    heapApprox: {
      note: 'Chromium JS/runtime heap only; not total process or GPU memory',
      runtimeHeap,
      domCounters,
      performanceMetrics: metrics,
    },
  };
  await context.close();
  return result;
}

mkdirSync(OUT, { recursive: true });
let previewHandle;
let browser;
try {
  previewHandle = await ensurePreview();
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROME || undefined,
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const startedAt = new Date().toISOString();
  const captures = await captureBaseline(browser);
  const audit = await auditRun(browser);
  const performance = await performanceRun(browser);
  const summary = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE,
    requestedTier: TIER,
    forcedTierQuery: ['full', 'balanced', 'lite'].includes(TIER) ? TIER : null,
    browser: { name: 'chromium', version: browser.version() },
    config: {
      output: OUT,
      serverKind: previewHandle?.kind ?? 'external-base-url',
      staticRoot: previewHandle?.root ?? null,
      viewports: VIEWPORTS,
      cpuRate: CPU_RATE,
      performanceGlobalMs: PERF_GLOBAL_MS,
      performanceBeatMs: PERF_BEAT_MS,
      performanceIdleMs: PERF_IDLE_MS,
      moments: MOMENTS,
    },
    captures,
    audit,
    performance,
  };
  const outputFile = path.join(OUT, 'summary.json');
  writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Phase 3 benchmark completado: ${outputFile}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (previewHandle) await previewHandle.close().catch(() => undefined);
}
