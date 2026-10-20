// One-time local import of a browser-downloaded staging key. Prints no values.
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertStagingWorkOS, assertTestDatabase, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--import-staging-key') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Importación WorkOS permitida sólo de forma local y explícita.');
}
const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod });
if (test.WORKOS_API_KEY || test.WORKOS_CLIENT_ID) {
  throw new Error('WorkOS ya está configurado en .env.test; se rechaza una sobrescritura ambigua.');
}
const transfer = resolve('review/altaria-os/private/workos-staging.json');
const candidate = JSON.parse(readFileSync(transfer, 'utf8'));
const cookiePassword = randomBytes(48).toString('base64url');
const redirectUri = 'http://127.0.0.1:4321/auth/altaria/callback';
assertStagingWorkOS({ clientId: candidate.clientId, apiKey: candidate.apiKey,
  redirectUri, cookiePassword, productionEnv: prod });
appendFileSync(resolve('.env.test'), `\nWORKOS_CLIENT_ID=${candidate.clientId}\nWORKOS_API_KEY=${candidate.apiKey}\nWORKOS_REDIRECT_URI=${redirectUri}\nWORKOS_COOKIE_PASSWORD=${cookiePassword}\nALTARIA_WORKOS_MFA_VERIFIED=0\nALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED=0\n`, 'utf8');
unlinkSync(transfer);
console.log('WorkOS staging guardado en .env.test ignorado; clave temporal eliminada. Políticas pendientes de prueba real.');
