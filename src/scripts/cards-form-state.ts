type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as Field;
export const value = (form: HTMLFormElement, name: string) => field(form, name).value.trim();
export const money = (amount: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount / 100);
export const readStored = (key: string): Record<string, unknown> | null => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return stored && typeof stored === 'object' && Date.now() - Number(stored.savedAt) < 86_400_000 ? stored : null;
  } catch { return null; }
};
export const writeStored = (key: string, data: Record<string, unknown>) => {
  try { sessionStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* Optional private-session storage. */ }
};
export const fieldsSnapshot = (form: HTMLFormElement) => Object.fromEntries(
  [...form.querySelectorAll<Field>('input[name], select[name], textarea[name]')]
    .filter((item) => item.type !== 'checkbox' && (item.type !== 'radio' || (item as HTMLInputElement).checked) && item.name !== 'website').map((item) => [item.name, item.value]),
);
export const restoreFields = (form: HTMLFormElement, data: unknown) => {
  if (!data || typeof data !== 'object') return;
  for (const [name, storedValue] of Object.entries(data)) {
    const element = form.elements.namedItem(name);
    if (element instanceof RadioNodeList && typeof storedValue === 'string') {
      element.forEach(item => { if (item instanceof HTMLInputElement && item.type === 'radio') item.checked = item.value === storedValue; });
      continue;
    }
    if ((element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
      && element.type !== 'checkbox' && typeof storedValue === 'string' && storedValue.length <= 3000) element.value = storedValue;
  }
};
const requestKeys = new Map<string, { signature: string; key: string }>();
export const requestKey = (namespace: string, data: unknown): string => {
  const signature = JSON.stringify(data);
  const old = requestKeys.get(namespace) ?? readStored(`${namespace}.request`);
  if (old?.signature === signature && typeof old.key === 'string') return old.key;
  const next = { signature, key: crypto.randomUUID() };
  requestKeys.set(namespace, next); writeStored(`${namespace}.request`, next);
  return next.key;
};
export const post = async (url: string, body: unknown) => {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new Error('No hemos podido conectar. Comprueba tu conexión y vuelve a intentarlo; tus datos siguen aquí.'); }
  const decoded: unknown = await response.json().catch(() => null);
  const result = decoded && typeof decoded === 'object' ? decoded as Record<string, unknown> : {};
  if (!response.ok) {
    const errors = result.fields && typeof result.fields === 'object' ? Object.values(result.fields).filter((item) => typeof item === 'string').join(' ') : '';
    throw new Error(errors || (typeof result.message === 'string' ? result.message : '') || (typeof result.error === 'string' ? result.error : '') || 'No se ha podido completar la solicitud. Inténtalo otra vez.');
  }
  return result as Record<string, unknown>;
};

