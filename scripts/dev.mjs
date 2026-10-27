import { connect } from '@tursodatabase/serverless';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { assertRemoteTestMarker, assertTestDatabase, assertTestMarkerFormat, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

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
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);

for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY',
]) delete process.env[key];
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]) process.env[key] = test[key];
process.env.ALTARIA_TEST_ISOLATED = '1';
process.env.ALTARIA_TEST_TURSO_URL = test.ALTARIA_TEST_TURSO_URL;
process.env.ALTARIA_TEST_DB_MARKER = test.ALTARIA_TEST_DB_MARKER;
process.env.ASTRO_TELEMETRY_DISABLED = '1';

// Optional local meeting authorization. Only booking settings are imported.
if (existsSync('.env.bookings.local')) {
  const booking = parseEnv(readFileSync('.env.bookings.local','utf8'));
  if ((booking.BOOKING_TEST_TELEGRAM_BOT_TOKEN && booking.BOOKING_TEST_TELEGRAM_BOT_TOKEN === production?.TELEGRAM_BOT_TOKEN)
    || (booking.BOOKING_TEST_TELEGRAM_CHAT_ID && booking.BOOKING_TEST_TELEGRAM_CHAT_ID === production?.TELEGRAM_CHAT_ID)) {
    throw new Error('Las reuniones de prueba requieren un bot y un chat distintos de producción.');
  }
  for (const [key,value] of Object.entries(booking)) {
    if (key.startsWith('BOOKING_') || key === 'CRON_SECRET') process.env[key] = value;
  }
}

// Vite must not merge the project's production .env into the test process.
const emptyEnvDir = resolve('review/empty-env');
mkdirSync(emptyEnvDir, { recursive: true });
const { dev } = await import('astro');
await dev({ vite: { envDir: emptyEnvDir }, server: { host: '127.0.0.1', port: 4321 } });

