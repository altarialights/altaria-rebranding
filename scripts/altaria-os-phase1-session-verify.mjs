// Read-only verification of the owner's TEST logout. Never prints session IDs or hashes.
import { createHash } from 'node:crypto';
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
const owner = await db.get(`SELECT id, workos_user_id FROM altaria_admin_users
  WHERE email = ? AND status = ?`, [test.ALTARIA_TEST_OWNER_EMAIL.trim().toLowerCase(), 'active']);
if (!owner?.id || !owner?.workos_user_id) throw new Error('Propietario TEST no encontrado.');
const revoked = await db.get(`SELECT session_hash, revoked_at, expires_at
  FROM altaria_admin_revoked_sessions WHERE actor_user_id = ?
  ORDER BY revoked_at DESC LIMIT 1`, [owner.id]);
if (!revoked || !/^[a-f0-9]{64}$/.test(revoked.session_hash)
  || new Date(revoked.expires_at) <= new Date()) throw new Error('Falta revocación TEST vigente.');
const audit = await db.get(`SELECT COUNT(*) AS count FROM altaria_admin_audit_events
  WHERE actor_user_id = ? AND actor_session_hash = ? AND action = ? AND outcome = ?`,
  [owner.id, revoked.session_hash, 'admin.session.revoke', 'success']);
if (Number(audit?.count) !== 1) throw new Error('Falta auditoría de cierre TEST.');
const workos = new WorkOS(test.WORKOS_API_KEY, { clientId: test.WORKOS_CLIENT_ID });
const [sessions, events] = await Promise.all([
  workos.userManagement.listSessions(owner.workos_user_id, { limit: 100 }),
  workos.events.listEvents({ events: ['session.revoked'],
    rangeStart: new Date(new Date(revoked.revoked_at).getTime() - 60_000).toISOString(), limit: 100 }),
]);
const remote = sessions.data.find((session) => createHash('sha256').update(session.id).digest('hex')
  === revoked.session_hash);
const remoteRevocationEvent = events.data.some((event) => event.event === 'session.revoked'
  && event.data.userId === owner.workos_user_id
  && createHash('sha256').update(event.data.id).digest('hex') === revoked.session_hash);
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
console.log(JSON.stringify({ localSessionRevoked: true, logoutAuditRecorded: true,
  remoteSessionFound: Boolean(remote), remoteSessionNotActive: remote ? remote.status !== 'active' : null,
  remoteRevocationEvent }));
