// Append-only trigger migration; never targets anything except the marker-verified TEST DB.
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
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('Token TEST caducado.');
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const names = ['001_create_digital_assessment.sql', '002_create_card_orders.sql',
  '003_add_card_order_stripe_environment.sql', '004_altaria_cards_catalog_and_inquiries.sql',
  '005_card_artwork.sql', '006_card_artwork_3mb.sql', '007_altaria_os_identity.sql',
  '008_altaria_os_crm.sql', '009_altaria_os_proposals_gmail.sql',
  '010_altaria_os_proposal_immutability.sql'];
const hashes = names.map((name) => ({ name, sha256: createHash('sha256').update(
  readFileSync(new URL(`../migrations/${name}`, import.meta.url))).digest('hex') }));
const applied = await db.all('SELECT name, sha256 FROM altaria_schema_migrations ORDER BY name');
if (![9, 10].includes(applied.length)) throw new Error('Historial TEST inesperado.');
for (const item of hashes.slice(0, applied.length)) {
  if (!applied.some((row) => row.name === item.name && row.sha256 === item.sha256)) {
    throw new Error(`Hash o migración TEST no válida: ${item.name}`);
  }
}
const triggerNames = ['crm_proposal_versions_no_update', 'crm_proposal_versions_no_delete',
  'crm_proposal_version_items_no_update', 'crm_proposal_version_items_no_delete',
  'crm_proposal_events_no_update', 'crm_proposal_events_no_delete'];
const existing = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'trigger'
  AND name LIKE 'crm_proposal_%' ORDER BY name`)).map((row) => row.name);
if (applied.length === 10) {
  if (JSON.stringify(existing) !== JSON.stringify([...triggerNames].sort())) {
    throw new Error('Triggers TEST 010 inesperados.');
  }
  console.log('Migraciones 001–010 y triggers de inmutabilidad verificados únicamente en TEST.');
  process.exit(0);
}
if (existing.length) throw new Error('Existen triggers parciales antes de 010.');
const name = names[9]; const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const statements = sql.replace(/^\s*--[^\r\n]*/gm, '').split(/END;/i).map((part) => part.trim())
  .filter(Boolean).map((part) => ({ sql: `${part} END;`, args: [] }));
if (statements.length !== 6) throw new Error('Número de triggers inesperado.');
await db.batch([...statements, { sql: `INSERT INTO altaria_schema_migrations
  (name, sha256, applied_at) VALUES (?, ?, ?)`,
args: [name, hashes[9].sha256, new Date().toISOString()] }], 'immediate');
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const after = (await db.all(`SELECT name FROM sqlite_master WHERE type = 'trigger'
  AND name LIKE 'crm_proposal_%' ORDER BY name`)).map((row) => row.name);
if (JSON.stringify(after) !== JSON.stringify([...triggerNames].sort())) throw new Error('Triggers TEST incompletos.');
console.log('Migración 010 aplicada únicamente en Turso TEST; marcador y triggers verificados.');
