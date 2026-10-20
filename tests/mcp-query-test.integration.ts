import {describe,expect,it} from 'vitest';
import {connect,type Connection} from '@tursodatabase/serverless';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from '../scripts/lib/test-isolation.mjs';
import {runReadTool} from '../src/lib/admin/mcp/reads';
import type {AdminPrincipal} from '../src/lib/admin/access';

describe('Consultas MCP solo sobre esquema Turso TEST',()=>{
  it('planifica SQL de seguimiento, propuestas, Cards y ambas fechas sin leer filas',async()=>{
    expect(process.env.ALTARIA_MCP_QUERY_TEST).toBe('1');
    const t=readProjectEnv('.env.test'),p=readProjectEnv('.env');
    if(!t?.TURSO_DATABASE_URL||!t.TURSO_AUTH_TOKEN||!t.ALTARIA_TEST_DB_MARKER)
      throw new Error('Falta TEST.');
    assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
      approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:p as never});
    assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
      webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:p as never});
    assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
      redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,
      productionEnv:p as never});
    const exp=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1]??'',
      'base64url').toString()).exp;
    expect(exp*1000).toBeGreaterThan(Date.now());
    const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
    await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
    Object.assign(process.env,{ALTARIA_TEST_ISOLATED:'1',
      ALTARIA_TEST_DB_MARKER:t.ALTARIA_TEST_DB_MARKER,
      ALTARIA_TEST_TURSO_URL:t.ALTARIA_TEST_TURSO_URL,
      TURSO_DATABASE_URL:t.TURSO_DATABASE_URL,STRIPE_MODE:'test',
      STRIPE_SECRET_KEY:t.STRIPE_SECRET_KEY});
    const principal:AdminPrincipal={id:'11111111-1111-4111-8111-111111111111',
      email:'synthetic@example.test',displayName:'Synthetic',roles:['owner'],
      sessionHash:'synthetic'};
    let planned=0;
    const schemaOnly={get:db.get.bind(db),
      all:async(sql:string,args:unknown[])=>{
        await db.all(`EXPLAIN QUERY PLAN ${sql}`,args as never);
        planned++;return [];
      }} as unknown as Connection;
    await runReadTool('crm_followups_needed',principal,{limit:10},schemaOnly);
    await runReadTool('crm_list_pending_proposals',principal,{limit:10},schemaOnly);
    await runReadTool('cards_needing_production',principal,{limit:10},schemaOnly);
    await runReadTool('content_calendar',principal,{from:'2026-10-12',to:'2026-10-18',
      dateKind:'editorial_due'},schemaOnly);
    await runReadTool('content_calendar',principal,{from:'2026-10-12',to:'2026-10-18',
      dateKind:'publication_scheduled'},schemaOnly);
    expect(planned).toBe(5);
  });
});
