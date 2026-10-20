type CatalogItem = { id: string; name: string; kind: 'product' | 'service';
  description: string; unit_price_cents: number | null; tax_bps: number };
type Template = { id: string; description: string; scope: string; schedule: string; terms: string };
type Line = { catalogItemId: string | null; kind: 'product' | 'service' | 'custom';
  name: string; description: string; quantity: string; unitPrice: string;
  discountPercent: string; taxPercent: string };
const form = document.querySelector<HTMLFormElement>('[data-proposal-editor]');
if (form) {
  const catalog = JSON.parse(form.dataset.catalog || '[]') as CatalogItem[];
  const templates = JSON.parse(form.dataset.templates || '[]') as Template[];
  const initial = JSON.parse(form.dataset.lines || '[]') as Line[];
  const list = form.querySelector<HTMLElement>('[data-line-list]')!;
  const total = form.querySelector<HTMLElement>('[data-preview-total]')!;
  const empty: Line = { catalogItemId: null, kind: 'custom', name: '', description: '',
    quantity: '1', unitPrice: '0.00', discountPercent: '0', taxPercent: '21' };
  const input = (row: HTMLElement, field: string) => row.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-line-${field}]`)!;
  const rows = () => [...list.querySelectorAll<HTMLElement>('[data-line-row]')];
  const serialize = (): Line[] => rows().map((row) => ({
    catalogItemId: input(row, 'catalog').value || null,
    kind: input(row, 'kind').value as Line['kind'], name: input(row, 'name').value,
    description: input(row, 'description').value, quantity: input(row, 'quantity').value,
    unitPrice: input(row, 'price').value, discountPercent: input(row, 'discount').value,
    taxPercent: input(row, 'tax').value,
  }));
  const recalculate = () => {
    let amount = 0;
    for (const line of serialize()) {
      const price = Number(line.unitPrice), quantity = Number(line.quantity);
      const discount = Number(line.discountPercent), tax = Number(line.taxPercent);
      if (![price, quantity, discount, tax].every(Number.isFinite)) { total.textContent = '—'; return; }
      amount += quantity * price * (1 - discount / 100) * (1 + tax / 100);
    }
    total.textContent = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount);
  };
  const add = (value: Line = empty) => {
    const row = document.createElement('div'); row.className = 'proposal-line'; row.dataset.lineRow = '';
    row.innerHTML = `<div class="proposal-line-top"><span class="proposal-line-number"></span><button type="button" class="proposal-remove" aria-label="Quitar partida">Quitar</button></div>
      <div class="crm-form-grid"><label class="crm-field wide">Producto o servicio<select data-line-catalog><option value="">Partida personalizada</option></select></label>
      <label class="crm-field">Tipo<select data-line-kind><option value="custom">Personalizada</option><option value="service">Servicio</option><option value="product">Producto</option></select></label>
      <label class="crm-field">Concepto *<input data-line-name required maxlength="160" /></label>
      <label class="crm-field wide">Detalle<textarea data-line-description maxlength="1000"></textarea></label>
      <label class="crm-field">Cantidad *<input data-line-quantity inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,3})?" required /></label>
      <label class="crm-field">Precio unitario € *<input data-line-price inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required /></label>
      <label class="crm-field">Descuento %<input data-line-discount inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required /></label>
      <label class="crm-field">Impuesto %<input data-line-tax inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required /></label></div>`;
    const select = input(row, 'catalog') as HTMLSelectElement;
    for (const item of catalog) { const option = document.createElement('option');
      option.value = item.id; option.textContent = `${item.name} · ${item.kind === 'service' ? 'servicio' : 'producto'}`;
      select.append(option); }
    for (const [key, data] of Object.entries({ catalog: value.catalogItemId || '', kind: value.kind,
      name: value.name, description: value.description, quantity: value.quantity,
      price: value.unitPrice, discount: value.discountPercent, tax: value.taxPercent })) input(row, key).value = data;
    select.addEventListener('change', () => {
      const item = catalog.find((entry) => entry.id === select.value);
      if (item) {
        input(row, 'kind').value = item.kind; input(row, 'name').value = item.name;
        input(row, 'description').value = item.description;
        if (item.unit_price_cents != null) input(row, 'price').value = (item.unit_price_cents / 100).toFixed(2);
        input(row, 'tax').value = (item.tax_bps / 100).toString();
      }
      recalculate();
    });
    row.querySelector<HTMLButtonElement>('.proposal-remove')!.addEventListener('click', () => {
      if (rows().length > 1) { row.remove(); renumber(); recalculate(); }
    });
    row.addEventListener('input', recalculate); list.append(row); renumber(); recalculate();
  };
  const renumber = () => rows().forEach((row, index) => {
    row.querySelector<HTMLElement>('.proposal-line-number')!.textContent = `Partida ${index + 1}`;
  });
  (initial.length ? initial : [empty]).forEach(add);
  form.querySelector<HTMLButtonElement>('[data-add-line]')?.addEventListener('click', () => {
    if (rows().length < 40) add();
  });
  form.querySelector<HTMLSelectElement>('[data-template]')?.addEventListener('change', (event) => {
    const template = templates.find((entry) => entry.id === (event.target as HTMLSelectElement).value);
    if (!template) return;
    for (const key of ['description', 'scope', 'schedule', 'terms'] as const) {
      const field = form.querySelector<HTMLTextAreaElement>(`[name="${key}"]`);
      if (field) field.value = template[key] || '';
    }
  });
  form.addEventListener('formdata', (event) => event.formData.set('linesJson', JSON.stringify(serialize())));
}
