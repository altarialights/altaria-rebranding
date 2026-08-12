import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4321/';
const browser = await chromium.launch({ headless: true });
const results = [];

function assertTierSnapshot(snapshot, expected) {
  assert.equal(snapshot.htmlTier, expected, 'html tier');
  assert.equal(snapshot.outletTier, expected, 'outlet tier');
  assert.equal(snapshot.phase, 'ready', 'outlet ready');
  assert.equal(snapshot.activeHeroes, 1, 'one active hero');
  assert.equal(snapshot.templates, 0, 'inactive templates removed');
  assert.equal(snapshot.state.tier, expected, 'boot state tier');
  assert.equal(snapshot.state.locked, true, 'tier locked');
  const expectedLockReason = snapshot.state.override
    ? 'manual-override'
    : snapshot.state.signals.viewportWidth < 1020
      ? 'existing-compact-viewport'
      : 'before-runtime-import';
  assert.equal(snapshot.state.lockReason, expectedLockReason);
  assert.equal(snapshot.deferredMedia, 0, 'selected media restored');
}

async function installHarness(context, options = {}) {
  await context.addInitScript((config) => {
    const defineNavigatorValue = (name, value) => {
      Object.defineProperty(navigator, name, {
        configurable: true,
        get: () => value,
      });
    };

    if (config.capabilities) {
      defineNavigatorValue('deviceMemory', config.capabilities.memory);
      defineNavigatorValue('hardwareConcurrency', config.capabilities.cores);
      defineNavigatorValue(
        'connection',
        config.capabilities.connection
          ? {
              saveData: !!config.capabilities.connection.saveData,
              effectiveType: config.capabilities.connection.effectiveType ?? null,
            }
          : undefined
      );
    }

    window.__phase3Trace = [];
    window.__phase3Ready = null;
    window.__phase3Lifecycle = { pageshow: [], pagehide: [] };
    window.addEventListener('pageshow', (event) => {
      window.__phase3Lifecycle.pageshow.push({ persisted: event.persisted, at: performance.now() });
    });
    window.addEventListener('pagehide', (event) => {
      window.__phase3Lifecycle.pagehide.push({ persisted: event.persisted, at: performance.now() });
    });
    let performanceState;
    Object.defineProperty(window, '__ALTARIA_PERFORMANCE__', {
      configurable: true,
      get: () => performanceState,
      set: (state) => {
        performanceState = state;
        const originalFinalise = state.finaliseFrameHealth.bind(state);
        state.finaliseFrameHealth = (settings) => {
          window.__phase3Trace.push({ event: 'finalise-start', at: performance.now() });
          const report = originalFinalise(settings);
          window.__phase3Trace.push({ event: 'finalise-end', at: performance.now(), report });
          return report;
        };
        const originalLock = state.lock.bind(state);
        state.lock = (reason) => {
          window.__phase3Trace.push({ event: 'lock-call', at: performance.now(), reason });
          return originalLock(reason);
        };
      },
    });

    document.addEventListener('altaria:hero-tier-ready', (event) => {
      const result = event.detail;
      window.__phase3Ready = {
        tier: result.tier,
        remounted: result.remounted,
        frameHealth: result.frameHealth,
        debug: result.debug,
        at: performance.now(),
      };
    });

    if (config.sessionTier) {
      try {
        sessionStorage.setItem(
          'altaria:performance-tier:downgrade:v1',
          JSON.stringify({ version: 1, tier: config.sessionTier })
        );
      } catch {
        // The assertion after navigation will expose a storage failure.
      }
    }

    if (config.slowRafMs) {
      const nativeRaf = window.requestAnimationFrame.bind(window);
      let syntheticNow = performance.now();
      window.requestAnimationFrame = (callback) =>
        nativeRaf((realNow) => {
          const state = window.__ALTARIA_PERFORMANCE__;
          if (!state || !state.locked) {
            syntheticNow = Math.max(syntheticNow, realNow) + config.slowRafMs;
            callback(syntheticNow);
          } else {
            callback(realNow);
          }
        });
    }
  }, options);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const state = window.__ALTARIA_PERFORMANCE__;
    const outlet = document.querySelector('[data-hero-tier-outlet]');
    return {
      htmlTier: document.documentElement.dataset.performanceTier,
      outletTier: outlet?.dataset.heroTier ?? null,
      phase: outlet?.dataset.heroTierPhase ?? null,
      activeHeroes: document.querySelectorAll('[data-hero]').length,
      templates: document.querySelectorAll('template[data-hero-tier-template]').length,
      deferredMedia: document.querySelectorAll(
        '[data-performance-src],[data-performance-srcset],[data-performance-poster]'
      ).length,
      lateMedia: document.querySelectorAll(
        '[data-performance-late-src],[data-performance-late-srcset]'
      ).length,
      fullHero: document.querySelectorAll('.hero[data-hero]').length,
      adaptiveHero: document.querySelectorAll('[data-performance-hero]').length,
      videos: document.querySelectorAll('[data-hero] video').length,
      fullVideos: document.querySelectorAll('[data-hero] video[data-reel]').length,
      adaptiveVideos: document.querySelectorAll('[data-hero] video[data-perf-reel]').length,
      state: {
        tier: state.tier,
        preliminaryTier: state.preliminaryTier,
        override: state.override,
        source: state.source,
        locked: state.locked,
        lockReason: state.lockReason,
        restoredScroll: state.restoredScroll,
        runtimeDowngrade: { ...state.runtimeDowngrade },
        frameHealth: state.frameHealth ? { ...state.frameHealth } : null,
        signals: { ...state.signals },
      },
      ready: window.__phase3Ready,
      trace: window.__phase3Trace,
      lifecycle: window.__phase3Lifecycle,
      resources: performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        initiatorType: entry.initiatorType,
      })),
      heroScroll: getComputedStyle(document.documentElement).getPropertyValue('--hero-scroll').trim(),
      scrollY: window.scrollY,
      debugVisible: !document.querySelector('[data-performance-debug]')?.hidden,
      debugText: document.querySelector('[data-performance-debug-text]')?.textContent ?? '',
    };
  });
}

