// Read-only verification of the one approved owner in Turso TEST and WorkOS staging.
import { connect } from '@tursodatabase/serverless';
import { WorkOS } from '@workos-inc/node';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test?.ALTARIA_TEST_OWNER_EMAIL) throw new Error('Falta el correo propietario TEST autorizado.');
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
const expectedEmail = test.ALTARIA_TEST_OWNER_EMAIL.trim().toLowerCase();
const users = await workos.userManagement.listUsers({ email: expectedEmail, limit: 10 });
const matches = users.data.filter((user) => user.email.toLowerCase() === expectedEmail);
if (matches.length !== 1 || !matches[0].emailVerified) throw new Error('Identidad staging inesperada.');
const identities = await workos.userManagement.getUserIdentities(matches[0].id);
if (identities.length !== 1 || identities[0].provider !== 'GoogleOAuth') {
  throw new Error('Identidad Google staging inesperada.');
}
const total = await db.get('SELECT COUNT(*) AS count FROM altaria_admin_users');
const owner = await db.get(`SELECT id, email, workos_user_id, status FROM altaria_admin_users
  WHERE email = ?`, [expectedEmail]);
if (Number(total?.count) !== 1 || !owner || owner.workos_user_id !== matches[0].id
  || owner.email !== expectedEmail || owner.status !== 'active') {
  throw new Error('El propietario TEST no coincide con la identidad WorkOS estable.');
}
const roles = await db.all('SELECT role_key FROM altaria_admin_user_roles WHERE user_id = ?', [owner.id]);
if (roles.length !== 1 || roles[0].role_key !== 'owner') throw new Error('Asignación de roles inesperada.');
const audit = await db.get(`SELECT COUNT(*) AS count FROM altaria_admin_audit_events
  WHERE actor_user_id = ? AND action = ? AND outcome = ?`,
  [owner.id, 'admin.owner.provision', 'success']);
if (Number(audit?.count) !== 1) throw new Error('Falta la auditoría del alta TEST.');
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
console.log(JSON.stringify({ markerVerified: true, exactGoogleEmailVerified: true,
  stableWorkosUserIdBound: true, activeOwners: 1, ownerOnlyRole: true,
  provisioningAuditRecorded: true }));
