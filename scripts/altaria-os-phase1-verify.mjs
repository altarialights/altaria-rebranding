// Read-only integration check against the isolated Turso TEST database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod });
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const name = '007_altaria_os_identity.sql';
const expectedHash = createHash('sha256').update(readFileSync(new URL(`../migrations/${name}`, import.meta.url))).digest('hex');
const migration = await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?', name);
if (migration?.sha256 !== expectedHash) throw new Error('Hash de migración TEST inesperado.');
const roles = (await db.all('SELECT key FROM altaria_admin_roles ORDER BY key')).map((row) => row.key);
if (roles.join(',') !== 'owner,production,sales,viewer') throw new Error('Catálogo de roles incompleto.');
const users = await db.get('SELECT COUNT(*) AS count FROM altaria_admin_users');
const audits = await db.get('SELECT COUNT(*) AS count FROM altaria_admin_audit_events');
const foreignKeys = await db.all('PRAGMA foreign_key_list(altaria_admin_user_roles)');
if (foreignKeys.length !== 3) throw new Error('Relaciones de roles incompletas.');
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
console.log(JSON.stringify({ markerVerified: true, migrationHashVerified: true, roles: roles.length,
  userCount: Number(users?.count), auditCount: Number(audits?.count), roleForeignKeys: foreignKeys.length }));
