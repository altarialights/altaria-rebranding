// Read-only identity check. Never prints credentials or the marker value.
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

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
if (test.WORKOS_CLIENT_ID || test.WORKOS_API_KEY) {
  assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
    redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
    productionEnv: production });
}
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
  throw new Error('El token Turso TEST ha caducado o carece de caducidad.');
}
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const tables = await db.all('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name', ['table', 'sqlite_%']);
console.log(JSON.stringify({ tursoTestIdentity: true, stripeTestIdentity: true,
  workosStagingIdentity: Boolean(test.WORKOS_API_KEY), tokenValid: true,
  markerVerified: true, workosVerificationFlags: {
    mfa: test.ALTARIA_WORKOS_MFA_VERIFIED === '1',
    googleOnly: test.ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED === '1',
    signupDisabled: test.ALTARIA_WORKOS_SIGNUP_DISABLED_VERIFIED === '1',
  }, tables: tables.map((row) => row.name) }));
