/**
 * Pointer affordance for the Full tablet palette.
 *
 * This used to live in a hoisted `<script>` inside DeviceTablet. That made
 * it run as soon as Astro evaluated the page, even when the Full tree was
 * only an inert performance-tier candidate. Keeping it in the Full runtime
 * preserves the approved interaction while inactive tiers pay no observer or
 * listener cost.
 */
export function initFullTabletSwatches(): () => void {
  const tablet = document.querySelector<HTMLElement>('[data-obj="tablet"]');
  if (!tablet) return () => undefined;

  const brandSwatches = Array.from(
    tablet.querySelectorAll<HTMLElement>('[data-brand-swatch]')
  );

  const clearBrandSwatchHover = (): void => {
    for (const swatch of brandSwatches) swatch.classList.remove('is-hovered');
    document.documentElement.classList.remove('is-brand-swatch-hovered');
  };

  const onPointerMove = (event: PointerEvent): void => {
    let isOverSwatch = false;

    for (const swatch of brandSwatches) {
      const isVisible = Number(getComputedStyle(swatch).opacity) > 0.5;
      if (!isVisible) {
        swatch.classList.remove('is-hovered');
        continue;
      }

      const rect = swatch.getBoundingClientRect();
      const isInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      swatch.classList.toggle('is-hovered', isInside);
      isOverSwatch ||= isInside;
    }

    document.documentElement.classList.toggle('is-brand-swatch-hovered', isOverSwatch);
  };

  const onPointerOut = (event: PointerEvent): void => {
    if (!event.relatedTarget) clearBrandSwatchHover();
  };

  let listening = false;
  const syncListeners = (): void => {
    const next = tablet.hasAttribute('data-brand-interactive') && !document.hidden;
    if (next === listening) return;
    listening = next;

    if (listening) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('blur', clearBrandSwatchHover);
      window.addEventListener('pointerout', onPointerOut);
      return;
    }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('blur', clearBrandSwatchHover);
    window.removeEventListener('pointerout', onPointerOut);
    clearBrandSwatchHover();
  };

  const observer = new MutationObserver(syncListeners);
  observer.observe(tablet, {
    attributes: true,
    attributeFilter: ['data-brand-interactive'],
  });
  document.addEventListener('visibilitychange', syncListeners);
  syncListeners();

  const dispose = (): void => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', syncListeners);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('blur', clearBrandSwatchHover);
    window.removeEventListener('pointerout', onPointerOut);
    clearBrandSwatchHover();
  };

  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) dispose();
  };

  window.addEventListener('pagehide', onPageHide);
  return dispose;
}
