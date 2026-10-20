import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const emptyEnvDir = resolve('review/altaria-os/empty-env');
mkdirSync(emptyEnvDir, { recursive: true });
const env = { ...process.env, NODE_ENV: 'test', ALTARIA_LOCAL_ISOLATION: '1' };
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY', 'ALTARIA_TEST_ISOLATED', 'ALTARIA_TEST_TURSO_URL',
  'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI',
  'ALTARIA_GMAIL_TOKEN_KEY', 'ALTARIA_GMAIL_CONNECT_ENABLED',
  'ALTARIA_MCP_ENABLED', 'ALTARIA_MCP_OAUTH_ISSUER',
  'ALTARIA_MCP_RESOURCE', 'ALTARIA_MCP_CLIENT_ID',
  'ALTARIA_MCP_ASTRO_ORIGIN', 'ALTARIA_MCP_TRANSPORT_URL',
  'ALTARIA_MCP_OAUTH_AUDIENCE', 'ALTARIA_MCP_RESOURCE_HOST',
]) delete env[key];
const command = resolve('node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [command, 'run', ...process.argv.slice(2)], {
  env, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
