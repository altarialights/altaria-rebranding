// Applies 001–006 and 008 only to the marker-verified, isolated Turso TEST database.
// 007 is already applied. Source tables start empty; no production data is imported.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

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
if (test.ALTARIA_WORKOS_SIGNUP_DISABLED_VERIFIED !== '1'
  || test.ALTARIA_WORKOS_MFA_VERIFIED !== '1'
  || test.ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED !== '1') {
  throw new Error('WorkOS staging requiere alta libre cerrada, Google y MFA verificados.');
}
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
  throw new Error('El token Turso TEST ha caducado o carece de caducidad.');
}
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const names = [
  '001_create_digital_assessment.sql', '002_create_card_orders.sql',
  '003_add_card_order_stripe_environment.sql', '004_altaria_cards_catalog_and_inquiries.sql',
  '005_card_artwork.sql', '006_card_artwork_3mb.sql', '008_altaria_os_crm.sql',
];
const migrations = names.map((name) => {
  const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') };
});
const phase1Name = '007_altaria_os_identity.sql';
const phase1Hash = createHash('sha256').update(
  readFileSync(new URL(`../migrations/${phase1Name}`, import.meta.url))).digest('hex');
const phase1 = await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?', [phase1Name]);
if (phase1?.sha256 !== phase1Hash) throw new Error('Migración 007 TEST no verificada.');
const current = await db.all('SELECT name, sha256 FROM altaria_schema_migrations ORDER BY name');
if (current.length === 10 && migrations.every((migration) =>
  current.some((row) => row.name === migration.name && row.sha256 === migration.sha256))) {
  for (const laterName of ['009_altaria_os_proposals_gmail.sql', '010_altaria_os_proposal_immutability.sql']) {
    const laterHash = createHash('sha256').update(readFileSync(new URL(`../migrations/${laterName}`, import.meta.url))).digest('hex');
    if (!current.some((row) => row.name === laterName && row.sha256 === laterHash)) {
      throw new Error(`Migración TEST posterior inesperada: ${laterName}`);
    }
  }
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  console.log('Migraciones 001–010 verificadas en TEST; 008 permanece inalterada.');
  process.exit(0);
}
const phase1Only = current.length === 1 && current[0].name === phase1Name;
const complete = current.length === 8 && migrations.every((migration) =>
  current.some((row) => row.name === migration.name && row.sha256 === migration.sha256));
if (!phase1Only && !complete) throw new Error('Historial de migraciones TEST inesperado.');
const tableNames = (await db.all('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name',
  ['table', 'sqlite_%'])).map((row) => row.name);
const initialTables = [
  'altaria_admin_audit_events', 'altaria_admin_revoked_sessions', 'altaria_admin_roles',
  'altaria_admin_user_roles', 'altaria_admin_users', 'altaria_schema_migrations', 'altaria_test_environment',
];
const crmTables = [
  'crm_activities', 'crm_contacts', 'crm_opportunities', 'crm_opportunity_stage_events',
  'crm_organization_identifiers', 'crm_organization_merges', 'crm_organizations',
  'crm_source_links', 'crm_tasks', 'crm_timeline_events',
];
const sourceTables = [
  'card_artwork', 'consultas_tarjetas', 'digital_assessment_answers',
  'digital_assessment_scores', 'digital_assessments', 'digital_lead_events',
  'digital_leads', 'eventos_pedido', 'eventos_stripe', 'pedidos_tarjetas',
];
const expected = [...initialTables, ...crmTables, ...sourceTables].sort();
const sameNames = (a, b) => a.length === b.length && a.every((name, index) => name === b[index]);
if (phase1Only && !sameNames(tableNames, initialTables)) {
  throw new Error('TEST no contiene únicamente el esquema inicial esperado.');
}
if (complete && !sameNames(tableNames, expected)) {
  throw new Error('El esquema TEST aplicado no coincide con 001–008.');
}
const owner = await db.get(`SELECT COUNT(*) AS count FROM altaria_admin_user_roles
  WHERE role_key = ?`, ['owner']);
const users = await db.get('SELECT COUNT(*) AS count FROM altaria_admin_users');
if (Number(owner?.count) !== 1 || Number(users?.count) !== 1) {
  throw new Error('La identidad TEST inicial cambió inesperadamente.');
}
if (complete) {
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  console.log('Migraciones 001–008 ya aplicadas y hashes verificados únicamente en TEST.');
} else {
  const statements = migrations.flatMap((migration) => [
    ...migration.sql.replace(/^\s*--[^\r\n]*/gm, '').split(';')
      .map((part) => part.trim()).filter((part) => part && !/^PRAGMA\s+foreign_keys\s*=/i.test(part))
      .map((sql) => ({ sql, args: [] })),
    { sql: 'INSERT INTO altaria_schema_migrations (name, sha256, applied_at) VALUES (?, ?, ?)',
      args: [migration.name, migration.sha256, new Date().toISOString()] },
  ]);
  await db.batch(statements, 'immediate');
  await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
  const after = (await db.all('SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name',
    ['table', 'sqlite_%'])).map((row) => row.name);
  if (!sameNames(after, expected)) throw new Error('La estructura TEST final no coincide con lo previsto.');
  const fkProblems = await db.all('PRAGMA foreign_key_check');
  if (fkProblems.length) throw new Error('Integridad referencial TEST incorrecta.');
  console.log('Migraciones 001–006 y 008 aplicadas exclusivamente a TEST; 007 conservada; marcador, esquema y claves foráneas verificados.');
}
