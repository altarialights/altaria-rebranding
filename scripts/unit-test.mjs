import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const emptyEnvDir = resolve('review/empty-env');
mkdirSync(emptyEnvDir, { recursive: true });
const env = { ...process.env, NODE_ENV: 'test', ALTARIA_LOCAL_ISOLATION: '1' };
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY', 'ALTARIA_TEST_ISOLATED', 'ALTARIA_TEST_TURSO_URL',
]) delete env[key];
const command = resolve('node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [command, 'run', ...process.argv.slice(2)], {
  env, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
