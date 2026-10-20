// Applies only migration 007 to the approved, marker-verified Turso TEST database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

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
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
  throw new Error('El token Turso TEST ha caducado o carece de caducidad.');
}
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const names = (await db.all('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name',
  ['table', 'sqlite_%'])).map((row) => row.name);
const expectedAfter = [
  'altaria_admin_audit_events', 'altaria_admin_revoked_sessions', 'altaria_admin_roles',
  'altaria_admin_user_roles', 'altaria_admin_users', 'altaria_schema_migrations', 'altaria_test_environment',
];
const before = names.length === 1 && names[0] === 'altaria_test_environment';
const after = names.length === expectedAfter.length && names.every((name, index) => name === expectedAfter[index]);
if (!before && !after) throw new Error('Esquema TEST inesperado; se rechaza la migración.');

const migration = '007_altaria_os_identity.sql';
const sql = readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
const hash = createHash('sha256').update(sql).digest('hex');
if (after) {
  const row = await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?', migration);
  if (row?.sha256 !== hash) throw new Error('La migración TEST registrada no coincide con el archivo actual.');
  console.log('Migración 007 ya aplicada y hash verificado en TEST.');
} else {
  const statements = sql.replace(/^\s*--[^\r\n]*/gm, '').split(';').map((part) => part.trim()).filter(Boolean);
  await db.batch([
    { sql: 'CREATE TABLE altaria_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)', args: [] },
    ...statements.map((statement) => ({ sql: statement, args: [] })),
    { sql: 'INSERT INTO altaria_schema_migrations (name, sha256, applied_at) VALUES (?, ?, ?)',
      args: [migration, hash, new Date().toISOString()] },
  ], 'immediate');
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  console.log('Migración 007 aplicada exclusivamente en TEST y marcador reconfirmado.');
}
