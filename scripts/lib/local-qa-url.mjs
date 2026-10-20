export function assertLocalQaUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('La URL de QA no es válida.'); }
  if (url.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    || url.username || url.password) {
    throw new Error('Los scripts de QA sólo pueden apuntar a un servidor HTTP local.');
  }
}
