function setHeaderRegionInert(element: HTMLElement, value: boolean): void {
  element.inert = value;
  if (value) element.setAttribute('inert', '');
  else element.removeAttribute('inert');
}

function initialiseDesktopServices(): void {
  document.querySelectorAll<HTMLElement>('[data-header-services-root]').forEach((root) => {
    if (root.dataset.initialised === 'true') return;
    root.dataset.initialised = 'true';

    const button = root.querySelector<HTMLButtonElement>('[data-header-services-button]');
    const panel = root.querySelector<HTMLElement>('[data-header-services-panel]');
    const desktop = window.matchMedia('(min-width: 1020px)');
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    let open = false;
    let closeTimer = 0;

    const setServices = (nextOpen: boolean, restoreFocus = false): void => {
      if (!button || !panel || open === nextOpen) return;
      window.clearTimeout(closeTimer);
      open = nextOpen;
      root.classList.toggle('is-services-open', open);
      button.setAttribute('aria-expanded', String(open));
      panel.setAttribute('aria-hidden', String(!open));
      setHeaderRegionInert(panel, !open);
      if (!open && restoreFocus) button.focus({ preventScroll: true });
    };

    const scheduleClose = (): void => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => setServices(false), 150);
    };

    button?.addEventListener('click', (event) => {
      if (desktop.matches && canHover.matches && event.detail > 0) {
        setServices(true);
        return;
      }
      setServices(!open);
    });
    root.addEventListener('pointerenter', () => {
      if (desktop.matches && canHover.matches) setServices(true);
    });
    root.addEventListener('pointerleave', () => {
      if (desktop.matches && canHover.matches) scheduleClose();
    });
    root.addEventListener('focusin', () => setServices(true));
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget as Node | null)) scheduleClose();
    });
    document.addEventListener('pointerdown', (event) => {
      if (open && !root.contains(event.target as Node)) setServices(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) setServices(false, true);
    });
    desktop.addEventListener('change', () => setServices(false));
  });
}

function initialiseResponsiveMenu(): void {
  document.querySelectorAll<HTMLElement>('[data-header-menu-root]').forEach((root) => {
    if (root.dataset.initialised === 'true') return;
    root.dataset.initialised = 'true';

    const capsule = root.closest<HTMLElement>('[data-header-capsule]');
    const header = root.closest<HTMLElement>('[data-header]');
    const button = root.querySelector<HTMLButtonElement>('[data-header-menu-button]');
    const panel = root.querySelector<HTMLElement>('[data-header-menu-panel]');
    const backgroundRegions = Array.from(document.querySelectorAll<HTMLElement>('main, footer'));
    const responsive = window.matchMedia('(max-width: 1019px)');
    let open = false;
    let closeTimer = 0;

    const setMenu = (nextOpen: boolean, restoreFocus = false): void => {
      if (!capsule || !button || !panel || open === nextOpen) return;
      window.clearTimeout(closeTimer);
      open = nextOpen;
      setHeaderRegionInert(panel, !open);
      backgroundRegions.forEach((region) => setHeaderRegionInert(region, open));
      document.documentElement.classList.toggle('has-header-menu-open', open);
      header?.classList.toggle('is-menu-open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');

      if (open) {
        panel.hidden = false;
        void panel.offsetHeight;
        capsule.classList.add('is-menu-open');
        return;
      }

      capsule.classList.remove('is-menu-open');
      if (restoreFocus) button.focus({ preventScroll: true });
      closeTimer = window.setTimeout(() => {
        if (!open) panel.hidden = true;
      }, 380);
    };

    button?.addEventListener('click', () => setMenu(!open, open));
    panel?.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) setMenu(false, true);
    });
    document.addEventListener('pointerdown', (event) => {
      if (!open || capsule?.contains(event.target as Node)) return;
      setMenu(false);
    });
    responsive.addEventListener('change', () => setMenu(false));
  });
}

export function initFloatingHeader(): void {
  initialiseDesktopServices();
  initialiseResponsiveMenu();
}
