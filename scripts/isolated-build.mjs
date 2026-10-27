import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

mkdirSync(resolve('review/empty-env'), { recursive: true });
const env = { ...process.env };
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY', 'VERCEL', 'VERCEL_ENV',
  'ALTARIA_TEST_DB_MARKER',
]) delete env[key];
Object.assign(env, {
  NODE_ENV: 'production',
  ALTARIA_TEST_ISOLATED: '1',
  STRIPE_MODE: 'test',
  STRIPE_SECRET_KEY: 'sk_test_build_only_no_network',
  STRIPE_WEBHOOK_SECRET: 'whsec_build_only_no_network',
  ASTRO_TELEMETRY_DISABLED: '1',
});
const result = spawnSync(process.execPath, [resolve('node_modules/astro/bin/astro.mjs'), 'build'], {
  env, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
