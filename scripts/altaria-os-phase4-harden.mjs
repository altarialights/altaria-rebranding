// Append-only Phase 4 safety triggers, restricted to marker-verified Turso TEST.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en entorno local.');
}
const test = readProjectEnv('.env.test'), production = readProjectEnv('.env');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: production });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: production });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: production });
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('Token Turso TEST caducado.');
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const names = ['001_create_digital_assessment.sql', '002_create_card_orders.sql',
  '003_add_card_order_stripe_environment.sql', '004_altaria_cards_catalog_and_inquiries.sql',
  '005_card_artwork.sql', '006_card_artwork_3mb.sql', '007_altaria_os_identity.sql',
  '008_altaria_os_crm.sql', '009_altaria_os_proposals_gmail.sql',
  '010_altaria_os_proposal_immutability.sql', '011_altaria_os_cards_production.sql',
  '012_altaria_os_cards_payment_guards.sql'];
const hashes = names.map((name) => ({ name, sha256: createHash('sha256').update(
  readFileSync(new URL(`../migrations/${name}`, import.meta.url))).digest('hex') }));
const applied = await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
if (![11, 12].includes(applied.length)) throw new Error('Historial TEST inesperado.');
for (const item of hashes.slice(0, applied.length)) {
  if (!applied.some((row) => row.name === item.name && row.sha256 === item.sha256)) {
    throw new Error(`Migración TEST ausente o alterada: ${item.name}`);
  }
}
const existing = (await db.all(`SELECT name FROM sqlite_master WHERE type='trigger'
  AND name IN ('cards_jobs_payment_event_insert','cards_jobs_payment_event_transition',
    'cards_jobs_block_incident_transition') ORDER BY name`)).map((row) => row.name);
if (applied.length === 12) {
  if (existing.length !== 3) throw new Error('Triggers 012 TEST incompletos.');
  console.log('Migraciones 001–012 verificadas únicamente en Turso TEST.');
  process.exit(0);
}
if (existing.length) throw new Error('Triggers 012 parciales antes de aplicar.');
const name = names[11], sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const statements = sql.replace(/^\s*--[^\r\n]*/gm, '').split(/(?=CREATE TRIGGER)/g)
  .map((part) => part.trim()).filter(Boolean).map((statement) => ({ sql: statement, args: [] }));
if (statements.length !== 3 || statements.some((item) => !item.sql.endsWith('END;'))) {
  throw new Error('Migración 012 inesperada.');
}
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
await db.batch([...statements, { sql: `INSERT INTO altaria_schema_migrations
  (name,sha256,applied_at) VALUES (?,?,?)`, args: [name,hashes[11].sha256,new Date().toISOString()] }], 'immediate');
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const foreignKeys = await db.all('PRAGMA foreign_key_check');
if (foreignKeys.length) throw new Error('Integridad referencial TEST incorrecta.');
console.log('Migración 012 aplicada únicamente en Turso TEST; marcador, hash y referencias verificados.');
