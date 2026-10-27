import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect } from '@tursodatabase/serverless';
import { readProjectEnv, tursoHost } from './lib/test-isolation.mjs';

const expected = 'altaria-digital-index-altarialights.aws-eu-west-1.turso.io';
const env = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!env?.TURSO_AUTH_TOKEN || tursoHost(env.TURSO_DATABASE_URL) !== expected
  || tursoHost(test.TURSO_DATABASE_URL) === expected || test.TURSO_AUTH_TOKEN === env.TURSO_AUTH_TOKEN) throw new Error('Production identity check failed.');
const db = connect({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN});
const schema = await db.all('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name');
if (schema.some(r=>r.name === 'altaria_test_environment')) throw new Error('Unexpected TEST marker in production.');
for (const name of ['pedidos_tarjetas','eventos_pedido']) if (!schema.some(r=>r.name === name)) throw new Error('Expected production table missing.');
const ledger = schema.some(r=>r.name === 'meeting_schema_migrations');
const migrations = [];
for (const file of ['023_meeting_bookings.sql','024_meeting_management.sql']) {
  const sql = readFileSync(`migrations/${file}`,'utf8');
  const version = file.slice(0,3), hash = createHash('sha256').update(sql).digest('hex');
  const prior = ledger && await db.get('SELECT sha256 FROM meeting_schema_migrations WHERE version=?',version);
  if (prior && prior.sha256 !== hash) throw new Error('Applied migration hash mismatch.');
  if (!prior) migrations.push({version,hash,statements:sql.replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g).map(s=>s.trim())});
}
if (migrations.some(m=>m.version==='023') && schema.some(r=>['meeting_bookings','meeting_rate_limits'].includes(r.name))) throw new Error('Partial migration state.');
console.log(JSON.stringify({host:expected,tables:schema.filter(r=>r.type==='table').map(r=>r.name),pending:migrations.map(m=>m.version)}));
if (!process.argv.includes('--apply-production') || !migrations.length) process.exit(0);
if (!process.argv.includes(`--expected-host=${expected}`)) throw new Error('Explicit production host required.');

// A consistent logical backup, including blobs, stored only in the ignored private review directory.
const tables = schema.filter(r=>r.type==='table');
const quote = name => '"'+name.replaceAll('"','""')+'"';
const snapshot = await db.batch(tables.map(r=>`SELECT * FROM ${quote(r.name)}`),'deferred');
const folder = 'review/migrations-production'; mkdirSync(folder,{recursive:true});
const file = `${folder}/meetings-before-${Date.now()}.json`;
const backup = JSON.stringify({host:expected,createdAt:new Date().toISOString(),schema,tables:tables.map((r,i)=>({name:r.name,result:snapshot[i]}))},(_key,value)=>
  typeof value === 'bigint' ? {$bigint:String(value)} : value instanceof Uint8Array ? {$blob:Buffer.from(value).toString('base64')} : value);
writeFileSync(file,backup,{encoding:'utf8',flag:'wx',mode:0o600});
if (readFileSync(file,'utf8') !== backup) throw new Error('Backup verification failed.');
const timestamp = new Date().toISOString();
await db.batch([
  'CREATE TABLE IF NOT EXISTS meeting_schema_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)',
  ...migrations.flatMap(m=>[...m.statements,{sql:'INSERT INTO meeting_schema_migrations VALUES (?,?,?)',args:[m.version,m.hash,timestamp]}]),
],'immediate');
const after = await db.all('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name');
for (const original of schema) {
  if (!after.some(r=>r.type===original.type && r.name===original.name && r.sql===original.sql)) throw new Error('Existing schema changed unexpectedly.');
}
const integrity = await db.all('PRAGMA quick_check');
if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('Integrity check failed.');
const columns = await db.all('PRAGMA table_info(meeting_bookings)');
for (const name of ['calendar_url','cancel_requested_at','cancelled_at','telegram_edit_pending']) if (!columns.some(r=>r.name===name)) throw new Error('Management column missing.');
console.log(JSON.stringify({applied:migrations.map(m=>m.version),backup:file,backupSha256:createHash('sha256').update(backup).digest('hex'),integrity:'ok',existingSchemaUnchanged:true}));
