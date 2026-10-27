import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect } from '@tursodatabase/serverless';
import { assertTestDatabase, assertRemoteTestMarker, readProjectEnv } from './lib/test-isolation.mjs';

const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
const host = assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
  approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:readProjectEnv('.env')});
const db = connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
for (const [version,file] of [['023','023_meeting_bookings.sql'],['024','024_meeting_management.sql']]) {
const sql = readFileSync(`migrations/${file}`,'utf8');
const hash = createHash('sha256').update(sql).digest('hex');
const ledger = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='meeting_schema_migrations'");
if (ledger) {
  const prior = await db.get('SELECT sha256 FROM meeting_schema_migrations WHERE version = ?', version);
  if (prior) {
    if (prior.sha256 !== hash) throw new Error('La migración aplicada no coincide con su hash.');
    console.log(version,'ya aplicada y verificada en TEST:',host);continue;
  }
}
const existing = await db.all("SELECT name FROM sqlite_master WHERE name IN ('meeting_bookings','meeting_rate_limits')");
if(version === '023' && existing.length)throw new Error('Estado parcial: revisar antes de aplicar.');
console.log('Destino TEST verificado:',host,'; pendiente:',version);
if(process.argv.includes('--apply-test')) {
  const statements=sql.replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g).map(s=>s.trim());
  await db.batch([
    'CREATE TABLE IF NOT EXISTS meeting_schema_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)',
    ...statements,
    {sql:'INSERT INTO meeting_schema_migrations VALUES (?,?,?)',args:[version,hash,new Date().toISOString()]},
  ],'immediate');
  console.log(version,'aplicada en una transacción a TEST. Producción intacta.');
}
}
