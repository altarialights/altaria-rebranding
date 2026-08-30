/*
 * Altaria Lights performance boot.
 *
 * This file is deliberately plain, self-executing JavaScript: Base.astro
 * injects its contents verbatim in the <head>.  Do not turn it into an ES
 * module.  The early execution is what prevents a Full-first flash and lets
 * CSS see data-performance-tier before the hero is parsed.
 */
(function performanceTierBoot(window, document, navigator) {
  'use strict';

  var GLOBAL_KEY = '__ALTARIA_PERFORMANCE__';
  var TIERS = ['full', 'balanced', 'lite'];
  var root = document.documentElement;

  if (window[GLOBAL_KEY]) {
    root.setAttribute('data-performance-tier', window[GLOBAL_KEY].tier);
    return;
  }

  function isTier(value) {
    return TIERS.indexOf(value) !== -1;
  }

  function tierRank(tier) {
    return TIERS.indexOf(tier);
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : null;
  }

  function safeParameters() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (_error) {
      return { get: function get() { return null; } };
    }
  }

  function navigationType() {
    try {
      var entries = window.performance && window.performance.getEntriesByType
        ? window.performance.getEntriesByType('navigation')
        : [];
      if (entries && entries[0] && typeof entries[0].type === 'string') {
        return entries[0].type;
      }
      if (window.performance && window.performance.navigation) {
        if (window.performance.navigation.type === 2) return 'back_forward';
        if (window.performance.navigation.type === 1) return 'reload';
      }
    } catch (_error) {
      /* Optional diagnostic only. */
    }
    return 'navigate';
  }

  function readSignals() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var reducedMotion = false;
    try {
      reducedMotion = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_error) {
      /* The preference is diagnostic only; it never chooses the tier. */
    }

    return {
      viewportWidth: finiteNumber(window.innerWidth || root.clientWidth),
      deviceMemory: finiteNumber(navigator.deviceMemory),
      cores: finiteNumber(navigator.hardwareConcurrency),
      saveData: !!(connection && connection.saveData === true),
      effectiveType: connection && typeof connection.effectiveType === 'string'
        ? connection.effectiveType.toLowerCase()
        : null,
      reducedMotion: reducedMotion,
      visibility: document.visibilityState || 'visible',
      navigationType: navigationType()
    };
  }

  /*
   * Deliberately conservative capability resolver:
   * - Full requires two independent strong signals.
   * - Lite requires a clearly limited combination, not a single 4 GB hint.
   * - Unknown and borderline hardware lands in Balanced.
   * Reduced motion remains an accessibility branch inside the chosen tier.
   */
  function resolveAutomaticTier(signals) {
    /* Phase 3 deliberately targets the desktop hero. Below the existing
       1020 px choreography breakpoint we preserve the approved compact
       implementation until a dedicated mobile tier project exists. Manual
       ?perf= overrides still win for QA. */
    if (signals.viewportWidth !== null && signals.viewportWidth < 1020) {
      return { tier: 'full', reason: 'existing-compact-viewport' };
    }

    var memory = signals.deviceMemory;
    var cores = signals.cores;
    var slowConnection = signals.effectiveType === 'slow-2g' || signals.effectiveType === '2g';
    var weakMemory = memory !== null && memory <= 4;
    var veryWeakMemory = memory !== null && memory <= 2;
    var weakCores = cores !== null && cores <= 4;
    var veryWeakCores = cores !== null && cores <= 2;

    if (
      (weakMemory && weakCores) ||
      (veryWeakMemory && (signals.saveData || slowConnection)) ||
      (veryWeakCores && (signals.saveData || slowConnection))
    ) {
      return {
        tier: 'lite',
        reason: slowConnection
          ? 'limited-capability-and-network'
          : signals.saveData && (veryWeakMemory || veryWeakCores)
            ? 'limited-capability-and-data-saver'
            : 'memory-and-cpu-limited'
      };
    }

    if (
      memory !== null && memory >= 8 &&
      cores !== null && cores >= 8 &&
      !signals.saveData &&
      !slowConnection
    ) {
      return { tier: 'full', reason: 'memory-and-cpu-strong' };
    }

    if (signals.saveData) return { tier: 'balanced', reason: 'data-saver' };
    if (slowConnection) return { tier: 'balanced', reason: 'slow-network' };
    if (memory === null && cores === null) return { tier: 'balanced', reason: 'capabilities-unknown' };
    return { tier: 'balanced', reason: 'capabilities-borderline' };
  }

  function percentile(sorted, ratio) {
    if (!sorted.length) return null;
    var index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
    return sorted[index];
  }

  function median(sorted) {
    if (!sorted.length) return null;
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  var parameters = safeParameters();
  var overrideValue = (parameters.get('perf') || '').toLowerCase();
  var override = isTier(overrideValue) ? overrideValue : null;
  var debug = parameters.get('debug') === '1';
  var signals = readSignals();
  var automatic = resolveAutomaticTier(signals);
  var preliminaryTier = override || automatic.tier;
  var selectedTier = preliminaryTier;
  var source = override ? 'manual-override' : 'automatic';
  var reasons = [override ? 'query-perf-' + override : automatic.reason];

  var compactViewport = !override && signals.viewportWidth !== null && signals.viewportWidth < 1020;
  var locked = !!override || compactViewport;
  var lockReason = override
    ? 'manual-override'
    : compactViewport
      ? 'existing-compact-viewport'
      : null;
  var restoredScroll =
    signals.navigationType === 'back_forward' ||
    window.scrollX > 0 ||
    window.scrollY > 0 ||
    (!!window.location.hash && window.location.hash !== '#top');
  var scrollObserved = restoredScroll;
  var runtimeDowngrade = {
    occurred: false,
    from: null,
    to: null,
    reason: null
  };
  var frameReport = null;
  var listeners = [];

  root.setAttribute('data-performance-tier', selectedTier);

  var monitorStartedAt = window.performance && window.performance.now
    ? window.performance.now()
    : Date.now();
  var monitor = {
    running: false,
    rafId: 0,
    /* Count head boot -> first connected paint as the first real interval.
       Bootstrap waits for two connected rAF callbacks; seeding here means
       those callbacks yield two samples even when the client bundle is so
       fast that no earlier frame occurred. */
    lastFrameAt: monitorStartedAt,
    startedAt: monitorStartedAt,
    samples: []
  };

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push(function remove() { target.removeEventListener(type, listener, options); });
  }

  function clearListeners() {
    while (listeners.length) listeners.pop()();
  }

  function markRestoredScroll(reason) {
    if (locked) return;
    restoredScroll = true;
    scrollObserved = true;
    if (reason && reasons.indexOf(reason) === -1) reasons.push(reason);
  }

  function onScroll() {
    if (window.scrollX > 0 || window.scrollY > 0) markRestoredScroll('scroll-before-tier-lock');
  }

  function onPageShow(event) {
    if (event && event.persisted) markRestoredScroll('bfcache-restore');
  }

  function onVisibilityChange() {
    signals.visibility = document.visibilityState || signals.visibility;
    /* Do not count a hidden-tab gap as a slow rendered frame. */
    monitor.lastFrameAt = null;
  }

  function sampleFrame(now) {
    if (!monitor.running) return;
    if (document.visibilityState !== 'hidden') {
      if (monitor.lastFrameAt !== null) {
        var delta = now - monitor.lastFrameAt;
        if (delta > 0 && delta < 2000) {
          monitor.samples.push(delta);
          /* Bound retained data; this monitor must stay negligible. */
          if (monitor.samples.length > 48) monitor.samples.shift();
        }
      }
      monitor.lastFrameAt = now;
    } else {
      monitor.lastFrameAt = null;
    }
    monitor.rafId = window.requestAnimationFrame(sampleFrame);
  }

  function stopMonitor() {
    if (!monitor.running) return;
    monitor.running = false;
    if (monitor.rafId) window.cancelAnimationFrame(monitor.rafId);
    monitor.rafId = 0;
    clearListeners();
  }

  function downgrade(target, reason) {
    if (locked || override || !isTier(target)) return false;
    if (tierRank(target) <= tierRank(selectedTier)) return false;

    var previous = selectedTier;
    selectedTier = target;
    source = 'runtime-downgrade';
    runtimeDowngrade = {
      occurred: true,
      from: previous,
      to: target,
      reason: reason || 'early-frame-health'
    };
    reasons.push(runtimeDowngrade.reason);
    root.setAttribute('data-performance-tier', selectedTier);

    try {
      document.dispatchEvent(new CustomEvent('altaria:performance-tier-change', {
        detail: { from: previous, to: target, reason: runtimeDowngrade.reason }
      }));
    } catch (_error) {
      /* CustomEvent is diagnostic, never a boot dependency. */
    }
    return true;
  }

  function lock(reason) {
    if (locked) return;
    stopMonitor();
    locked = true;
    lockReason = reason || 'before-runtime-import';
    root.setAttribute('data-performance-tier', selectedTier);
  }

  function finaliseFrameHealth(options) {
    options = options || {};
    if (options.restoredScroll) markRestoredScroll('restored-scroll-position');
    stopMonitor();

    var sorted = monitor.samples.slice().sort(function sort(a, b) { return a - b; });
    var duration = (window.performance && window.performance.now ? window.performance.now() : Date.now()) - monitor.startedAt;
    var report = {
      supported: !!window.requestAnimationFrame,
      sampleCount: sorted.length,
      durationMs: Math.max(0, duration),
      medianMs: median(sorted),
      p95Ms: percentile(sorted, 0.95),
      worstMs: sorted.length ? sorted[sorted.length - 1] : null,
      framesOver34: sorted.filter(function over34(value) { return value >= 34; }).length,
      framesOver50: sorted.filter(function over50(value) { return value >= 50; }).length,
      framesOver100: sorted.filter(function over100(value) { return value >= 100; }).length,
      skipped: null,
      downgrade: null
    };

    if (override) report.skipped = 'manual-override';
    else if (compactViewport) report.skipped = 'existing-compact-viewport';
    else if (restoredScroll || scrollObserved) report.skipped = 'restored-or-active-scroll';
    else if (signals.visibility === 'hidden') report.skipped = 'document-hidden';
    else if (!report.supported) report.skipped = 'request-animation-frame-unavailable';
    else if (report.sampleCount < 2) report.skipped = 'insufficient-connected-frames';
    /* Startup frames include parsing, font decode, cache warming and browser
       scheduling. They are useful telemetry, but not a stable device signal.
       Tier selection is intentionally deterministic for the whole visit so a
       transient long task can never swap Full -> Balanced -> Lite. */
    else report.skipped = 'diagnostic-only';

    frameReport = report;
    return report;
  }

  var state = {
    version: 1,
    tier: selectedTier,
    preliminaryTier: preliminaryTier,
    override: override,
    source: source,
    debug: debug,
    signals: signals,
    reasons: reasons,
    restoredScroll: restoredScroll,
    locked: locked,
    lockReason: lockReason,
    runtimeDowngrade: runtimeDowngrade,
    frameHealth: frameReport,
    markRestoredScroll: function mark(reason) {
      markRestoredScroll(reason);
      syncState();
    },
    downgrade: function requestDowngrade(target, reason) {
      var changed = downgrade(target, reason);
      syncState();
      return changed;
    },
    finaliseFrameHealth: function finalise(options) {
      var report = finaliseFrameHealth(options);
      syncState();
      return report;
    },
    lock: function lockTier(reason) {
      lock(reason);
      syncState();
    },
    getDebugDetail: function getDebugDetail() {
      syncState();
      return {
        tier: state.tier,
        preliminaryTier: state.preliminaryTier,
        source: state.source,
        reason: state.reasons.slice(),
        deviceMemory: signals.deviceMemory,
        viewportWidth: signals.viewportWidth,
        cores: signals.cores,
        saveData: signals.saveData,
        effectiveType: signals.effectiveType,
        reducedMotion: signals.reducedMotion,
        restoredScroll: state.restoredScroll,
        runtimeDowngrade: state.runtimeDowngrade.occurred,
        frameHealth: state.frameHealth
      };
    }
  };

  function syncState() {
    state.tier = selectedTier;
    state.source = source;
    state.restoredScroll = restoredScroll;
    state.locked = locked;
    state.lockReason = lockReason;
    state.runtimeDowngrade = runtimeDowngrade;
    state.frameHealth = frameReport;
  }

  window[GLOBAL_KEY] = state;

  if (!locked && !restoredScroll && window.requestAnimationFrame) {
    monitor.running = true;
    addListener(window, 'scroll', onScroll, { passive: true });
    addListener(window, 'pageshow', onPageShow, false);
    addListener(document, 'visibilitychange', onVisibilityChange, false);
    monitor.rafId = window.requestAnimationFrame(sampleFrame);
  }
})(window, document, navigator);
