import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {connect} from '@tursodatabase/serverless';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from './test-isolation.mjs';

// Read-only guard shared by the reproducible MCP TEST integration. No secret output.
export async function mcpTestPreflight(){
  assert(!process.env.CI&&!process.env.VERCEL&&!process.env.VERCEL_ENV,'Local TEST only');
  const t=readProjectEnv('.env.test'),p=readProjectEnv('.env');
  assert(t,'Missing TEST configuration');
  assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
    approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:p});
  assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
    webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:p});
  assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
    redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,productionEnv:p});
  assert(t.ALTARIA_MCP_ENABLED!=='1'&&process.env.ALTARIA_MCP_ENABLED!=='1','MCP must remain disabled');
  const exp=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1],'base64url')).exp;
  assert(Number.isFinite(exp)&&exp*1000>Date.now(),'TEST token expired');
  const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
  await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  const names=readdirSync('migrations').filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
  assert.equal(names.length,22,'Expected migrations 001–022');
  const rows=await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
  assert.deepEqual(rows.map(r=>r.name),names);
  for(const [index,n] of names.entries()){
    assert.equal(Number(n.slice(0,3)),index+1);
    assert.equal(rows[index].sha256,createHash('sha256').update(readFileSync(`migrations/${n}`)).digest('hex'));
  }
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
  const grants=await db.get('SELECT count(*) AS n FROM os_mcp_access_grants WHERE can_read=1 AND revoked_at IS NULL');
  assert.equal(Number(grants.n),0,'No persistent active MCP grants permitted');
  const report={database:'altaria-os-test',markerVerified:true,migrationsVerified:22,
    stripeMode:'test',workosCredentials:'staging',mcpEnabled:false,activeGrants:0,
    tokenExpiresAt:new Date(exp*1000).toISOString()};
  return {db,test:t,report};
}
