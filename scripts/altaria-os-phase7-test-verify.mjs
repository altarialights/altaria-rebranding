// Synthetic Phase 7 schema verification in one Turso TEST transaction, always rolled back.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {connect} from '@tursodatabase/serverless';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from './lib/test-isolation.mjs';

if(!process.argv.includes('--apply-test')||process.env.CI||process.env.VERCEL||process.env.VERCEL_ENV)
  throw new Error('Se requiere --apply-test en entorno local.');
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
const name='022_altaria_os_mcp_private.sql';
const sha=createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex');
const migration=await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',[name]);
assert.equal(migration?.sha256,sha,'Migración 022 íntegra en TEST');
const tables=['os_mcp_access_grants','os_mcp_action_requests','os_mcp_action_events',
  'os_mcp_rate_windows'];
const before=await Promise.all(tables.map(async table=>Number((await db.get(
  `SELECT count(*) AS n FROM ${table}`)).n)));
const rollback=new Error('ROLLBACK_SYNTHETIC_MCP_TEST');
let rejected=0;
try{
  await db.transactionAsync(async tx=>{
    const at=new Date().toISOString(),user=randomUUID(),request=randomUUID();
    const expectReject=async(sql,args)=>{
      try{await tx.run(sql,args);}catch{rejected++;return;}
      throw new Error('Una restricción MCP aceptó escritura inválida.');
    };
    await tx.run(`INSERT INTO altaria_admin_users
      (id,email,workos_user_id,display_name,status,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?)`,[user,`mcp-${user}@example.test`,
      `user_synthetic_${user.replaceAll('-','')}`,'Persona sintética',at,at]);
    await tx.run(`INSERT INTO os_mcp_access_grants
      (user_id,can_read,can_prepare,granted_by,granted_at)
      VALUES (?,?,?,?,?)`,[user,1,0,user,at]);
    const json=JSON.stringify({tool:'sales_prepare_candidate',synthetic:true});
    const digest=createHash('sha256').update(json).digest('hex');
    const expiry=new Date(Date.now()+60*60_000).toISOString();
    await tx.run(`INSERT INTO os_mcp_action_requests
      (id,requester_user_id,tool_key,idempotency_key,request_json,request_sha256,
      resource_type,resource_id,resource_version,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[request,user,'sales_prepare_candidate','synthetic_key_1',
      json,digest,'sales_library','sales_library','1',at,expiry]);
    await tx.run(`INSERT INTO os_mcp_action_events
      (id,request_id,action,actor_user_id,occurred_at) VALUES (?,?,?,?,?)`,
      [randomUUID(),request,'requested',user,at]);
    await expectReject(`INSERT INTO os_mcp_action_requests
      (id,requester_user_id,tool_key,idempotency_key,request_json,request_sha256,
      resource_type,resource_id,resource_version,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[randomUUID(),user,'sales_prepare_candidate',
      'synthetic_key_1',json,digest,'sales_library','sales_library','1',at,expiry]);
    await expectReject('UPDATE os_mcp_action_events SET action=? WHERE request_id=?',
      ['approved',request]);
    await expectReject('DELETE FROM os_mcp_action_events WHERE request_id=?',[request]);
    await expectReject('UPDATE os_mcp_action_requests SET status=? WHERE id=?',
      ['sent_email',request]);
    await tx.run(`INSERT INTO os_mcp_rate_windows(user_id,window_start,kind,call_count)
      VALUES (?,?,?,?)`,[user,at,'read',60]);
    await expectReject(`INSERT INTO os_mcp_rate_windows(user_id,window_start,kind,call_count)
      VALUES (?,?,?,?)`,[user,at,'send',1]);
    throw rollback;
  }).immediate();
}catch(error){if(error!==rollback)throw error;}
assert.equal(rejected,5,'Cinco restricciones MCP rechazaron escrituras inválidas');
const after=await Promise.all(tables.map(async table=>Number((await db.get(
  `SELECT count(*) AS n FROM ${table}`)).n)));
assert.deepEqual(after,before,'Sin cambios tras rollback');
await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
console.log('MCP TEST: 5 restricciones, integridad 022 y rollback sintético verificados.');
