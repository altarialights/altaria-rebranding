// One-time TEST owner enrollment after a real Google + TOTP staging sign-in.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { WorkOS } from '@workos-inc/node';
import {
  assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv,
} from './lib/test-isolation.mjs';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en un entorno local.');
}
const production = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: production });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: production });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: production });
const tokenPayload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(tokenPayload.exp) || tokenPayload.exp * 1000 <= Date.now()) {
  throw new Error('Token de Turso TEST caducado o sin caducidad.');
}
const email = test.ALTARIA_TEST_OWNER_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('.test')) {
  throw new Error('Configura ALTARIA_TEST_OWNER_EMAIL con el correo real autorizado en .env.test.');
}
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const migrationName = '007_altaria_os_identity.sql';
const expectedHash = createHash('sha256').update(readFileSync(new URL(`../migrations/${migrationName}`, import.meta.url))).digest('hex');
const migration = await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?', migrationName);
if (migration?.sha256 !== expectedHash) throw new Error('La migración TEST no coincide con el código.');

const workos = new WorkOS(test.WORKOS_API_KEY, { clientId: test.WORKOS_CLIENT_ID });
const users = await workos.userManagement.listUsers({ email, limit: 10 });
const matches = users.data.filter((user) => user.email.trim().toLowerCase() === email);
if (matches.length !== 1 || !matches[0].emailVerified) {
  throw new Error('Se requiere exactamente una identidad WorkOS staging con email verificado.');
}
const user = matches[0];
const [identities, factors, sessions, connections, events] = await Promise.all([
  workos.userManagement.getUserIdentities(user.id),
  workos.multiFactorAuth.listUserAuthFactors({ userId: user.id, limit: 20 }),
  workos.userManagement.listSessions(user.id, { limit: 20 }),
  workos.sso.listConnections({ limit: 10 }),
  workos.events.listEvents({
    events: ['authentication.oauth_succeeded', 'authentication.mfa_succeeded'],
    rangeStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    limit: 100, order: 'desc',
  }),
]);
if (connections.data.length !== 0) throw new Error('Existe una conexión SSO que podría omitir el MFA de WorkOS.');
if (identities.length !== 1 || identities[0].type !== 'OAuth' || identities[0].provider !== 'GoogleOAuth') {
  throw new Error('La identidad staging no se verificó mediante Google OAuth.');
}
if (!factors.data.some((factor) => factor.type === 'totp')) {
  throw new Error('No consta un factor TOTP inscrito en WorkOS staging.');
}
if (!sessions.data.some((session) => session.status === 'active' && session.authMethod === 'oauth')) {
  throw new Error('No consta una sesión activa Google OAuth en WorkOS staging.');
}
const matchingEvents = (kind) => events.data.filter((event) => event.event === kind
  && event.data.userId === user.id && event.context?.client_id === test.WORKOS_CLIENT_ID);
if (matchingEvents('authentication.oauth_succeeded').length === 0
  || matchingEvents('authentication.mfa_succeeded').length === 0) {
  throw new Error('No constan eventos de éxito Google OAuth y MFA de esta aplicación staging.');
}

const existing = await db.all('SELECT id, email, workos_user_id, status FROM altaria_admin_users');
if (existing.length > 1 || (existing.length === 1 &&
  (existing[0].email !== email || existing[0].workos_user_id !== user.id || existing[0].status !== 'active'))) {
  throw new Error('Existe otro usuario en Turso TEST; se rechaza el aprovisionamiento automático.');
}
if (existing.length === 0) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  await db.batch([
    { sql: `INSERT INTO altaria_admin_users
      (id, email, workos_user_id, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, email, user.id, user.name || email, 'active', now, now] },
    { sql: `INSERT INTO altaria_admin_user_roles (user_id, role_key, granted_at, granted_by)
      VALUES (?, ?, ?, ?)`, args: [id, 'owner', now, id] },
    { sql: `INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), now, id, null, 'admin.owner.provision', 'admin_user', id, 'success', '{}'] },
  ], 'immediate');
}
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const assignment = await db.get(`SELECT COUNT(*) AS count FROM altaria_admin_user_roles
  WHERE user_id = (SELECT id FROM altaria_admin_users WHERE workos_user_id = ? AND email = ? AND status = ?)
    AND role_key = ?`, [user.id, email, 'active', 'owner']);
if (Number(assignment?.count) !== 1) throw new Error('No se confirmó el rol owner en TEST.');
console.log(JSON.stringify({ stagingGoogleIdentityVerified: true, stagingTotpFactorVerified: true,
  stagingOAuthAndMfaEventsVerified: true,
  stagingGoogleSessionVerified: true, testMarkerVerified: true, ownerRoleVerified: true,
  alreadyProvisioned: existing.length === 1 }));
