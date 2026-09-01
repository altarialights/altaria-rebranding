export const CONSENT_VERSION = '2';
export const CONSENT_STORAGE_KEY = 'altaria_cookie_consent';
export const CONSENT_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export type ConsentStatus = 'accepted' | 'rejected' | 'custom';

export interface ConsentPreference {
  status: ConsentStatus;
  analytics: boolean;
  timestamp: string;
  version: typeof CONSENT_VERSION;
}

const isValidPreference = (value: unknown): value is ConsentPreference => {
  if (!value || typeof value !== 'object') return false;

  const preference = value as Partial<ConsentPreference>;
  const timestamp = typeof preference.timestamp === 'string' ? Date.parse(preference.timestamp) : NaN;
  const age = Date.now() - timestamp;

  return (
    preference.version === CONSENT_VERSION &&
    typeof preference.analytics === 'boolean' &&
    ['accepted', 'rejected', 'custom'].includes(preference.status ?? '') &&
    Number.isFinite(timestamp) &&
    age >= -5 * 60 * 1000 &&
    age <= CONSENT_DURATION_MS
  );
};

export const getConsentPreference = (): ConsentPreference | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (isValidPreference(parsed)) return parsed;

    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  return null;
};

export const saveConsentPreference = (
  analytics: boolean,
  status: ConsentStatus = analytics ? 'accepted' : 'rejected',
): ConsentPreference => {
  const preference: ConsentPreference = {
    status,
    analytics,
    timestamp: new Date().toISOString(),
    version: CONSENT_VERSION,
  };

  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The decision still applies to this page even if the browser refuses storage.
  }

  window.dispatchEvent(new CustomEvent('altaria:consent-changed', { detail: preference }));
  return preference;
};

export const hasAnalyticsConsent = (): boolean => getConsentPreference()?.analytics === true;
