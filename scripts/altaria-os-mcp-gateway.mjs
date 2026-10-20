// Local-only transport. Starting it requires a separately authorized TEST activation.
import {connect} from '@tursodatabase/serverless';
import {isIP} from 'node:net';
import {createMcpGateway,MCP_GATEWAY_HOST,MCP_GATEWAY_PORT} from './lib/mcp-local-gateway.mjs';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from './lib/test-isolation.mjs';

const test=readProjectEnv('.env.test'),production=readProjectEnv('.env');
if(!test||test.ALTARIA_MCP_ENABLED!=='1'||process.env.CI||process.env.VERCEL
  ||process.env.VERCEL_ENV)throw new Error('MCP TEST no autorizado o no configurado.');
assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
  approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production});
assertTestStripe({mode:test.STRIPE_MODE,secretKey:test.STRIPE_SECRET_KEY,
  webhookSecret:test.STRIPE_WEBHOOK_SECRET,productionEnv:production});
assertStagingWorkOS({clientId:test.WORKOS_CLIENT_ID,apiKey:test.WORKOS_API_KEY,
  redirectUri:test.WORKOS_REDIRECT_URI,cookiePassword:test.WORKOS_COOKIE_PASSWORD,
  productionEnv:production});
if(test.ALTARIA_MCP_ASTRO_ORIGIN!=='http://127.0.0.1:4321'
  ||test.ALTARIA_MCP_TRANSPORT_URL!=='http://127.0.0.1:4331/mcp'
  ||!test.ALTARIA_MCP_RESOURCE?.startsWith('https://')
  ||test.ALTARIA_MCP_OAUTH_AUDIENCE!==test.ALTARIA_MCP_RESOURCE
  ||new URL(test.ALTARIA_MCP_RESOURCE).hostname!==test.ALTARIA_MCP_RESOURCE_HOST
  ||new URL(test.ALTARIA_MCP_RESOURCE).pathname!=='/mcp'
  ||new URL(test.ALTARIA_MCP_RESOURCE).hostname==='localhost'
  ||isIP(new URL(test.ALTARIA_MCP_RESOURCE).hostname.replace(/^\[|\]$/g,''))!==0
  ||new URL(test.ALTARIA_MCP_RESOURCE).hostname==='altarialights.com'
  ||new URL(test.ALTARIA_MCP_RESOURCE).hostname.endsWith('.altarialights.com')
  ||new URL(test.ALTARIA_MCP_RESOURCE).hostname.endsWith('.vercel.app'))
  throw new Error('Identidad de transporte o recurso TEST incorrecta.');
const exp=JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1]??'',
  'base64url').toString()).exp;
if(!Number.isFinite(exp)||exp*1000<=Date.now())throw new Error('Token TEST caducado.');
const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const server=createMcpGateway();
server.listen(MCP_GATEWAY_PORT,MCP_GATEWAY_HOST,()=>{
  console.log(`Pasarela MCP TEST local en ${MCP_GATEWAY_HOST}:${MCP_GATEWAY_PORT}`);
});
