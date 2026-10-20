// Idempotent new editorial proposals. Never imports production material.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {connect} from '@tursodatabase/serverless';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from './lib/test-isolation.mjs';
if(!process.argv.includes('--apply-test')||process.env.CI||process.env.VERCEL||process.env.VERCEL_ENV)
  throw new Error('Se requiere --apply-test local.');
const t=readProjectEnv('.env.test'),p=readProjectEnv('.env');if(!t)throw new Error('Falta .env.test.');
assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
  approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:p});
assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
  webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:p});
assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
  redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,productionEnv:p});
const payload=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1]??'','base64url').toString());
if(!Number.isFinite(payload.exp)||payload.exp*1000<=Date.now())throw new Error('Token TEST caducado.');
const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
const expected=createHash('sha256').update(readFileSync('migrations/018_altaria_os_sales.sql')).digest('hex');
const migration=await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',['018_altaria_os_sales.sql']);
if(migration?.sha256!==expected)throw new Error('Migración 018 ausente o alterada en TEST.');
const owner=await db.get(`SELECT u.id FROM altaria_admin_users u JOIN altaria_admin_user_roles r
  ON r.user_id=u.id WHERE u.email=? AND u.status='active' AND u.workos_user_id IS NOT NULL
  AND r.role_key='owner'`,[t.ALTARIA_TEST_OWNER_EMAIL?.trim().toLowerCase()??'']);
if(!owner)throw new Error('No hay propietario WorkOS TEST autorizado.');
const source=readFileSync('src/lib/admin/sales/initial-content.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,
  target:ts.ScriptTarget.ES2022}}).outputText;
const {initialSalesContent}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let inserted=0;
for(const {key,input} of initialSalesContent){
  if(!/^[a-z0-9-]{3,80}$/.test(key))throw new Error('Clave de contenido no válida.');
  const existing=await db.get('SELECT id FROM crm_sales_entries WHERE seed_key=?',[key]);
  if(existing)continue;
  if(!input.title||!input.body||!input.nextStep)throw new Error('Propuesta editorial incompleta.');
  const id=randomUUID(),versionId=randomUUID(),eventId=randomUUID(),auditId=randomUUID(),date=new Date().toISOString();
  const sha=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  await db.batch([{sql:`INSERT INTO crm_sales_entries(id,seed_key,title,category,product,sector,channel,stage,status,latest_version,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'review',1,?,?,?)`,args:[id,key,input.title,input.category,input.product,input.sector,input.channel,input.stage,owner.id,date,date]},
  {sql:`INSERT INTO crm_sales_entry_versions(id,entry_id,version,title,category,product,sector,channel,stage,body,next_step,sha256,provenance,source_ref,created_by,created_at)
    VALUES(?,?,1,?,?,?,?,?,?,?,?,?,'new_proposal',?,?,?)`,args:[versionId,id,input.title,input.category,input.product,input.sector,input.channel,input.stage,input.body,input.nextStep,sha,`phase6.5b:initial:${key}`,owner.id,date]},
  {sql:`INSERT INTO crm_sales_entry_events(id,entry_id,version,kind,actor_user_id,occurred_at)
    VALUES(?,?,1,'created',?,?)`,args:[eventId,id,owner.id,date]},
  {sql:`INSERT INTO altaria_admin_audit_events(id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES(?,?,?,NULL,'sales.entry.seed','sales_entry',?,'success','{}')`,args:[auditId,date,owner.id,id]}],'immediate');
  inserted++;
}
await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
const result=await db.get(`SELECT COUNT(*) AS total,
  SUM(CASE WHEN status='review' AND approved_version IS NULL THEN 1 ELSE 0 END) AS pending
  FROM crm_sales_entries WHERE seed_key IS NOT NULL`);
console.log(JSON.stringify({inserted,total:Number(result?.total??0),pending:Number(result?.pending??0),
  markerVerified:true,productionTouched:false}));
