const MOBILE_QUERY = '(max-width: 767px)';

function setInert(element: HTMLElement, value: boolean): void {
  element.inert = value;
  if (value) element.setAttribute('inert', '');
  else element.removeAttribute('inert');
}

export function initResponsiveHero(): void {
  const root = document.querySelector<HTMLElement>('[data-responsive-hero]');
  if (!root || root.dataset.initialised === 'true') return;
  root.dataset.initialised = 'true';

  const header = root.querySelector<HTMLElement>('[data-responsive-header]');
  const menuButton = root.querySelector<HTMLButtonElement>('[data-responsive-menu-button]');
  const menu = root.querySelector<HTMLElement>('[data-responsive-menu]');
  const backgroundRegions = Array.from(
    root.querySelectorAll<HTMLElement>('.rh-intro, .rh-services, .rh-principles'),
  );
  let menuOpen = false;
  let menuCloseTimer = 0;

  const setMenu = (open: boolean, restoreFocus = false): void => {
    if (!header || !menuButton || !menu || menuOpen === open) return;
    window.clearTimeout(menuCloseTimer);
    menuOpen = open;
    setInert(menu, !open);
    backgroundRegions.forEach((region) => setInert(region, open));
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    root.classList.toggle('is-menu-open', open);

    if (open) {
      menu.hidden = false;
      // Ensure the inert closed state is painted before the capsule morphs.
      void menu.offsetHeight;
      header.classList.add('is-menu-open');
      window.requestAnimationFrame(() => menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true }));
      return;
    }

    header.classList.remove('is-menu-open');
    if (restoreFocus) menuButton.focus({ preventScroll: true });
    menuCloseTimer = window.setTimeout(() => {
      if (!menuOpen) menu.hidden = true;
    }, 380);
  };

  menuButton?.addEventListener('click', () => setMenu(!menuOpen, menuOpen));
  menu?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) setMenu(false, true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuOpen || header?.contains(event.target as Node)) return;
    setMenu(false);
  });

  root.querySelector<HTMLButtonElement>('.rh-intro__cta')?.addEventListener('click', () => {
    document.querySelector('#contacto')?.scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
  });

  const carousel = root.querySelector<HTMLElement>('[data-responsive-carousel]');
  const track = carousel?.querySelector<HTMLElement>('[data-carousel-track]');
  const slides = Array.from(carousel?.querySelectorAll<HTMLElement>('[data-carousel-slide]') ?? []);
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-carousel-dot]'));
  const shortcuts = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-carousel-shortcut]'));
  const previous = carousel?.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = carousel?.querySelector<HTMLButtonElement>('[data-carousel-next]');
  const mobile = window.matchMedia(MOBILE_QUERY);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 1;
  let scrollFrame = 0;
  let dragPointer = -1;
  let dragStartX = 0;
  let dragStartScroll = 0;
  let dragStartIndex = 0;
  let dragDistance = 0;
  let dragged = false;

  const update = (index: number): void => {
    current = Math.max(0, Math.min(slides.length - 1, index));
    const isMobile = mobile.matches;

    slides.forEach((slide, slideIndex) => {
      if (isMobile) {
        slide.setAttribute('aria-hidden', String(slideIndex !== current));
        setInert(slide, slideIndex !== current);
      } else {
        slide.removeAttribute('aria-hidden');
        setInert(slide, false);
      }
    });
    dots.forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === current)));
    shortcuts.forEach((shortcut, shortcutIndex) =>
      shortcut.setAttribute('aria-current', String(shortcutIndex === current)),
    );
    if (previous) previous.disabled = current === 0;
    if (next) next.disabled = current === slides.length - 1;
  };

  const goTo = (index: number, smooth = true): void => {
    if (!track || !slides.length || !mobile.matches) return;
    const targetIndex = Math.max(0, Math.min(slides.length - 1, index));
    const target = slides[targetIndex];
    const left = target.offsetLeft - (track.clientWidth - target.clientWidth) / 2;
    track.scrollTo({
      left,
      behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto',
    });
    update(targetIndex);
  };

  const findClosest = (): number => {
    if (!track) return current;
    const centre = track.scrollLeft + track.clientWidth / 2;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, index) => {
      const slideCentre = slide.offsetLeft + slide.clientWidth / 2;
      const nextDistance = Math.abs(slideCentre - centre);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    return closest;
  };

  const finishDrag = (pointerId: number): void => {
    if (!track || dragPointer !== pointerId) return;
    const wasDragged = dragged;
    const delta = track.scrollLeft - dragStartScroll;
    const threshold = Math.min(72, track.clientWidth * 0.16);
    const target = Math.abs(delta) >= threshold ? dragStartIndex + Math.sign(delta) : findClosest();
    dragPointer = -1;
    dragged = false;
    track.classList.remove('is-dragging');
    if (track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId);
    if (wasDragged) goTo(target);
  };

  track?.addEventListener('pointerdown', (event) => {
    if (!mobile.matches || event.button !== 0 || dragPointer !== -1) return;
    dragPointer = event.pointerId;
    dragStartX = event.clientX;
    dragStartScroll = track.scrollLeft;
    dragStartIndex = current;
    dragDistance = 0;
    dragged = false;
    track.setPointerCapture(event.pointerId);
  });

  track?.addEventListener('pointermove', (event) => {
    if (!mobile.matches || dragPointer !== event.pointerId) return;
    const delta = event.clientX - dragStartX;
    dragDistance = Math.max(dragDistance, Math.abs(delta));
    if (!dragged && dragDistance < 7) return;
    dragged = true;
    track.classList.add('is-dragging');
    track.scrollLeft = dragStartScroll - delta;
    event.preventDefault();
  });

  track?.addEventListener('pointerup', (event) => finishDrag(event.pointerId));
  track?.addEventListener('pointercancel', (event) => finishDrag(event.pointerId));
  track?.addEventListener('lostpointercapture', (event) => {
    if (dragPointer === event.pointerId) finishDrag(event.pointerId);
  });
  track?.addEventListener(
    'click',
    (event) => {
      if (!dragged && dragDistance < 7) return;
      event.preventDefault();
      event.stopPropagation();
      dragDistance = 0;
    },
    true,
  );

  track?.addEventListener(
    'scroll',
    () => {
      if (!mobile.matches || scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        update(findClosest());
      });
    },
    { passive: true },
  );
  track?.addEventListener('keydown', (event) => {
    if (!mobile.matches) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(current - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(current + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(slides.length - 1);
    }
  });
  previous?.addEventListener('click', () => goTo(current - 1));
  next?.addEventListener('click', () => goTo(current + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => goTo(index)));
  shortcuts.forEach((shortcut, index) => shortcut.addEventListener('click', () => goTo(index)));

  const handleMode = (): void => {
    if (!mobile.matches) {
      setMenu(false);
      update(current);
      track?.scrollTo({ left: 0, behavior: 'auto' });
      return;
    }
    window.requestAnimationFrame(() => goTo(current, false));
  };

  mobile.addEventListener('change', () => {
    setMenu(false);
    handleMode();
  });
  update(current);
  handleMode();

  window.requestAnimationFrame(() => root.classList.add('is-ready'));
}
