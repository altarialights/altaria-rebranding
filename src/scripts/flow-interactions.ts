/**
 * Flow node interactions.
 *
 * The nodes are real <a> anchors, so everything below is enhancement:
 * with JavaScript disabled they still navigate to their article via a
 * plain hash link, and the browser's own smooth scrolling plus
 * `scroll-padding-top` still clear the floating header.
 *
 * What this adds:
 *   · explanation card on hover AND on keyboard focus;
 *   · Escape closes it;
 *   · tap opens it on touch devices (first tap opens, second navigates);
 *   · the card flips side rather than leaving the viewport;
 *   · smooth scroll that respects prefers-reduced-motion;
 *   · a ~1.5 s highlight on the destination article.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const HIGHLIGHT_MS = 1500;

interface NodeRef {
  el: HTMLAnchorElement;
  tip: HTMLElement;
}

function collect(): NodeRef[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-flow-node]'))
    .map((el) => {
      const id = el.dataset.flowNode ?? '';
      const tip = document.querySelector<HTMLElement>(`[data-flow-tip="${id}"]`);
      return tip ? { el, tip } : null;
    })
    .filter(Boolean) as NodeRef[];
}

/** Keeps the card inside the viewport by flipping it to the other side. */
function place(ref: NodeRef): void {
  ref.tip.classList.remove('is-flipped');
  const r = ref.tip.getBoundingClientRect();
  if (r.left < 12) ref.tip.classList.add('is-flipped');
}

function highlight(target: HTMLElement): void {
  target.classList.add('is-targeted');
  // Move focus so keyboard and screen-reader users land on the article
  // they asked for, not at the top of the section.
  target.focus({ preventScroll: true });
  window.setTimeout(() => target.classList.remove('is-targeted'), HIGHLIGHT_MS);
}

export function initFlowInteractions(): void {
  const refs = collect();
  if (refs.length === 0) return;

  let open: NodeRef | null = null;
  const isTouch = matchMedia('(hover: none)').matches;

  const show = (ref: NodeRef): void => {
    if (open && open !== ref) hide(open);
    place(ref);
    ref.tip.classList.add('is-open');
    open = ref;
  };
  const hide = (ref: NodeRef): void => {
    ref.tip.classList.remove('is-open');
    if (open === ref) open = null;
  };

  for (const ref of refs) {
    if (!isTouch) {
      ref.el.addEventListener('mouseenter', () => show(ref));
      ref.el.addEventListener('mouseleave', (e) => {
        // Let the pointer travel from the node into the card.
        const to = e.relatedTarget as Node | null;
        if (to && ref.tip.contains(to)) return;
        hide(ref);
      });
      ref.tip.addEventListener('mouseleave', () => hide(ref));
    }

    ref.el.addEventListener('focus', () => show(ref));
    ref.el.addEventListener('blur', () => hide(ref));

    ref.el.addEventListener('click', (e) => {
      // On touch, the first tap reveals the explanation; the second
      // navigates. Nothing here depends on a cursor.
      if (isTouch && open !== ref) {
        e.preventDefault();
        show(ref);
        return;
      }

      const hash = ref.el.getAttribute('href') ?? '';
      const target = document.querySelector<HTMLElement>(hash);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({
        behavior: REDUCED.matches ? 'auto' : 'smooth',
        block: 'start',
      });
      history.pushState(null, '', hash);
      // Wait out the smooth scroll before flagging the article.
      window.setTimeout(() => highlight(target), REDUCED.matches ? 0 : 620);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      hide(open);
      open = null;
    }
  });

  // Deep links (or a reload on a hash) get the same highlight treatment.
  if (location.hash) {
    const target = document.querySelector<HTMLElement>(location.hash);
    if (target?.classList.contains('step')) {
      window.setTimeout(() => highlight(target), 400);
    }
  }
}