async function openCase({ activeBrowser = browser, query = '', viewport = { width: 1366, height: 768 }, reducedMotion, capabilities, sessionTier, slowRafMs } = {}) {
  const contextOptions = { viewport };
  if (reducedMotion) contextOptions.reducedMotion = reducedMotion;
  const context = await activeBrowser.newContext(contextOptions);
  await installHarness(context, { capabilities, sessionTier, slowRafMs });
  const page = await context.newPage();
  const requests = [];
  const pageErrors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(new URL(query, BASE).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-hero-tier-phase="ready"]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(80);
  return { context, page, requests, pageErrors, value: await snapshot(page) };
}

function runtimeRequests(requests) {
  return requests
    .map((url) => new URL(url).pathname.split('/').pop())
    .filter((name) => /^hero-(?:full|balanced|lite)\./.test(name));
}

function assertRuntimeIsolation(value, requests, tier) {
  const entries = runtimeRequests(requests);
  assert.equal(entries.filter((name) => name.startsWith(`hero-${tier}.`)).length, 1);
  for (const other of ['full', 'balanced', 'lite'].filter((candidate) => candidate !== tier)) {
    assert.equal(entries.some((name) => name.startsWith(`hero-${other}.`)), false);
  }
  if (tier === 'full') {
    assert.equal(value.fullHero, 1);
    assert.equal(value.adaptiveHero, 0);
    assert.equal(value.fullVideos, 1);
    assert.ok(value.lateMedia >= 1, 'Full reel source remains cold at p=0');
  } else {
    assert.equal(value.fullHero, 0);
    assert.equal(value.adaptiveHero, 1);
    assert.equal(value.fullVideos, 0);
    assert.equal(value.adaptiveVideos, 1);
    /* Adaptive flow art is intentionally late-bound; isolation means the
       inactive tier is absent, not that the selected tree has no lazy media. */
    assert.ok(value.lateMedia <= 1);
  }
  assert.equal(requests.some((url) => /reel-altaria\.mp4(?:$|\?)/.test(url)), false);
}

