// Read-only staging verification; never emits identities, session IDs or credentials.
import { connect } from '@tursodatabase/serverless';
import { WorkOS } from '@workos-inc/node';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test?.ALTARIA_TEST_OWNER_EMAIL) throw new Error('Falta el propietario TEST autorizado.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: prod });
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const workos = new WorkOS(test.WORKOS_API_KEY, { clientId: test.WORKOS_CLIENT_ID });
const [users, events] = await Promise.all([
  workos.userManagement.listUsers({ limit: 20 }),
  workos.events.listEvents({ events: ['authentication.oauth_succeeded', 'authentication.mfa_succeeded'],
    rangeStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), limit: 100 }),
]);
const ownerEmail = test.ALTARIA_TEST_OWNER_EMAIL.trim().toLowerCase();
const other = users.data.filter((user) => user.email.toLowerCase() !== ownerEmail);
if (other.length !== 1 || !other[0].emailVerified) {
  throw new Error('La segunda identidad staging no es única o no está verificada.');
}
const [identities, factors, sessions] = await Promise.all([
  workos.userManagement.getUserIdentities(other[0].id),
  workos.multiFactorAuth.listUserAuthFactors({ userId: other[0].id, limit: 20 }),
  workos.userManagement.listSessions(other[0].id, { limit: 20 }),
]);
if (identities.length !== 1 || identities[0].provider !== 'GoogleOAuth') {
  throw new Error('La segunda identidad no proviene sólo de Google.');
}
const eventMatches = (name) => events.data.some((event) => event.event === name
  && event.data.userId === other[0].id && event.context?.client_id === test.WORKOS_CLIENT_ID);
const unauthorizedInDb = await db.get(`SELECT id FROM altaria_admin_users
  WHERE workos_user_id = ? OR email = ?`, [other[0].id, other[0].email.trim().toLowerCase()]);
const usersInDb = await db.get('SELECT COUNT(*) AS count FROM altaria_admin_users');
const ownersInDb = await db.get(`SELECT COUNT(*) AS count FROM altaria_admin_user_roles
  WHERE role_key = ?`, ['owner']);
if (unauthorizedInDb || Number(usersInDb?.count) !== 1 || Number(ownersInDb?.count) !== 1) {
  throw new Error('La lista de acceso Turso TEST cambió inesperadamente.');
}
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
console.log(JSON.stringify({ secondGoogleIdentityVerified: true,
  totpEnrolled: factors.data.some((factor) => factor.type === 'totp'),
  activeOAuthSession: sessions.data.some((session) => session.status === 'active' && session.authMethod === 'oauth'),
  oauthSuccessEventForApp: eventMatches('authentication.oauth_succeeded'),
  mfaSuccessEventForApp: eventMatches('authentication.mfa_succeeded'),
  unauthorizedIdentityAbsentFromTurso: true, oneOwnerOnly: true, markerVerified: true }));
