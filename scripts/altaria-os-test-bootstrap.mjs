// One-time bootstrap for a newly created, EMPTY Turso TEST database.
// Never run this until the separate external resource has been authorized.
import { connect } from '@tursodatabase/serverless';
import { assertTestDatabase, assertTestMarkerFormat, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--initialize-empty-test-db')) {
  throw new Error('Falta --initialize-empty-test-db; no se ha conectado a Turso.');
}
const production = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({
  targetUrl: test.TURSO_DATABASE_URL,
  token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL,
  productionEnv: production,
});
assertTestMarkerFormat(test.ALTARIA_TEST_DB_MARKER);
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
const existing = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
if (existing.length !== 0) throw new Error('La base TEST no está vacía; no se inicializa.');
await db.batch([
  { sql: 'CREATE TABLE altaria_test_environment (id TEXT PRIMARY KEY CHECK (id = \'test\'), marker TEXT NOT NULL)', args: [] },
  { sql: 'INSERT INTO altaria_test_environment (id, marker) VALUES (?, ?)', args: ['test', test.ALTARIA_TEST_DB_MARKER] },
], 'immediate');
console.log('Marcador TEST creado en una base vacía. No se han aplicado migraciones de producto.');
