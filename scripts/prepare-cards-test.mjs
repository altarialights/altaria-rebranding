// Preflight de SOLO LECTURA por defecto. Requiere destino TEST explícito.
// No usa TURSO_DATABASE_URL ni carga .env automáticamente.
import { connect } from '@tursodatabase/serverless';
import { readFile } from 'node:fs/promises';
import { assertRemoteTestMarker, assertTestDatabase, assertTestMarkerFormat, readProjectEnv } from './lib/test-isolation.mjs';
const test=readProjectEnv('.env.test'), production=readProjectEnv('.env');
if(!test)throw new Error('Falta .env.test. No se conecta a Turso.');
const target=test.TURSO_DATABASE_URL, token=test.TURSO_AUTH_TOKEN;
assertTestDatabase({targetUrl:target,token,approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production});
const expected=process.argv.find(arg=>arg.startsWith('--expected-url='))?.slice(15);
if(expected!==target)throw new Error('Indica --expected-url con la URL exacta de la base TEST aprobada.');
assertTestMarkerFormat(test.ALTARIA_TEST_DB_MARKER);
const db=connect({url:target,authToken:token});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const cols=await db.all('PRAGMA table_info(pedidos_tarjetas)');
if(!cols.some(c=>c.name==='stripe_entorno'))throw new Error('Se requieren migraciones 002 y 003 previamente aplicadas.');
const tables=await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('consultas_tarjetas','card_artwork')");
if(cols.some(c=>['producto_id','producto_nombre','personalizacion_json'].includes(c.name))||tables.length)throw new Error('004/005 ya existen o hay un estado parcial. Detener y revisar; no reejecutar a ciegas.');
const paths=['migrations/004_altaria_cards_catalog_and_inquiries.sql','migrations/005_card_artwork.sql'];
const statements=[];
for(const path of paths){const sql=await readFile(path,'utf8');statements.push(...sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(sql=>({sql,args:[]})));}
console.log('Preflight correcto: 004 -> 005, ambas pendientes; sin cambios ejecutados.');
if(process.argv.includes('--apply')){
 if(!process.argv.includes('--backup-confirmed'))throw new Error('Crea y verifica una copia de TEST y añade --backup-confirmed.');
 await db.batch(statements,'immediate');
 console.log('004 y 005 aplicadas juntas en una transacción a la base TEST explícita.');
}
