import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4327/';
const out = process.env.OUT_DIR ?? 'review/responsive-hero/performance';
const cases = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const item of cases) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: item.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Performance.enable');
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  let transferBytes = 0;
  const requestUrls = [];
  session.on('Network.requestWillBeSent', ({ request }) => requestUrls.push(request.url));
  session.on('Network.loadingFinished', ({ encodedDataLength }) => {
    transferBytes += encodedDataLength;
  });

  await page.addInitScript(() => {
    window.__responsiveVitals = { cls: 0, lcp: 0, longTasks: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__responsiveVitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__responsiveVitals.lcp = entries.at(-1)?.startTime ?? 0;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      window.__responsiveVitals.longTasks += list.getEntries().length;
    }).observe({ type: 'longtask', buffered: true });
  });

  const started = performance.now();
  await page.goto(base, { waitUntil: 'networkidle' });
  const loadWallMs = performance.now() - started;

  const motion = await page.evaluate(async () => {
    const deltas = [];
    const bottom = document.documentElement.scrollHeight - innerHeight;
    const duration = 1800;
    let previous = performance.now();
    const start = previous;
    await new Promise((resolve) => {
      const frame = (now) => {
        deltas.push(now - previous);
        previous = now;
        const progress = Math.min(1, (now - start) / duration);
        scrollTo(0, bottom * progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    deltas.sort((a, b) => a - b);
    return {
      frames: deltas.length,
      fps: deltas.length / (duration / 1000),
      p95Ms: deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))],
      maxMs: deltas.at(-1),
    };
  });

  await page.waitForTimeout(1500);
  const idle = await page.evaluate(async () => {
    const deltas = [];
    const duration = 1200;
    let previous = performance.now();
    const start = previous;
    await new Promise((resolve) => {
      const frame = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (now - start < duration) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    deltas.sort((a, b) => a - b);
    return {
      frames: deltas.length,
      fps: deltas.length / (duration / 1000),
      p95Ms: deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))],
      maxMs: deltas.at(-1),
    };
  });

  const metrics = await session.send('Performance.getMetrics');
  const metric = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
  const snapshot = await page.evaluate(() => ({
    vitals: window.__responsiveVitals,
    domNodes: document.querySelectorAll('*').length,
    responsiveNodes: document.querySelector('[data-responsive-hero]')?.querySelectorAll('*').length ?? 0,
    height: document.documentElement.scrollHeight,
  }));
  const responsiveAssets = requestUrls.filter((url) => url.includes('/media/hero-responsive/optimized/'));
  const forbiddenDesktop = requestUrls.filter((url) =>
    /hero-full|hero-balanced|hero-lite|hero-tier-bootstrap|performance-hero-timeline|reel-poster\.jpg|reel-mobile\.mp4/.test(url),
  );

  results.push({
    ...item,
    loadWallMs,
    transferBytes,
    requests: requestUrls.length,
    responsiveAssets,
    forbiddenDesktop,
    motion,
    idle,
    jsHeapBytes: metric.JSHeapUsedSize,
    taskDurationMs: metric.TaskDuration * 1000,
    scriptDurationMs: metric.ScriptDuration * 1000,
    layoutDurationMs: metric.LayoutDuration * 1000,
    recalcStyleDurationMs: metric.RecalcStyleDuration * 1000,
    ...snapshot,
  });
  await page.screenshot({ path: `${out}/${item.name}.png`, fullPage: false });
  await context.close();
}

await browser.close();
await writeFile(`${out}/summary.json`, JSON.stringify({ cpuThrottle: 6, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
