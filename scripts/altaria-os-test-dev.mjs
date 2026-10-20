import { connect } from '@tursodatabase/serverless';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase, assertTestMarkerFormat, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

const production = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test. No se inicia el servidor de desarrollo.');
if (process.env.VERCEL_ENV || process.env.CI) {
  throw new Error('El servidor TEST local no puede iniciarse en Vercel o CI.');
}
assertTestDatabase({
  targetUrl: test.TURSO_DATABASE_URL,
  token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL,
  productionEnv: production,
});
assertTestStripe({
  mode: test.STRIPE_MODE,
  secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET,
  productionEnv: production,
});
assertTestMarkerFormat(test.ALTARIA_TEST_DB_MARKER);
if (['WORKOS_CLIENT_ID', 'WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD'].some((key) => test[key])) {
  assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
    redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
    productionEnv: production });
}
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);

for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY',
  'WORKOS_CLIENT_ID', 'WORKOS_API_KEY', 'WORKOS_REDIRECT_URI',
  'WORKOS_COOKIE_PASSWORD', 'ALTARIA_WORKOS_MFA_VERIFIED',
  'ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED', 'ALTARIA_TEST_DB_MARKER',
  'ALTARIA_MCP_ENABLED', 'ALTARIA_MCP_OAUTH_ISSUER',
  'ALTARIA_MCP_RESOURCE', 'ALTARIA_MCP_CLIENT_ID',
  'ALTARIA_MCP_ASTRO_ORIGIN', 'ALTARIA_MCP_TRANSPORT_URL',
  'ALTARIA_MCP_OAUTH_AUDIENCE', 'ALTARIA_MCP_RESOURCE_HOST',
]) delete process.env[key];
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]) process.env[key] = test[key];
for (const key of [
  'WORKOS_CLIENT_ID', 'WORKOS_API_KEY', 'WORKOS_REDIRECT_URI',
  'WORKOS_COOKIE_PASSWORD', 'ALTARIA_WORKOS_MFA_VERIFIED',
  'ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED',
  'ALTARIA_MCP_ENABLED', 'ALTARIA_MCP_OAUTH_ISSUER',
  'ALTARIA_MCP_RESOURCE', 'ALTARIA_MCP_CLIENT_ID',
  'ALTARIA_MCP_ASTRO_ORIGIN', 'ALTARIA_MCP_TRANSPORT_URL',
  'ALTARIA_MCP_OAUTH_AUDIENCE', 'ALTARIA_MCP_RESOURCE_HOST',
]) {
  if (test[key]) process.env[key] = test[key];
}
process.env.ALTARIA_TEST_ISOLATED = '1';
process.env.ALTARIA_TEST_TURSO_URL = test.ALTARIA_TEST_TURSO_URL;
process.env.ALTARIA_TEST_DB_MARKER = test.ALTARIA_TEST_DB_MARKER;
process.env.ALTARIA_LOCAL_WORKER_SECRET = randomBytes(32).toString('hex');
process.env.ASTRO_TELEMETRY_DISABLED = '1';

// Vite must not merge the project's production .env into the test process.
const emptyEnvDir = resolve('review/altaria-os/empty-env');
mkdirSync(emptyEnvDir, { recursive: true });
const { dev } = await import('astro');
await dev({ vite: { envDir: emptyEnvDir }, server: { host: '127.0.0.1', port: 4321 } });

// A single local TEST worker wakes due jobs. It never receives a Telegram token.
let workerRunning = false;
const tick = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await fetch('http://127.0.0.1:4321/api/internal/altaria-test-tick', {
      method: 'POST', headers: { 'x-altaria-worker-secret': process.env.ALTARIA_LOCAL_WORKER_SECRET,
        Origin: 'http://127.0.0.1:4321', 'Content-Type': 'application/json' },body:'{}',
      signal: AbortSignal.timeout(55_000),
    });
  } catch { /* The next interval retries; no secret is logged. */ }
  finally { workerRunning = false; }
};
setTimeout(tick, 5_000).unref();
setInterval(tick, 60_000).unref();
