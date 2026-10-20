import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// A fixed denylist supplements comparison with the local production .env.
// Never use a variable supplied by the candidate TEST config as the only source of truth.
const KNOWN_PRODUCTION_HOSTS = new Set([
  'altaria-digital-index-altarialights.aws-eu-west-1.turso.io',
]);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function readProjectEnv(name) {
  if (!['.env', '.env.test'].includes(name)) throw new Error('Archivo de entorno no autorizado.');
  return readPrivateEnv(join(PROJECT_ROOT, name));
}

export function readPrivateEnv(path) {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`No se pudo leer la configuración privada: ${path}`);
  }
}

export function tursoHost(value) {
  try {
    const url = new URL(value);
    if (!['libsql:', 'https:'].includes(url.protocol)
      || !url.hostname.endsWith('.turso.io')
      || url.username || url.password || url.port
      || !['', '/'].includes(url.pathname) || url.search || url.hash) {
      throw new Error();
    }
    return url.hostname.toLowerCase();
  } catch {
    throw new Error('Se requiere una URL remota Turso válida y sin componentes ambiguos.');
  }
}

export function assertTestDatabase({ targetUrl, token, approvedUrl, productionEnv = null }) {
  if (!targetUrl || !token || !approvedUrl) {
    throw new Error('Faltan URL, token o URL fijada de la base TEST.');
  }
  const target = tursoHost(targetUrl);
  if (target !== tursoHost(approvedUrl)
    || new URL(targetUrl).protocol !== new URL(approvedUrl).protocol) {
    throw new Error('El destino Turso no coincide con la URL TEST fijada.');
  }
  if (KNOWN_PRODUCTION_HOSTS.has(target)) {
    throw new Error('Se ha rechazado la base Turso de producción conocida.');
  }
  if (!target.startsWith('altaria-os-test-')) {
    throw new Error('La base Turso no corresponde al nombre TEST aprobado.');
  }
  if (!productionEnv?.TURSO_DATABASE_URL || !productionEnv?.TURSO_AUTH_TOKEN) {
    throw new Error('No se puede verificar la identidad local de producción; operación cerrada.');
  }
  if (target === tursoHost(productionEnv.TURSO_DATABASE_URL)
    || token === productionEnv.TURSO_AUTH_TOKEN) {
    throw new Error('La configuración TEST coincide con la URL o el token de producción.');
  }
  return target;
}

export function assertTestStripe({ mode, secretKey, webhookSecret, productionEnv = null }) {
  if (mode !== 'test'
    || !secretKey?.startsWith('sk_test_')
    || secretKey === 'sk_test_...'
    || secretKey.includes('REPLACE')
    || !webhookSecret?.startsWith('whsec_')
    || webhookSecret === 'whsec_...'
    || webhookSecret.includes('REPLACE')) {
    throw new Error('Stripe TEST requiere modo test, clave sk_test_ y secreto whsec_ reales.');
  }
  if (!productionEnv?.STRIPE_SECRET_KEY || !productionEnv?.STRIPE_WEBHOOK_SECRET) {
    throw new Error('No se puede verificar la identidad local de Stripe producción.');
  }
  if (secretKey === productionEnv.STRIPE_SECRET_KEY
    || webhookSecret === productionEnv.STRIPE_WEBHOOK_SECRET) {
    throw new Error('La configuración Stripe TEST reutiliza un secreto de producción.');
  }
}

export function assertStagingWorkOS({ clientId, apiKey, redirectUri, cookiePassword, productionEnv = null }) {
  if (!/^client_[A-Za-z0-9]+$/.test(clientId ?? '')
    || !apiKey?.startsWith('sk_test_') || apiKey.includes('REPLACE')
    || redirectUri !== 'http://127.0.0.1:4321/auth/altaria/callback'
    || !cookiePassword || cookiePassword.length < 32) {
    throw new Error('WorkOS local requiere credenciales staging y callback loopback exacto.');
  }
  if (productionEnv?.WORKOS_API_KEY && apiKey === productionEnv.WORKOS_API_KEY) {
    throw new Error('WorkOS staging reutiliza una clave de producción.');
  }
  if (productionEnv?.WORKOS_CLIENT_ID && clientId === productionEnv.WORKOS_CLIENT_ID) {
    throw new Error('WorkOS staging reutiliza el Client ID de producción.');
  }
}

export function assertTestMarkerFormat(expectedMarker) {
  if (!/^[a-f0-9]{64}$/.test(expectedMarker ?? '')) {
    throw new Error('Falta el marcador aleatorio de 32 bytes de la base TEST.');
  }
}

export async function assertRemoteTestMarker(db, expectedMarker) {
  assertTestMarkerFormat(expectedMarker);
  let row;
  try {
    row = await db.get('SELECT marker FROM altaria_test_environment WHERE id = ?', 'test');
  } catch {
    throw new Error('La base Turso no tiene el marcador TEST verificado.');
  }
  if (row?.marker !== expectedMarker) {
    throw new Error('El marcador remoto no coincide con la base TEST aprobada.');
  }
}
