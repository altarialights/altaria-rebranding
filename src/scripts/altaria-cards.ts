import { cardExamples } from '../data/card-examples';
import { initCardsWizard } from './cards-wizard';
import { field } from './cards-form-state';
export function initAltariaCards(): void {
  const form = document.querySelector<HTMLFormElement>('[data-cards-config]');
  if (!form || form.dataset.initialized) return;
  const wizard = initCardsWizard(form);
  form.dataset.initialized = 'true';
  const dialog = document.querySelector<HTMLDialogElement>('[data-cards-catalog]')!;
  const search = dialog.querySelector<HTMLInputElement>('[data-catalog-search]')!;
  const cards = [...dialog.querySelectorAll<HTMLElement>('[data-example-id]')];
  const categories = [...dialog.querySelectorAll<HTMLButtonElement>('[data-catalog-category]')];
  let category = 'all';
  let trigger: HTMLElement | null = null;
  let oldOverflow = '';
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filter = () => {
    const words = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    let count = 0;
    cards.forEach(card => {
      const shown = (category === 'all' || card.dataset.category === category) && words.every(word => normalize(card.dataset.search ?? '').includes(word));
      card.hidden = !shown; if (shown) count++;
    });
    categories.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.catalogCategory === category)));
    dialog.querySelector('[data-catalog-count]')!.textContent = `${count} ${count === 1 ? 'idea para inspirarte' : 'ideas para inspirarte'}`;
    (dialog.querySelector('[data-catalog-empty]') as HTMLElement).hidden = count !== 0;
  };
  const open = (button: HTMLElement, selected = 'all') => {
    trigger = button; category = selected; search.value = ''; filter();
    oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.showModal(); search.focus();
    dialog.querySelector('[data-catalog-scroll]')!.scrollTop = 0;
  };
  document.querySelectorAll<HTMLElement>('[data-open-catalog], [data-card-example]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); open(button, button.dataset.cardExample ?? 'all'); }));
  dialog.querySelector('[data-close-catalog]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { document.body.style.overflow = oldOverflow; trigger?.focus({preventScroll:true}); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
  search.addEventListener('input', filter);
  categories.forEach(button => button.addEventListener('click', () => { category = button.dataset.catalogCategory!; filter(); dialog.querySelector('[data-catalog-scroll]')!.scrollTop = 0; }));
  dialog.querySelector('[data-reset-catalog]')!.addEventListener('click', () => { category = 'all'; search.value = ''; filter(); search.focus(); });
  dialog.querySelectorAll<HTMLButtonElement>('[data-configure-example]').forEach(button => button.addEventListener('click', () => {
    const example = cardExamples.find(item => item.id === button.dataset.configureExample)!;
    dialog.close();
    (form.elements.namedItem('design') as RadioNodeList).value = 'custom';
    field(form, 'style').value = `Me inspira el ejemplo ${example.name}: ${example.effect}`;
    wizard.selectProduct(example.category);
    form.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#comprar')!.scrollIntoView({block:'start',behavior:'instant'});
  }));
}
