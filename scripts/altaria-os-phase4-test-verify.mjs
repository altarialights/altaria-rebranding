import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en entorno local.');
}
const env = { ...process.env, ALTARIA_PHASE4_INTEGRATION_TEST: '1', NODE_ENV: 'test' };
for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'WORKOS_API_KEY']) delete env[key];
const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'),
  'run', '--config', 'vitest.phase4-test.config.mjs'], { env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