function assertBootBeforeRuntime(value, tier) {
  const finalise = value.trace.find((entry) => entry.event === 'finalise-end');
  const lock = value.trace.find((entry) => entry.event === 'lock-call');
  const runtime = value.resources.find((entry) => {
    const name = new URL(entry.name).pathname.split('/').pop() ?? '';
    return name.startsWith(`hero-${tier}.`) && name.endsWith('.js');
  });
  assert.ok(finalise, 'frame health finalised');
  assert.ok(lock, 'lock called');
  assert.ok(runtime, 'selected runtime resource found');
  assert.ok(finalise.at <= lock.at + 0.25, 'finalise happens before lock');
  assert.ok(lock.at <= runtime.startTime + 0.25, 'lock happens before runtime request');
}

async function qa(name, task) {
  const started = Date.now();
  try {
    const detail = await task();
    const skipped = detail?.skipped === true;
    results.push({ name, ok: true, skipped, ms: Date.now() - started, detail });
    console.log(`${skipped ? 'SKIP' : 'PASS'} ${name}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.stack ?? String(error) });
    console.error(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

for (const tier of ['full', 'balanced', 'lite']) {
  await qa(`override ${tier}: mount, lock, runtime and asset isolation`, async () => {
    const run = await openCase({ query: `?perf=${tier}` });
    try {
      assertTierSnapshot(run.value, tier);
      assert.equal(run.value.state.override, tier);
      assert.equal(run.value.state.source, 'manual-override');
      assert.equal(run.value.ready.frameHealth.skipped, 'manual-override');
      assert.equal(run.value.ready.remounted, false);
      assertRuntimeIsolation(run.value, run.requests, tier);
      assertBootBeforeRuntime(run.value, tier);
      assert.deepEqual(run.pageErrors, []);
      const lockProbe = await run.page.evaluate(() => ({
        changed: window.__ALTARIA_PERFORMANCE__.downgrade('lite', 'qa-after-lock'),
        tier: window.__ALTARIA_PERFORMANCE__.tier,
      }));
      assert.equal(lockProbe.changed, false);
      assert.equal(lockProbe.tier, tier);
      if (tier === 'full') {
        await run.page.evaluate(() => window.scrollTo(0, 120));
        await run.page.waitForTimeout(30);
        assert.equal(
          await run.page.locator('[data-performance-late-src]').count(),
          0,
          'first scroll releases the selected Full reel URL'
        );
      }
      return { scripts: runtimeRequests(run.requests), requests: run.requests.length };
    } finally {
      await run.context.close();
    }
  });
}

const automaticCases = [
  ['strong => full', { memory: 8, cores: 8 }, 'full'],
  ['borderline => balanced', { memory: 8, cores: 4 }, 'balanced'],
  ['clearly limited => lite', { memory: 4, cores: 4 }, 'lite'],
  ['unknown => balanced', { memory: undefined, cores: undefined }, 'balanced'],
  [
    'saveData prevents full',
    { memory: 8, cores: 8, connection: { saveData: true, effectiveType: '4g' } },
    'balanced',
  ],
  [
    'slow network prevents full',
    { memory: 8, cores: 8, connection: { saveData: false, effectiveType: '2g' } },
    'balanced',
  ],
];

for (const [label, capabilities, expected] of automaticCases) {
  await qa(`automatic ${label}`, async () => {
    const run = await openCase({ capabilities });
    try {
      assertTierSnapshot(run.value, expected);
      assert.equal(run.value.state.override, null);
      assertRuntimeIsolation(run.value, run.requests, expected);
      assert.deepEqual(run.pageErrors, []);
      return {
        preliminary: run.value.state.preliminaryTier,
        final: run.value.state.tier,
        reason: run.value.ready.debug.reason,
      };
    } finally {
      await run.context.close();
    }
  });
}

await qa('invalid perf value falls back to automatic resolver', async () => {
  const run = await openCase({ query: '?perf=potato', capabilities: { memory: 8, cores: 8 } });
  try {
    assertTierSnapshot(run.value, 'full');
    assert.equal(run.value.state.override, null);
    assert.equal(run.value.state.source, 'automatic');
    return run.value.ready.debug.reason;
  } finally {
    await run.context.close();
  }
});

await qa('session value only downgrades and manual override still wins', async () => {
  const run = await openCase({
    capabilities: { memory: 8, cores: 8 },
    sessionTier: 'lite',
  });
  try {
    assertTierSnapshot(run.value, 'lite');
    assert.equal(run.value.state.preliminaryTier, 'full');
    assert.equal(run.value.state.source, 'session-downgrade');
    await run.page.goto(new URL('?perf=full', BASE).href, { waitUntil: 'domcontentloaded' });
    await run.page.locator('[data-hero-tier-phase="ready"]').waitFor();
    const manual = await snapshot(run.page);
    assertTierSnapshot(manual, 'full');
    assert.equal(manual.state.override, 'full');
    return { auto: run.value.state.source, manual: manual.state.source };
  } finally {
    await run.context.close();
  }
});

await qa('session value never upgrades an automatically Lite device', async () => {
  const run = await openCase({
    capabilities: { memory: 4, cores: 4 },
    sessionTier: 'balanced',
  });
  try {
    assertTierSnapshot(run.value, 'lite');
    assert.equal(run.value.state.source, 'automatic');
    return run.value.ready.debug.reason;
  } finally {
    await run.context.close();
  }
});

await qa('real-frame Full downgrade remounts Balanced before runtime import', async () => {
  const run = await openCase({ capabilities: { memory: 8, cores: 8 }, slowRafMs: 55 });
  try {
    assertTierSnapshot(run.value, 'balanced');
    assert.equal(run.value.state.preliminaryTier, 'full');
    assert.equal(run.value.state.runtimeDowngrade.from, 'full');
    assert.equal(run.value.state.runtimeDowngrade.to, 'balanced');
    assert.equal(run.value.ready.remounted, true);
    assertRuntimeIsolation(run.value, run.requests, 'balanced');
    assertBootBeforeRuntime(run.value, 'balanced');
    const persisted = await run.page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('altaria:performance-tier:downgrade:v1'))
    );
    assert.equal(persisted.tier, 'balanced');
    return run.value.ready.frameHealth;
  } finally {
    await run.context.close();
  }
});

await qa('real-frame Balanced downgrade remounts Lite before runtime import', async () => {
  const run = await openCase({ capabilities: { memory: 8, cores: 4 }, slowRafMs: 180 });
  try {
    assertTierSnapshot(run.value, 'lite');
    assert.equal(run.value.state.preliminaryTier, 'balanced');
    assert.equal(run.value.state.runtimeDowngrade.from, 'balanced');
    assert.equal(run.value.state.runtimeDowngrade.to, 'lite');
    assert.equal(run.value.ready.remounted, true);
    assertRuntimeIsolation(run.value, run.requests, 'lite');
    const persisted = await run.page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('altaria:performance-tier:downgrade:v1'))
    );
    assert.equal(persisted.tier, 'lite');
    return run.value.ready.frameHealth;
  } finally {
    await run.context.close();
  }
});

await qa('hash/deep navigation blocks calibration and remount', async () => {
  const run = await openCase({
    query: '#contacto',
    capabilities: { memory: 8, cores: 4 },
    slowRafMs: 120,
  });
  try {
    assertTierSnapshot(run.value, 'balanced');
    assert.equal(run.value.state.restoredScroll, true);
    assert.equal(run.value.ready.frameHealth.skipped, 'restored-or-active-scroll');
    assert.equal(run.value.ready.remounted, false);
    const anchor = await run.page.locator('#contacto').evaluate((element) => ({
      top: Math.round(element.getBoundingClientRect().top),
      y: Math.round(window.scrollY),
      maxY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    }));
    /* The short final section cannot reach top:0 because the document ends;
       reaching max scroll with the target visible is the correct clamp. */
    assert.ok(anchor.y >= anchor.maxY - 2, 'deep link reaches the document end');
    assert.ok(anchor.top >= 0 && anchor.top < 768, 'deep-link target is visible');
    return { scrollY: run.value.scrollY, frameHealth: run.value.ready.frameHealth };
  } finally {
    await run.context.close();
  }
});

await qa('reload at mid-hero blocks calibration and preserves restored scroll', async () => {
  const run = await openCase({ capabilities: { memory: 8, cores: 4 } });
  try {
    await run.page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.35)));
    await run.page.waitForTimeout(80);
    const before = await run.page.evaluate(() => window.scrollY);
    assert.ok(before > 1000, 'page was moved into hero');
    await run.page.reload({ waitUntil: 'domcontentloaded' });
    await run.page.locator('[data-hero-tier-phase="ready"]').waitFor({ timeout: 20_000 });
    await run.page.waitForTimeout(100);
    const restored = await snapshot(run.page);
    assertTierSnapshot(restored, 'balanced');
    assert.ok(restored.scrollY > 1000, 'browser restored the mid-hero position');
    assert.equal(restored.state.restoredScroll, true);
    assert.equal(restored.ready.frameHealth.skipped, 'restored-or-active-scroll');
    assert.equal(restored.ready.remounted, false);
    return { before, after: restored.scrollY };
  } finally {
    await run.context.close();
  }
});

for (const tier of ['balanced', 'full']) {
  await qa(`Chromium BFCache restores the same ${tier} tree and live runtime`, async () => {
    const run = await openCase({ query: `?perf=${tier}` });
    try {
      const before = await run.page.evaluate((selectedTier) => {
        const root = document.documentElement;
        const prior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        const hero = document.querySelector('[data-hero]');
        const travel = Math.max(0, (hero?.scrollHeight ?? 0) - innerHeight);
        scrollTo(0, Math.round(travel * 0.045));
        root.style.scrollBehavior = prior;
        hero.dataset.qaBfcacheTree = `same-${selectedTier}`;
        window.__ALTARIA_PERFORMANCE__.__qaBfcacheState = `same-${selectedTier}`;
        return { targetY: scrollY, token: hero.dataset.qaBfcacheTree };
      }, tier);
      await run.page.waitForTimeout(650);
      const stableY = await run.page.evaluate(() => Math.round(scrollY));
      assert.ok(stableY > 20, 'pre-navigation scroll established');

      const away = await run.page.goto(new URL(`/__phase3-away-${tier}`, BASE).href, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(away.status(), 404, 'preview provides a simple same-origin away document');
      await run.page.goBack({ waitUntil: 'commit' });
      await run.page.locator('[data-hero-tier-phase="ready"]').waitFor({ timeout: 10_000 });
      await run.page.waitForTimeout(450);

      const restored = await run.page.evaluate((selectedTier) => ({
        tier: document.documentElement.dataset.performanceTier,
        outletTier: document.querySelector('[data-hero-tier-outlet]')?.dataset.heroTier,
        heroes: document.querySelectorAll('[data-hero]').length,
        templates: document.querySelectorAll('template[data-hero-tier-template]').length,
        treeToken: document.querySelector('[data-hero]')?.dataset.qaBfcacheTree,
        stateToken: window.__ALTARIA_PERFORMANCE__.__qaBfcacheState,
        y: Math.round(scrollY),
        lifecycle: window.__phase3Lifecycle,
        navigationType: performance.getEntriesByType('navigation')[0]?.type ?? null,
        notRestoredReasons:
          performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.() ?? null,
        expectedToken: `same-${selectedTier}`,
      }), tier);
      if (!restored.lifecycle.pageshow.some((entry) => entry.persisted)) {
        return {
          skipped: true,
          reason:
            'Bundled Chromium under Playwright/CDP did not admit BFCache; ' +
            'the same result reproduces on an independent two-route HTML server.',
          navigationType: restored.navigationType,
          notRestoredReasons: restored.notRestoredReasons,
          treeTokenSurvived: restored.treeToken === restored.expectedToken,
        };
      }
      assert.equal(restored.tier, tier);
      assert.equal(restored.outletTier, tier);
      assert.equal(restored.heroes, 1);
      assert.equal(restored.templates, 0);
      assert.equal(restored.treeToken, restored.expectedToken, 'same DOM tree survived');
      assert.equal(restored.stateToken, restored.expectedToken, 'same boot/runtime state survived');
      assert.ok(Math.abs(restored.y - stableY) <= 2, 'scroll position restored exactly');
      assert.ok(restored.lifecycle.pagehide.some((entry) => entry.persisted), 'pagehide entered BFCache');
      assert.ok(restored.lifecycle.pageshow.some((entry) => entry.persisted), 'pageshow exited BFCache');

      const runtimeResponse = await run.page.evaluate(async () => {
        const stage = document.querySelector('[data-stage]');
        const beforeBeat = stage?.dataset.beat ?? null;
        const root = document.documentElement;
        const prior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        const hero = document.querySelector('[data-hero]');
        const travel = Math.max(0, (hero?.scrollHeight ?? 0) - innerHeight);
        scrollTo(0, Math.round(travel * 0.72));
        root.style.scrollBehavior = prior;
        await new Promise((resolve) => setTimeout(resolve, 850));
        return { beforeBeat, afterBeat: stage?.dataset.beat ?? null, y: Math.round(scrollY) };
      });
      assert.notEqual(runtimeResponse.afterBeat, runtimeResponse.beforeBeat, 'runtime responds after BFCache');
      assert.ok(runtimeResponse.y > restored.y, 'post-restore scroll applied');
      assert.deepEqual(run.pageErrors, []);
      return {
        initialTarget: before.targetY,
        restoredY: restored.y,
        pagehidePersisted: true,
        pageshowPersisted: true,
        runtimeResponse,
      };
    } finally {
      await run.context.close();
    }
  });
}

await qa('Full sun, birds, jet and rocket exist and their live clicks stay error-free', async () => {
  const run = await openCase({ query: '?perf=full' });
  try {
    const selectors = {
      sun: '[data-sun-hit]',
      birds: '[data-sky-event="birds-a"]',
      jet: '[data-sky-event="jet"]',
      rocket: '[data-sky-event="rocket"]',
    };
    for (const selector of Object.values(selectors)) {
      assert.equal(await run.page.locator(selector).count(), 1, `${selector} exists once`);
    }

    await run.page.locator(selectors.sun).dispatchEvent('pointerdown');
    await run.page.locator(selectors.sun).click({ force: true });
    await run.page.waitForTimeout(40);
    assert.equal(
      await run.page.locator('[data-sun-layer].is-compositor-ready').count(),
      1,
      'sun click reached its runtime'
    );

    for (const id of ['birds-a', 'jet', 'rocket']) {
      const event = run.page.locator(`[data-sky-event="${id}"]`);
      const hit = event.locator('.hit').first();
      await hit.waitFor({ state: 'attached' });
      const pointerEventsWhenLive = await event.evaluate((element) => {
        element.classList.add('is-live');
        const value = getComputedStyle(element.querySelector('.hit')).pointerEvents;
        element.classList.remove('is-live');
        return value;
      });
      assert.equal(pointerEventsWhenLive, 'auto', `${id} enables its hit target while live`);
      await event.locator('.hit').first().dispatchEvent('click', {
        bubbles: true,
        clientX: 80,
        clientY: 80,
      });
    }
    await run.page.waitForTimeout(40);
    assert.deepEqual(run.pageErrors, []);
    return { sun: true, birds: true, jet: true, rocket: true };
  } finally {
    await run.context.close();
  }
});

await qa('Full compact boundary remains 1019/1020 without changing tier', async () => {
  const compact = await openCase({ query: '?perf=full', viewport: { width: 1019, height: 640 } });
  const desktop = await openCase({ query: '?perf=full', viewport: { width: 1020, height: 640 } });
  try {
    assertTierSnapshot(compact.value, 'full');
    assertTierSnapshot(desktop.value, 'full');
    assert.equal(compact.value.heroScroll, '1120vh');
    assert.equal(desktop.value.heroScroll, '1660vh');
    return { at1019: compact.value.heroScroll, at1020: desktop.value.heroScroll };
  } finally {
    await compact.context.close();
    await desktop.context.close();
  }
});

await qa('automatic compact viewport preserves approved Full-compact and skips calibration', async () => {
  const compact = await openCase({
    viewport: { width: 1019, height: 640 },
    capabilities: { memory: 4, cores: 4 },
    sessionTier: 'lite',
    slowRafMs: 120,
  });
  const desktop = await openCase({
    viewport: { width: 1020, height: 640 },
    capabilities: { memory: 4, cores: 4 },
  });
  try {
    assertTierSnapshot(compact.value, 'full');
    assert.equal(compact.value.state.override, null);
    assert.equal(compact.value.state.preliminaryTier, 'full');
    assert.equal(compact.value.state.source, 'automatic');
    assert.equal(compact.value.state.lockReason, 'existing-compact-viewport');
    assert.equal(compact.value.ready.frameHealth.skipped, 'existing-compact-viewport');
    assert.equal(compact.value.ready.remounted, false);
    assertTierSnapshot(desktop.value, 'lite');
    return { at1019: compact.value.state.tier, at1020: desktop.value.state.tier };
  } finally {
    await compact.context.close();
    await desktop.context.close();
  }
});

await qa('Reduced Motion is independent from performance tier', async () => {
  const run = await openCase({
    capabilities: { memory: 8, cores: 8 },
    reducedMotion: 'reduce',
  });
  try {
    assertTierSnapshot(run.value, 'full');
    assert.equal(run.value.state.signals.reducedMotion, true);
    assert.equal(run.value.heroScroll, '1120vh');
    return { tier: run.value.state.tier, heroScroll: run.value.heroScroll };
  } finally {
    await run.context.close();
  }
});

await qa('debug HUD reports resolver and frame-health detail only on demand', async () => {
  const debug = await openCase({ query: '?perf=balanced&debug=1' });
  const normal = await openCase({ query: '?perf=balanced' });
  try {
    assert.equal(debug.value.debugVisible, true);
    assert.match(debug.value.debugText, /Tier: Balanced/);
    assert.match(debug.value.debugText, /deviceMemory:/);
    assert.match(debug.value.debugText, /runtime downgrade:/);
    assert.equal(normal.value.debugVisible, false);
    return debug.value.debugText.split('\n');
  } finally {
    await debug.context.close();
    await normal.context.close();
  }
});

for (const [engineName, engine] of [
  ['Firefox', firefox],
  ['WebKit', webkit],
]) {
  await qa(`${engineName} cross-engine tier mount and runtime isolation`, async () => {
    /* This managed Windows host blocks Firefox's content subprocess sandbox
       (`@SB::LA::SpawnTarget Error:0`). Chromium/WebKit are unaffected.
       Disable only Firefox's test-process sandboxes so the bundled, matching
       Playwright binary can create a tab; this is a harness setting, never an
       application/browser-detection path. */
    const launchOptions = engineName === 'Firefox'
      ? {
          headless: true,
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: '1',
            MOZ_DISABLE_RDD_SANDBOX: '1',
            MOZ_DISABLE_GPU_SANDBOX: '1',
          },
          firefoxUserPrefs: {
            'security.sandbox.content.level': 0,
            'security.sandbox.gpu.level': 0,
            'gfx.webrender.software': true,
          },
        }
      : { headless: true };
    const engineBrowser = await engine.launch(launchOptions);
    try {
      const summaries = [];
      for (const tier of ['full', 'balanced', 'lite']) {
        const run = await openCase({ activeBrowser: engineBrowser, query: `?perf=${tier}` });
        try {
          assertTierSnapshot(run.value, tier);
          assertRuntimeIsolation(run.value, run.requests, tier);
          assert.deepEqual(run.pageErrors, []);
          summaries.push({ tier, scripts: runtimeRequests(run.requests) });
        } finally {
          await run.context.close();
        }
      }
      return summaries;
    } finally {
      await engineBrowser.close();
    }
  });
}

await browser.close();

const failed = results.filter((result) => !result.ok);
const skipped = results.filter((result) => result.skipped);
const passed = results.length - failed.length - skipped.length;
console.log(
  `\nPhase 3 tier QA: ${passed}/${results.length - skipped.length} executed passed` +
    (skipped.length ? `; ${skipped.length} environment skip` : '')
);
console.log(JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;
