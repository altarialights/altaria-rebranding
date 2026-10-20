// Append-only 019–021, exclusively in marker-verified Turso TEST.
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
if(files.length!==21||files.some((name,i)=>Number(name.slice(0,3))!==i+1)
  ||files[18]!=='019_altaria_os_content_core.sql'
  ||files[19]!=='020_altaria_os_content_workflow.sql'
  ||files[20]!=='021_altaria_os_content_version_format.sql')throw new Error('Manifiesto inesperado.');
const hashes=files.map(name=>createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex'));
const current=await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
if(current.length<18||current.length>21)throw new Error('Historial TEST inesperado.');
for(let i=0;i<current.length;i++)if(current[i].name!==files[i]||current[i].sha256!==hashes[i])
  throw new Error(`Hash o nombre TEST incorrecto: ${files[i]}`);
for(let i=current.length;i<21;i++){
  await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  const sql=readFileSync(`migrations/${files[i]}`,'utf8').replace(/^\s*--[^\r\n]*$/gm,'');
  const statements=sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER)\b)/)
    .map(x=>x.trim()).filter(Boolean).map(x=>({sql:x.endsWith(';')?x:`${x};`,args:[]}));
  if(statements.length<(i===20?1:10)||statements.some(x=>!(/^(CREATE|INSERT|ALTER)\b/.test(x.sql))))
    throw new Error('SQL de migración inesperado.');
  await db.batch([...statements,{sql:'INSERT INTO altaria_schema_migrations(name,sha256,applied_at) VALUES(?,?,?)',
    args:[files[i],hashes[i],new Date().toISOString()]}],'immediate');
  await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  if((await db.all('PRAGMA foreign_key_check')).length)throw new Error('FK TEST incorrectas.');
  console.log(`Migración ${files[i].slice(0,3)} aplicada en Turso TEST.`);
}
console.log('001–021 y marcador TEST verificados; producción sin acceso.');
