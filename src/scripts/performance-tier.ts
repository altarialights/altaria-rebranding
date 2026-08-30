/**
 * Typed access to the synchronous performance decision made in
 * performance-tier-boot.js.  The boot file is the only place that contains
 * automatic hardware heuristics; this module keeps the rest of the app from
 * reimplementing or second-guessing them.
 */

export const PERFORMANCE_TIERS = ['full', 'balanced', 'lite'] as const;

export type PerformanceTier = (typeof PERFORMANCE_TIERS)[number];
export type PerformanceTierSource =
  | 'manual-override'
  | 'automatic'
  | 'session-downgrade'
  | 'runtime-downgrade'
  | 'boot-fallback';

export interface PerformanceSignals {
  viewportWidth: number | null;
  deviceMemory: number | null;
  cores: number | null;
  saveData: boolean;
  effectiveType: string | null;
  /** Accessibility preference only. It never selects a performance tier. */
  reducedMotion: boolean;
  visibility: string;
  navigationType: string;
}

export interface RuntimeDowngradeDetail {
  occurred: boolean;
  from: PerformanceTier | null;
  to: PerformanceTier | null;
  reason: string | null;
}

export interface FrameHealthReport {
  supported: boolean;
  sampleCount: number;
  durationMs: number;
  medianMs: number | null;
  p95Ms: number | null;
  worstMs: number | null;
  framesOver34: number;
  framesOver50: number;
  framesOver100: number;
  skipped: string | null;
  downgrade: {
    from: PerformanceTier | null;
    to: PerformanceTier | null;
  } | null;
}

export interface PerformanceTierDebugDetail {
  tier: PerformanceTier;
  preliminaryTier: PerformanceTier;
  source: PerformanceTierSource;
  reason: string[];
  viewportWidth: number | null;
  deviceMemory: number | null;
  cores: number | null;
  saveData: boolean;
  effectiveType: string | null;
  reducedMotion: boolean;
  restoredScroll: boolean;
  runtimeDowngrade: boolean;
  frameHealth: FrameHealthReport | null;
}

export interface PerformanceTierBootState {
  readonly version: 1;
  tier: PerformanceTier;
  readonly preliminaryTier: PerformanceTier;
  readonly override: PerformanceTier | null;
  source: PerformanceTierSource;
  readonly debug: boolean;
  readonly signals: PerformanceSignals;
  readonly reasons: string[];
  restoredScroll: boolean;
  locked: boolean;
  lockReason: string | null;
  runtimeDowngrade: RuntimeDowngradeDetail;
  frameHealth: FrameHealthReport | null;
  markRestoredScroll(reason?: string): void;
  downgrade(target: PerformanceTier, reason?: string): boolean;
  finaliseFrameHealth(options?: { restoredScroll?: boolean }): FrameHealthReport;
  lock(reason?: string): void;
  getDebugDetail(): PerformanceTierDebugDetail;
}

export interface PerformanceTierChangeDetail {
  from: PerformanceTier;
  to: PerformanceTier;
  reason: string;
}

declare global {
  interface Window {
    __ALTARIA_PERFORMANCE__?: PerformanceTierBootState;
  }
}

export function isPerformanceTier(value: unknown): value is PerformanceTier {
  return typeof value === 'string' && (PERFORMANCE_TIERS as readonly string[]).includes(value);
}

export function performanceTierRank(tier: PerformanceTier): number {
  return PERFORMANCE_TIERS.indexOf(tier);
}

/** Returns true only when `candidate` is cheaper than `current`. */
export function isPerformanceTierDowngrade(
  current: PerformanceTier,
  candidate: PerformanceTier
): boolean {
  return performanceTierRank(candidate) > performanceTierRank(current);
}

function queryOverride(): PerformanceTier | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('perf')?.toLowerCase();
  return isPerformanceTier(value) ? value : null;
}

function fallbackSignals(): PerformanceSignals {
  return {
    viewportWidth: typeof window === 'undefined' ? null : window.innerWidth,
    deviceMemory: null,
    cores: null,
    saveData: false,
    effectiveType: null,
    reducedMotion:
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    visibility: typeof document === 'undefined' ? 'visible' : document.visibilityState,
    navigationType: 'unknown',
  };
}

/**
 * A defensive fallback for an integration error or an unusually strict CSP.
 * It intentionally chooses Balanced (unless `?perf=` is valid), rather than
 * running late capability detection after expensive markup may have painted.
 */
