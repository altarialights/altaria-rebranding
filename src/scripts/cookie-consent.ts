import {
  captureEvent,
  clearStaleAnalyticsPersistence,
  denyAnalyticsConsent,
  getConsentPreference,
  grantAnalyticsConsent,
  initializeAnalytics,
} from '../lib/analytics/posthog';

type ConsentRoot = HTMLElement & { dataset: { initialized?: string } };

const deviceCategory = () => {
  if (window.matchMedia('(max-width: 699px)').matches) return 'mobile';
  if (window.matchMedia('(max-width: 1019px)').matches) return 'tablet';
  return 'desktop';
};

const trackImportantInteractions = () => {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[data-cookie-consent]')) return;

    const common = { device_category: deviceCategory() };
    const service = target.closest<HTMLElement>('[data-service-id]');
    if (service?.dataset.serviceId) {
      void captureEvent('service_card_clicked', {
        ...common,
        location: 'hero',
        service: service.dataset.serviceId,
      });
      return;
    }

    const link = target.closest<HTMLElement>('a, button');
    if (!link) return;

    if (link.matches('.case__cta')) {
      void captureEvent('case_study_clicked', { ...common, location: 'case_study' });
    } else if (link.matches('.mirador__cta')) {
      void captureEvent('final_cta_clicked', { ...common, location: 'mirador' });
    } else if (link.matches('.how__cta')) {
      void captureEvent('process_cta_clicked', { ...common, location: 'how_it_works' });
    } else if (
      link.matches(
        '.hdr__cta, .rh-header__cta, .rh-menu__cta, .site-footer__cta, [data-cloud-cta]',
      )
    ) {
      const location = link.matches('.site-footer__cta')
        ? 'footer'
        : link.matches('.hdr__cta, .rh-header__cta, .rh-menu__cta')
          ? 'header'
          : 'hero';
      void captureEvent('cta_contact_clicked', { ...common, location });
    }
  });
};

export const initCookieConsent = () => {
  const root = document.querySelector<ConsentRoot>('[data-cookie-consent]');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';

  const banner = root.querySelector<HTMLElement>('[data-cookie-banner]');
  const preferences = root.querySelector<HTMLElement>('[data-cookie-preferences]');
  const panel = root.querySelector<HTMLElement>('[data-cookie-preferences-panel]');
  const analyticsToggle = root.querySelector<HTMLInputElement>('[data-cookie-analytics]');
  const status = root.querySelector<HTMLElement>('[data-cookie-status]');
  const actionButtons = [...root.querySelectorAll<HTMLButtonElement>('.cookie-button')];
  let opener: HTMLElement | null = null;

  if (!banner || !preferences || !panel || !analyticsToggle) return;

  const setBusy = (busy: boolean) => actionButtons.forEach((button) => (button.disabled = busy));

  const announce = (message: string) => {
    if (status) status.textContent = message;
  };

  const hideBanner = () => {
    banner.hidden = true;
  };

  const closePreferences = () => {
    preferences.hidden = true;
    document.documentElement.removeAttribute('data-privacy-panel-open');
    opener?.focus();
    opener = null;
  };

  const showBanner = () => {
    banner.hidden = false;
  };

  const openPreferences = (trigger?: HTMLElement | null) => {
    opener = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    analyticsToggle.checked = getConsentPreference()?.analytics ?? false;
    preferences.hidden = false;
    document.documentElement.dataset.privacyPanelOpen = 'true';
    requestAnimationFrame(() => analyticsToggle.focus());
  };

  const finish = (message: string) => {
    hideBanner();
    closePreferences();
    setBusy(false);
    announce(message);
  };

  const accept = async () => {
    setBusy(true);
    await grantAnalyticsConsent('accepted');
    finish('Has aceptado las cookies analíticas.');
  };

  const reject = () => {
    setBusy(true);
    denyAnalyticsConsent('rejected');
    finish('Solo permanecen activas las tecnologías necesarias.');
  };

  root.querySelector('[data-cookie-accept]')?.addEventListener('click', () => void accept());
  root.querySelector('[data-cookie-reject]')?.addEventListener('click', reject);
  root.querySelector('[data-cookie-panel-accept]')?.addEventListener('click', () => void accept());
  root.querySelector('[data-cookie-panel-reject]')?.addEventListener('click', reject);

  root.querySelectorAll<HTMLElement>('[data-cookie-configure]').forEach((button) => {
    button.addEventListener('click', () => openPreferences(button));
  });

  root.querySelector('[data-cookie-save]')?.addEventListener('click', async () => {
    setBusy(true);
    if (analyticsToggle.checked) {
      await grantAnalyticsConsent('custom');
      finish('Preferencias guardadas: analítica activada.');
    } else {
      denyAnalyticsConsent('custom');
      finish('Preferencias guardadas: analítica desactivada.');
    }
  });

  root.querySelector('[data-cookie-close]')?.addEventListener('click', () => {
    closePreferences();
    if (!getConsentPreference()) showBanner();
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-cookie-preferences-trigger]')
      : null;
    if (!trigger) return;
    event.preventDefault();
    openPreferences(trigger);
  });

  document.addEventListener('keydown', (event) => {
    if (preferences.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closePreferences();
      if (!getConsentPreference()) showBanner();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const preference = getConsentPreference();
  if (!preference) {
    showBanner();
    void clearStaleAnalyticsPersistence();
  } else if (preference.analytics) {
    void initializeAnalytics();
  }

  trackImportantInteractions();
};
