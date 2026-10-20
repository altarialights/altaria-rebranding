import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

mkdirSync(resolve('review/altaria-os/empty-env'), { recursive: true });
const env = { ...process.env };
for (const key of [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_MODE', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY', 'VERCEL', 'VERCEL_ENV',
  'WORKOS_CLIENT_ID', 'WORKOS_API_KEY', 'WORKOS_REDIRECT_URI',
  'WORKOS_COOKIE_PASSWORD', 'ALTARIA_TEST_OWNER_EMAIL',
  'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI',
  'ALTARIA_GMAIL_TOKEN_KEY', 'ALTARIA_GMAIL_CONNECT_ENABLED',
  'ALTARIA_TEST_DB_MARKER',
  'ALTARIA_WORKOS_MFA_VERIFIED', 'ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED',
  'ALTARIA_MCP_ENABLED', 'ALTARIA_MCP_OAUTH_ISSUER',
  'ALTARIA_MCP_RESOURCE', 'ALTARIA_MCP_CLIENT_ID',
  'ALTARIA_MCP_ASTRO_ORIGIN', 'ALTARIA_MCP_TRANSPORT_URL',
  'ALTARIA_MCP_OAUTH_AUDIENCE', 'ALTARIA_MCP_RESOURCE_HOST',
]) delete env[key];
Object.assign(env, {
  NODE_ENV: 'production',
  ALTARIA_TEST_ISOLATED: '1',
  STRIPE_MODE: 'test',
  STRIPE_SECRET_KEY: 'sk_test_build_only_no_network',
  STRIPE_WEBHOOK_SECRET: 'whsec_build_only_no_network',
  ALTARIA_WORKOS_MFA_VERIFIED: '0',
  ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED: '0',
  ASTRO_TELEMETRY_DISABLED: '1',
});
const result = spawnSync(process.execPath, [resolve('node_modules/astro/bin/astro.mjs'), 'build'], {
  env, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
