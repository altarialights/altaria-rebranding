// Append-only Phase 7 migration. Never connects to an unmarked or existing production database.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {connect} from '@tursodatabase/serverless';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from './lib/test-isolation.mjs';

if(!process.argv.includes('--apply-test')||process.env.CI||process.env.VERCEL||process.env.VERCEL_ENV)
  throw new Error('Se requiere --apply-test desde el entorno local.');
const t=readProjectEnv('.env.test'),p=readProjectEnv('.env');
if(!t)throw new Error('Falta .env.test.');
assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
  approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:p});
assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
  webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:p});
assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
  redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,productionEnv:p});
const exp=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1]??'','base64url').toString()).exp;
if(!Number.isFinite(exp)||exp*1000<=Date.now())throw new Error('Token Turso TEST caducado.');
const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
const files=readdirSync('migrations').filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();
if(files.length!==22||files.some((name,i)=>Number(name.slice(0,3))!==i+1)
  ||files[21]!=='022_altaria_os_mcp_private.sql')throw new Error('Manifiesto inesperado.');
const hashes=files.map(name=>createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex'));
const current=await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
if(current.length<21||current.length>22)throw new Error('Historial TEST inesperado.');
for(let i=0;i<current.length;i++)if(current[i].name!==files[i]||current[i].sha256!==hashes[i])
  throw new Error(`Hash o nombre TEST incorrecto: ${files[i]}`);
if(current.length===21){
  const sql=readFileSync(`migrations/${files[21]}`,'utf8').replace(/^\s*--[^\r\n]*$/gm,'').trim();
  const statements=sql.split(/(?=^CREATE (?:TABLE|INDEX|TRIGGER)\b)/gm)
    .map(x=>x.trim()).filter(Boolean);
  if(statements.length!==9||statements.some(x=>!/^CREATE (?:TABLE|INDEX|TRIGGER)\b/.test(x)
    ||!x.endsWith(';')))throw new Error('SQL de migración inesperado.');
  await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  await db.batch([...statements.map(sql=>({sql,args:[]})),
    {sql:'INSERT INTO altaria_schema_migrations(name,sha256,applied_at) VALUES(?,?,?)',
      args:[files[21],hashes[21],new Date().toISOString()]}],'immediate');
  console.log('Migración 022 aplicada en Turso TEST.');
}
await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
if((await db.all('PRAGMA foreign_key_check')).length)throw new Error('FK TEST incorrectas.');
console.log('001–022, hashes y marcador TEST verificados; producción sin acceso.');
