// HTTP benchmark against local TEST only; fetch never follows the external destination.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--run-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --run-test en local.');
}
const test=readProjectEnv('.env.test'),production=readProjectEnv('.env');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
  approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production});
assertTestStripe({mode:test.STRIPE_MODE,secretKey:test.STRIPE_SECRET_KEY,
  webhookSecret:test.STRIPE_WEBHOOK_SECRET,productionEnv:production});
assertStagingWorkOS({clientId:test.WORKOS_CLIENT_ID,apiKey:test.WORKOS_API_KEY,
  redirectUri:test.WORKOS_REDIRECT_URI,cookiePassword:test.WORKOS_COOKIE_PASSWORD,productionEnv:production});
const token=JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1]??'','base64url').toString());
if (!Number.isFinite(token.exp) || token.exp*1000<=Date.now()) throw new Error('Token Turso TEST caducado.');
const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const fixture=JSON.parse(readFileSync('review/altaria-os/phase5/qa-fixture.json','utf8'));
const link=fixture.links.find(item=>item.channel==='qr');
if (!link || !/^[A-Za-z0-9_-]{32}$/.test(link.code)) throw new Error('Fixture inesperado.');
const row=await db.get(`SELECT p.negocio_nombre,l.public_code,t.url FROM cards_dynamic_links l
  JOIN pedidos_tarjetas p ON p.id=l.order_id
  JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
  WHERE l.id=? AND l.order_id=? AND p.stripe_entorno='test'`,[link.id,fixture.orderId]);
if (!row || row.public_code!==link.code || !String(row.negocio_nombre).startsWith('QA SINTÉTICO')) {
  throw new Error('Fixture TEST no identificado.');
}
const base='http://127.0.0.1:4321';
const before=Number((await db.get(`SELECT count(*) AS n FROM cards_open_events
  WHERE link_id=? AND target_revision IS NOT NULL`,[link.id]))?.n??0);
const one=async()=>{
  const start=performance.now();
  const response=await fetch(`${base}/c/${link.code}`,{redirect:'manual'});
  const elapsed=performance.now()-start;
  if (response.status!==302 || response.headers.get('location')!==row.url
    || !response.headers.get('cache-control')?.includes('no-store')
    || response.headers.get('referrer-policy')!=='no-referrer') throw new Error('Redirección local incorrecta.');
  return elapsed;
};
await one();
const timings=[];
for(let i=0;i<40;i++)timings.push(await one());
const concurrent=[];
for(let i=0;i<30;i+=5)concurrent.push(...await Promise.all(Array.from({length:5},()=>one())));
const unknown=await fetch(`${base}/c/${'A'.repeat(32)}`,{redirect:'manual'});
const invalid=await fetch(`${base}/c/invalid`,{redirect:'manual'});
if (unknown.status!==404 || invalid.status!==404 || await unknown.text()!==await invalid.text()) {
  throw new Error('Respuesta de códigos desconocidos inconsistente.');
}
await new Promise(resolve=>setTimeout(resolve,1000));
const versioned=await db.get(`SELECT count(*) AS n FROM cards_open_events
  WHERE link_id=? AND target_revision IS NOT NULL`,[link.id]);
const recorded=Number(versioned?.n??0)-before;
if (recorded<1) throw new Error('La analítica versionada TEST no registró la carga sintética.');
timings.sort((a,b)=>a-b);
concurrent.sort((a,b)=>a-b);
const report={requests:timings.length,p50Ms:+timings[19].toFixed(1),
  p95Ms:+timings[37].toFixed(1),maxMs:+timings.at(-1).toFixed(1),
  concurrentRequests:concurrent.length,concurrency:5,concurrentP95Ms:+concurrent[28].toFixed(1),
  concurrentMaxMs:+concurrent.at(-1).toFixed(1),versionedEventsRecorded:recorded,
  temporary:true,noStore:true,unknown404:true,environment:'local TEST',
  note:'Desde este equipo; incluye Turso TEST remoto. No mide una red pública.'};
writeFileSync('review/altaria-os/phase5/redirect-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
