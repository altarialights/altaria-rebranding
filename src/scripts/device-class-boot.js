/*
 * Early device-class boot.
 *
 * This is intentionally independent from the performance tier. It only
 * chooses the existing mobile/tablet/desktop responsive composition and is
 * injected synchronously in <head> so a wide tablet never paints desktop
 * before the correct hero is mounted.
 */
(function deviceClassBoot(window, document, navigator) {
  'use strict';

  var GLOBAL_KEY = '__ALTARIA_DEVICE__';
  var root = document.documentElement;

  function mediaMatches(query) {
    try {
      return !!window.matchMedia && window.matchMedia(query).matches;
    } catch (_error) {
      return false;
    }
  }

  function finiteDimension(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
  }

  function readSignals() {
    var width = finiteDimension(window.innerWidth || root.clientWidth);
    var height = finiteDimension(window.innerHeight || root.clientHeight);
    var touchPoints = Math.max(0, Number(navigator.maxTouchPoints) || 0);
    var platform = String(navigator.platform || '');
    var userAgent = String(navigator.userAgent || '');
    var userAgentPlatform = navigator.userAgentData && navigator.userAgentData.platform
      ? String(navigator.userAgentData.platform)
      : '';

    return {
      width: width,
      height: height,
      shortestSide: width && height ? Math.min(width, height) : 0,
      longestSide: Math.max(width, height),
      touchPoints: touchPoints,
      primaryCoarse: mediaMatches('(pointer: coarse)'),
      primaryFine: mediaMatches('(pointer: fine)'),
      hover: mediaMatches('(hover: hover)'),
      anyCoarse: mediaMatches('(any-pointer: coarse)'),
      anyFine: mediaMatches('(any-pointer: fine)'),
      ipadLike:
        /iPad/i.test(userAgent) ||
        (/MacIntel|Macintosh/i.test(platform) && touchPoints > 1),
      androidLike: /Android/i.test(userAgent) || /Android/i.test(userAgentPlatform)
    };
  }

  function classify(signals) {
    var hasTouch = signals.touchPoints > 0;
    var phoneShape = hasTouch && signals.shortestSide > 0 && signals.shortestSide < 600;

    /* Preserve the existing compact/mobile boundary, including landscape
       phones whose long side can exceed 767 CSS pixels. */
    if (signals.width < 768 || phoneShape) return 'mobile';

    /* Below the existing desktop breakpoint the approved responsive tree is
       still the correct fallback, including narrow non-touch windows. */
    if (signals.width < 1020) return 'tablet';

    var tabletSized =
      signals.shortestSide >= 600 &&
      signals.longestSide <= 1366;
    var touchFirst =
      hasTouch &&
      (signals.primaryCoarse || (signals.anyCoarse && !signals.anyFine));
    var platformTablet =
      hasTouch &&
      tabletSized &&
      (signals.ipadLike || signals.androidLike);

    /* iPadOS/Android are secondary corroboration for mixed-input cases such
       as a tablet with trackpad. A Windows touch laptop with fine pointer and
       hover remains desktop because touch alone is deliberately insufficient. */
    if (tabletSized && (touchFirst || platformTablet)) return 'tablet';
    return 'desktop';
  }

  if (window[GLOBAL_KEY]) {
    root.setAttribute('data-device-class', window[GLOBAL_KEY].deviceClass);
    return;
  }

  var signals = readSignals();
  var deviceClass = classify(signals);
  var frame = 0;

  function refresh(reason) {
    frame = 0;
    var nextSignals = readSignals();
    var nextClass = classify(nextSignals);
    signals = nextSignals;
    state.signals = signals;
    if (nextClass === deviceClass) return;

    var previous = deviceClass;
    deviceClass = nextClass;
    state.deviceClass = deviceClass;
    root.setAttribute('data-device-class', deviceClass);
    try {
      document.dispatchEvent(new CustomEvent('altaria:device-class-change', {
        detail: { from: previous, to: deviceClass, reason: reason || 'viewport-change' }
      }));
    } catch (_error) {
      /* The attribute is the contract; the event is only a runtime aid. */
    }
  }

  function scheduleRefresh() {
    if (frame) return;
    frame = window.requestAnimationFrame
      ? window.requestAnimationFrame(function onFrame() { refresh('viewport-change'); })
      : window.setTimeout(function onTimer() { refresh('viewport-change'); }, 0);
  }

  var state = {
    version: 1,
    deviceClass: deviceClass,
    signals: signals,
    refresh: refresh
  };

  root.setAttribute('data-device-class', deviceClass);
  window[GLOBAL_KEY] = state;
  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
})(window, document, navigator);