function createFallbackState(): PerformanceTierBootState {
  const override = queryOverride();
  let tier: PerformanceTier = override ?? 'balanced';
  let locked = override !== null;
  let lockReason = override ? 'manual-override' : null;
  let runtimeDowngrade: RuntimeDowngradeDetail = {
    occurred: false,
    from: null,
    to: null,
    reason: null,
  };
  const reasons = [override ? `query-perf-${override}` : 'early-boot-missing-balanced-fallback'];
  const signals = fallbackSignals();
  let frameHealth: FrameHealthReport | null = null;

  const state: PerformanceTierBootState = {
    version: 1,
    tier,
    preliminaryTier: tier,
    override,
    source: override ? 'manual-override' : 'boot-fallback',
    debug:
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1',
    signals,
    reasons,
    restoredScroll: false,
    locked,
    lockReason,
    runtimeDowngrade,
    frameHealth,
    markRestoredScroll(reason = 'restored-scroll-position') {
      state.restoredScroll = true;
      if (!reasons.includes(reason)) reasons.push(reason);
    },
    downgrade(target, reason = 'requested-downgrade') {
      if (locked || override || !isPerformanceTierDowngrade(tier, target)) return false;
      const from = tier;
      tier = target;
      runtimeDowngrade = { occurred: true, from, to: target, reason };
      state.tier = target;
      state.source = 'runtime-downgrade';
      state.runtimeDowngrade = runtimeDowngrade;
      reasons.push(reason);
      document.documentElement.dataset.performanceTier = target;
      return true;
    },
    finaliseFrameHealth() {
      frameHealth = {
        supported: false,
        sampleCount: 0,
        durationMs: 0,
        medianMs: null,
        p95Ms: null,
        worstMs: null,
        framesOver34: 0,
        framesOver50: 0,
        framesOver100: 0,
        skipped: 'early-boot-missing',
        downgrade: null,
      };
      state.frameHealth = frameHealth;
      return frameHealth;
    },
    lock(reason = 'before-runtime-import') {
      locked = true;
      lockReason = reason;
      state.locked = true;
      state.lockReason = lockReason;
    },
    getDebugDetail() {
      return {
        tier: state.tier,
        preliminaryTier: state.preliminaryTier,
        source: state.source,
        reason: reasons.slice(),
        viewportWidth: signals.viewportWidth,
        deviceMemory: signals.deviceMemory,
        cores: signals.cores,
        saveData: signals.saveData,
        effectiveType: signals.effectiveType,
        reducedMotion: signals.reducedMotion,
        restoredScroll: state.restoredScroll,
        runtimeDowngrade: runtimeDowngrade.occurred,
        frameHealth,
      };
    },
  };

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.performanceTier = tier;
  }
  return state;
}

export function getPerformanceTierState(): PerformanceTierBootState {
  if (typeof window === 'undefined') return createFallbackState();
  if (!window.__ALTARIA_PERFORMANCE__) {
    window.__ALTARIA_PERFORMANCE__ = createFallbackState();
  }
  return window.__ALTARIA_PERFORMANCE__;
}

export function getPerformanceTier(): PerformanceTier {
  return getPerformanceTierState().tier;
}

export function hasManualPerformanceOverride(): boolean {
  return getPerformanceTierState().override !== null;
}

export function markRestoredPerformanceScroll(reason?: string): void {
  getPerformanceTierState().markRestoredScroll(reason);
}

/** Finalises and stops the head rAF. Call this before any runtime import. */
export function finaliseEarlyFrameHealth(restoredScroll = false): FrameHealthReport {
  return getPerformanceTierState().finaliseFrameHealth({ restoredScroll });
}

export function lockPerformanceTier(reason = 'before-runtime-import'): PerformanceTier {
  const state = getPerformanceTierState();
  state.lock(reason);
  return state.tier;
}

export function getPerformanceTierDebugDetail(): PerformanceTierDebugDetail {
  return getPerformanceTierState().getDebugDetail();
}

export function formatPerformanceTierDebug(detail = getPerformanceTierDebugDetail()): string {
  const frame = detail.frameHealth;
  return [
    `Tier: ${detail.tier[0].toUpperCase()}${detail.tier.slice(1)}`,
    `Reason: ${detail.reason.join(', ')}`,
    `viewportWidth: ${detail.viewportWidth ?? 'unknown'}`,
    `deviceMemory: ${detail.deviceMemory ?? 'unknown'}`,
    `cores: ${detail.cores ?? 'unknown'}`,
    `saveData: ${String(detail.saveData)}`,
    `effectiveType: ${detail.effectiveType ?? 'unknown'}`,
    `reducedMotion: ${String(detail.reducedMotion)}`,
    `restoredScroll: ${String(detail.restoredScroll)}`,
    `runtime downgrade: ${detail.runtimeDowngrade ? 'yes' : 'no'}`,
    `frame health: ${frame ? `${frame.sampleCount} frames, p95 ${frame.p95Ms?.toFixed(1) ?? 'n/a'} ms` : 'pending'}`,
  ].join('\n');
}

export function onPerformanceTierChange(
  listener: (detail: PerformanceTierChangeDetail) => void
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = (event: Event): void => {
    listener((event as CustomEvent<PerformanceTierChangeDetail>).detail);
  };
  document.addEventListener('altaria:performance-tier-change', handler);
  return () => document.removeEventListener('altaria:performance-tier-change', handler);
}
