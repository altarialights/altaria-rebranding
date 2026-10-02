// Servidor de QA que no carga .env ni puede contactar Stripe/Turso/Telegram reales.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev } from 'astro';
const envDir = resolve('review/altaria-cards/empty-env');
mkdirSync(envDir, { recursive: true });
for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) delete process.env[key];
Object.assign(process.env, {
  STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_local_unconfigured',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_unconfigured', PUBLIC_GOOGLE_MAPS_API_KEY: 'qa-placeholder',
  ASTRO_TELEMETRY_DISABLED: '1',
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return Promise.reject(new Error('QA: las peticiones externas están bloqueadas.'));
  return originalFetch(input, init);
};
await dev({ server: { host: '127.0.0.1', port: 4322 }, vite: { envDir }, devToolbar: { enabled: false } });
