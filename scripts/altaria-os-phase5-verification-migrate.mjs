// Applies 015 only to the approved, marked Turso TEST database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';
if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en entorno local.');
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
const names=['001_create_digital_assessment.sql','002_create_card_orders.sql',
  '003_add_card_order_stripe_environment.sql','004_altaria_cards_catalog_and_inquiries.sql',
  '005_card_artwork.sql','006_card_artwork_3mb.sql','007_altaria_os_identity.sql',
  '008_altaria_os_crm.sql','009_altaria_os_proposals_gmail.sql',
  '010_altaria_os_proposal_immutability.sql','011_altaria_os_cards_production.sql',
  '012_altaria_os_cards_payment_guards.sql','013_altaria_os_cards_dynamic_links.sql',
  '014_altaria_os_cards_link_replacements.sql','015_altaria_os_cards_link_verification.sql',
  '016_altaria_os_cards_destination_analytics.sql'];
const hashes=names.map(name=>({name,sha256:createHash('sha256').update(
  readFileSync(new URL(`../migrations/${name}`,import.meta.url))).digest('hex')}));
const applied=await db.all('SELECT name,sha256 FROM altaria_schema_migrations ORDER BY name');
if (![14,15,16].includes(applied.length)) throw new Error('Historial TEST inesperado.');
for(let i=0;i<applied.length;i++)if(applied[i].name!==hashes[i].name||applied[i].sha256!==hashes[i].sha256) {
  throw new Error(`Migración TEST ausente o alterada: ${hashes[i].name}`);
}
if(applied.length>=15){console.log(`Migraciones 001–${String(applied.length).padStart(3,'0')} verificadas únicamente en Turso TEST.`);process.exit(0);}
const name=names[14],sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');
const triggers=sql.slice(sql.indexOf('CREATE TRIGGER')).split(/(?=CREATE TRIGGER)/g)
  .map(s=>s.trim()).filter(Boolean).map(s=>({sql:s,args:[]}));
if(triggers.length!==2||triggers.some(t=>!t.sql.endsWith('END;'))) throw new Error('Manifiesto 015 inesperado.');
const conflict=await db.all(`SELECT name FROM sqlite_master WHERE name IN ('cards_checks_links_guard','cards_ship_links_guard')`);
if(conflict.length)throw new Error('Estructura 015 inesperada.');
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
await db.batch([...triggers,{sql:`INSERT INTO altaria_schema_migrations
  (name,sha256,applied_at) VALUES (?,?,?)`,args:[name,hashes[14].sha256,new Date().toISOString()]}],'immediate');
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
if((await db.all('PRAGMA foreign_key_check')).length)throw new Error('Integridad referencial TEST incorrecta.');
console.log('Migración 015 aplicada únicamente en Turso TEST; marcador, hash y referencias verificados.');
