// Append-only Phase 3 migration. Refuses anything except the marked, isolated remote TEST DB.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en entorno local.');
}
const test = readProjectEnv('.env.test');
const production = readProjectEnv('.env');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: production });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: production });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: production });
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('Token Turso TEST no válido.');
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const names = [
  '001_create_digital_assessment.sql', '002_create_card_orders.sql',
  '003_add_card_order_stripe_environment.sql', '004_altaria_cards_catalog_and_inquiries.sql',
  '005_card_artwork.sql', '006_card_artwork_3mb.sql', '007_altaria_os_identity.sql',
  '008_altaria_os_crm.sql', '009_altaria_os_proposals_gmail.sql',
  '010_altaria_os_proposal_immutability.sql',
];
const migrations = names.map((name) => ({ name,
  sql: readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
})).map((item) => ({ ...item, sha256: createHash('sha256').update(item.sql).digest('hex') }));
const applied = await db.all('SELECT name, sha256 FROM altaria_schema_migrations ORDER BY name');
if (![8, 9, 10].includes(applied.length)) throw new Error('Historial TEST inesperado.');
for (const item of migrations.slice(0, 8)) {
  if (!applied.some((row) => row.name === item.name && row.sha256 === item.sha256)) {
    throw new Error(`Migración anterior alterada o ausente: ${item.name}`);
  }
}
const phase3 = migrations[8];
if (applied.length === 10) {
  for (const item of migrations.slice(8)) {
    if (!applied.some((row) => row.name === item.name && row.sha256 === item.sha256)) {
      throw new Error(`Migración TEST con hash inesperado: ${item.name}`);
    }
  }
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  console.log('Migraciones 001–010 ya aplicadas y hashes verificados únicamente en TEST.');
  process.exit(0);
}
if (applied.length === 9) {
  if (!applied.some((row) => row.name === phase3.name && row.sha256 === phase3.sha256)) {
    throw new Error('Migración 009 TEST con hash inesperado.');
  }
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  console.log('Migraciones 001–009 ya aplicadas y hashes verificados únicamente en TEST.');
  process.exit(0);
}
const expectedBefore = [
  'altaria_admin_audit_events', 'altaria_admin_revoked_sessions', 'altaria_admin_roles',
  'altaria_admin_user_roles', 'altaria_admin_users', 'altaria_schema_migrations',
  'altaria_test_environment', 'card_artwork', 'consultas_tarjetas', 'crm_activities',
  'crm_contacts', 'crm_opportunities', 'crm_opportunity_stage_events',
  'crm_organization_identifiers', 'crm_organization_merges', 'crm_organizations',
  'crm_source_links', 'crm_tasks', 'crm_timeline_events', 'digital_assessment_answers',
  'digital_assessment_scores', 'digital_assessments', 'digital_lead_events',
  'digital_leads', 'eventos_pedido', 'eventos_stripe', 'pedidos_tarjetas',
].sort();
const before = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map((row) => row.name);
if (JSON.stringify(before) !== JSON.stringify(expectedBefore)) throw new Error('Tablas TEST previas inesperadas.');
const statements = phase3.sql.replace(/^\s*--[^\r\n]*/gm, '').split(';')
  .map((part) => part.trim()).filter(Boolean).map((sql) => ({ sql, args: [] }));
await db.batch([...statements, { sql: `INSERT INTO altaria_schema_migrations
  (name, sha256, applied_at) VALUES (?, ?, ?)`,
args: [phase3.name, phase3.sha256, new Date().toISOString()] }], 'immediate');
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const problems = await db.all('PRAGMA foreign_key_check');
if (problems.length) throw new Error('Integridad referencial TEST incorrecta.');
console.log('Migración 009 aplicada únicamente en Turso TEST; marcador, hash e integridad verificados.');
