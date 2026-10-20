import { spawn } from 'node:child_process';
import { connect } from '@tursodatabase/serverless';
import {
  assertRemoteTestMarker,
  assertTestDatabase,
  assertTestStripe,
  readProjectEnv,
} from './lib/test-isolation.mjs';

if (process.env.CI || process.env.VERCEL_ENV) {
  throw new Error('El listener Stripe TEST sólo puede iniciarse localmente.');
}

const production = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');

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

const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);

const cliEnv = { ...process.env, STRIPE_API_KEY: test.STRIPE_SECRET_KEY };
for (const name of [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
]) delete cliEnv[name];

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes', '--package', '@stripe/cli@1.53.1', 'stripe', 'listen',
  '--events-from', '@self',
  '--events', 'checkout.session.completed,checkout.session.expired',
  '--forward-to', 'http://127.0.0.1:4321/api/stripe/webhook',
  '--skip-update',
], {
  env: cliEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let output = '';
let ready = false;
const inspect = (chunk) => {
  output = (output + chunk.toString()).slice(-16384);
  if (ready || !output.includes('Ready!')) return;
  const secret = output.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!secret) return;
  if (secret !== test.STRIPE_WEBHOOK_SECRET) {
    console.error('El secreto del listener no coincide con .env.test.');
    child.kill();
    process.exitCode = 1;
    return;
  }
  ready = true;
  output = '';
  console.log('Listener Stripe TEST listo para http://127.0.0.1:4321/api/stripe/webhook');
};
child.stdout.on('data', inspect);
child.stderr.on('data', inspect);
child.on('error', () => {
  console.error('No se pudo iniciar la CLI Stripe TEST.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (!ready && process.exitCode !== 1) {
    console.error('El listener Stripe TEST terminó antes de estar listo.');
    process.exitCode = code || 1;
  }
});
