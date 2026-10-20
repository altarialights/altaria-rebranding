const forms = document.querySelectorAll<HTMLFormElement>('form[data-crm-form]');
for (const form of forms) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const message = form.querySelector<HTMLElement>('[data-crm-error]');
    if (message) { message.textContent = ''; message.hidden = true; }
    if (button) button.disabled = true;
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) if (typeof value === 'string') body.append(key, value);
      const response = await fetch(form.action, {
        method: 'POST', credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const result = await response.json() as { redirect?: string; error?: string };
      if (!response.ok || !result.redirect) throw new Error(result.error || 'No se pudo guardar. Inténtalo de nuevo.');
      window.location.assign(result.redirect);
    } catch (error) {
      if (message) {
        message.textContent = error instanceof Error ? error.message : 'No se pudo guardar.';
        message.hidden = false;
        message.focus();
      }
    } finally { if (button) button.disabled = false; }
  });
}

const dedupButton = document.querySelector<HTMLButtonElement>('[data-crm-dedup-check]');
dedupButton?.addEventListener('click', async () => {
  const form = dedupButton.closest<HTMLFormElement>('form');
  const result = form?.querySelector<HTMLElement>('[data-crm-dedup-result]');
  if (!form || !result) return;
  dedupButton.disabled = true;
  result.textContent = 'Buscando coincidencias…';
  try {
    const body = new URLSearchParams();
    for (const key of ['csrf', 'name', 'city', 'identifierKind', 'identifierValue']) {
      const value = new FormData(form).get(key);
      if (typeof value === 'string') body.set(key, value);
    }
    const response = await fetch('/api/admin/crm/dedup', {
      method: 'POST', credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json() as { kind?: string; matches?: Array<{ id: string; name: string }>; error?: string };
    if (!response.ok) throw new Error(data.error || 'No se pudo comprobar.');
    result.replaceChildren();
    if (data.kind === 'new') result.textContent = 'No se encontraron coincidencias en el CRM.';
    else {
      const label = document.createElement('strong');
      label.textContent = data.kind === 'reliable' ? 'Coincidencia fiable. Abre la ficha existente.'
        : 'Posible duplicado. Revisa estas fichas antes de continuar.';
      result.append(label);
      for (const match of data.matches ?? []) {
        const link = document.createElement('a');
        link.href = `/admin/crm/empresas/${match.id}`;
        link.textContent = match.name;
        result.append(link);
      }
    }
  } catch (error) { result.textContent = error instanceof Error ? error.message : 'No se pudo comprobar.'; }
  finally { dedupButton.disabled = false; }
});
