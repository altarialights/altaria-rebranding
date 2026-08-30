import type { PostHog } from 'posthog-js';
import {
  getConsentPreference,
  hasAnalyticsConsent,
  saveConsentPreference,
  type ConsentStatus,
} from './consent';

export const POSTHOG_PROJECT_TOKEN = 'phc_xcT9Qf8ZzX6LqsVDa2BQVP5pVkqxtcG5yCpnM8kTwrYz';
export const POSTHOG_API_HOST = 'https://eu.i.posthog.com';
export const POSTHOG_UI_HOST = 'https://eu.posthog.com';

type AnalyticsProperties = Record<string, boolean | number | string | readonly string[] | null | undefined>;

let client: PostHog | null = null;
let clientLoading: Promise<PostHog | null> | null = null;
let initialPageviewCaptured = false;

const waitForDocumentComplete = (): Promise<void> => {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
};

const captureCurrentPage = (posthog: PostHog) => {
  if (initialPageviewCaptured || !hasAnalyticsConsent()) return;
  initialPageviewCaptured = true;
  posthog.capture('$pageview');
};

const hasStoredPostHogState = (): boolean => {
  try {
    return (
      window.localStorage.getItem(`ph_${POSTHOG_PROJECT_TOKEN}_posthog`) !== null ||
      window.localStorage.getItem(`__ph_opt_in_out_${POSTHOG_PROJECT_TOKEN}`) === '1'
    );
  } catch {
    return false;
  }
};

const loadPostHogClient = (): Promise<PostHog | null> => {
  if (client) return Promise.resolve(client);
  if (clientLoading) return clientLoading;

  clientLoading = waitForDocumentComplete()
    .then(() => import('posthog-js'))
    .then(({ default: posthog }) => {
      if (client) return client;

      const initialized = posthog.init(POSTHOG_PROJECT_TOKEN, {
        api_host: POSTHOG_API_HOST,
        ui_host: POSTHOG_UI_HOST,
        defaults: '2026-05-30',
        persistence: 'localStorage',
        cookie_expiration: 365,
        request_batching: false,
        autocapture: {
          dom_event_allowlist: ['click', 'change', 'submit'],
          capture_copied_text: false,
        },
        rageclick: true,
        capture_dead_clicks: true,
        capture_pageview: false,
        capture_pageleave: true,
        capture_performance: {
          web_vitals: true,
          web_vitals_attribution: false,
          network_timing: false,
        },
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
          capture_console_errors: false,
        },
        disable_session_recording: false,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: 'form, [data-ph-sensitive]',
          blockClass: 'ph-no-capture',
          blockSelector: '[data-ph-no-replay]',
          recordHeaders: false,
          recordBody: false,
          collectFonts: false,
          captureJsonLd: false,
        },
        enable_recording_console_log: false,
        enable_heatmaps: true,
        disable_surveys: true,
        disable_web_experiments: true,
        disable_conversations: true,
        disable_product_tours: true,
        disableDeviceModel: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        mask_personal_data_properties: true,
        custom_personal_data_properties: [
          'email',
          'name',
          'phone',
          'telephone',
          'message',
          'password',
          'token',
          'access_token',
          'authorization',
        ],
        property_denylist: [
          'email',
          'name',
          'phone',
          'telephone',
          'message',
          'password',
          'access_token',
          'authorization',
        ],
        advanced_disable_flags: false,
        person_profiles: 'never',
        respect_dnt: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        opt_out_capturing_persistence_type: 'localStorage',
      });

      client = initialized ?? null;
      return client;
    })
    .catch((error: unknown) => {
      clientLoading = null;
      console.error('[Altaria] No se pudo iniciar la analítica consentida.', error);
      return null;
    });

  return clientLoading;
};

export const initializeAnalytics = async (): Promise<PostHog | null> => {
  if (!hasAnalyticsConsent()) return null;
  const posthog = await loadPostHogClient();
  if (!posthog || !hasAnalyticsConsent()) {
    posthog?.opt_out_capturing();
    return null;
  }

  if (posthog.has_opted_out_capturing()) {
    posthog.opt_in_capturing({ captureEventName: false });
  }
  posthog.startSessionRecording();
  captureCurrentPage(posthog);
  return posthog;
};

export const grantAnalyticsConsent = async (
  status: ConsentStatus = 'accepted',
): Promise<PostHog | null> => {
  saveConsentPreference(true, status);
  return initializeAnalytics();
};

export const denyAnalyticsConsent = (status: ConsentStatus = 'rejected'): void => {
  saveConsentPreference(false, status);
  void withdrawAnalyticsConsent();
};

export const withdrawAnalyticsConsent = async (): Promise<void> => {
  initialPageviewCaptured = false;
  const posthog = client ?? (hasStoredPostHogState() ? await loadPostHogClient() : null);
  if (!posthog) return;

  posthog.stopSessionRecording();
  posthog.opt_out_capturing();
};

export const clearStaleAnalyticsPersistence = async (): Promise<void> => {
  if (hasAnalyticsConsent() || !hasStoredPostHogState()) return;
  await withdrawAnalyticsConsent();
};

export { getConsentPreference, hasAnalyticsConsent };

export const captureEvent = async (
  eventName: string,
  properties: AnalyticsProperties = {},
): Promise<void> => {
  if (!hasAnalyticsConsent()) return;
  const posthog = await initializeAnalytics();
  if (!posthog || !hasAnalyticsConsent()) return;
  posthog.capture(eventName, properties);
};
