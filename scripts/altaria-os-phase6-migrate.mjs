// Applies only 017 to the approved, marker-verified Turso TEST database.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en el entorno local.');
}
const test=readProjectEnv('.env.test'),production=readProjectEnv('.env');
if(!test) throw new Error('Falta .env.test.');
assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
  approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production});
assertTestStripe({mode:test.STRIPE_MODE,secretKey:test.STRIPE_SECRET_KEY,
  webhookSecret:test.STRIPE_WEBHOOK_SECRET,productionEnv:production});
assertStagingWorkOS({clientId:test.WORKOS_CLIENT_ID,apiKey:test.WORKOS_API_KEY,
  redirectUri:test.WORKOS_REDIRECT_URI,cookiePassword:test.WORKOS_COOKIE_PASSWORD,
  productionEnv:production});
const token=JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1]??'','base64url').toString());
if(!Number.isFinite(token.exp)||token.exp*1000<=Date.now()) throw new Error('Token Turso TEST caducado.');
const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const names=readdirSync('migrations').filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();
if(names.length!==17||names.some((name,index)=>Number(name.slice(0,3))!==index+1)
  ||names[16]!=='017_altaria_os_automations.sql') throw new Error('Manifiesto de migraciones inesperado.');
const hashes=names.map(name=>createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex'));
const applied=await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
if(![16,17].includes(applied.length)) throw new Error('Historial remoto TEST inesperado.');
for(let i=0;i<applied.length;i++) if(applied[i].name!==names[i]||applied[i].sha256!==hashes[i]) {
  throw new Error(`Migración TEST ausente o alterada: ${names[i]}`);
}
if(applied.length===17) {
  console.log('Migraciones 001–017 verificadas únicamente en Turso TEST.');
  process.exit(0);
}
const sql=readFileSync('migrations/017_altaria_os_automations.sql','utf8')
  .replace(/^\s*--.*$/gm,'');
const statements=sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|DROP)\b)/)
  .map(part=>part.trim()).filter(Boolean).map(part=>({sql:part.endsWith(';')?part:`${part};`,args:[]}));
if(statements.length!==38||statements.filter(item=>item.sql.startsWith('CREATE TRIGGER')).length!==14
  ||statements.some(item=>!(/^(CREATE|INSERT|ALTER)\b/.test(item.sql)))) {
  throw new Error('Contenido de 017 inesperado.');
}
const conflicting=await db.all(`SELECT name FROM sqlite_master WHERE name IN
  ('os_rule_config','os_outbox','os_jobs','os_work_items','os_approvals')`);
if(conflicting.length) throw new Error('Estructura 017 parcial o inesperada.');
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
await db.batch([...statements,{sql:`INSERT INTO altaria_schema_migrations
  (name,sha256,applied_at) VALUES (?,?,?)`,args:[names[16],hashes[16],new Date().toISOString()]}],'immediate');
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
if((await db.all('PRAGMA foreign_key_check')).length) throw new Error('Integridad referencial TEST incorrecta.');
console.log('Migración 017 aplicada únicamente en Turso TEST; marcador, hash y referencias verificados.');
