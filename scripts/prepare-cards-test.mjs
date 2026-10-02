// Preflight de SOLO LECTURA por defecto. Requiere destino TEST explícito.
// No usa TURSO_DATABASE_URL ni carga .env automáticamente.
import { connect } from '@tursodatabase/serverless';
import { readFile } from 'node:fs/promises';
const target=process.env.CARDS_TEST_DATABASE_URL, token=process.env.CARDS_TEST_AUTH_TOKEN;
if(process.env.CARDS_DATABASE_ENV!=='test'||!target||!token)throw new Error('Configura CARDS_DATABASE_ENV=test, CARDS_TEST_DATABASE_URL y CARDS_TEST_AUTH_TOKEN.');
const expected=process.argv.find(arg=>arg.startsWith('--expected-url='))?.slice(15);
if(expected!==target)throw new Error('Indica --expected-url con la URL exacta de la base TEST aprobada.');
// Rechaza la base que usa el proyecto actualmente, aunque se etiquete por error como TEST.
const env=await readFile('.env','utf8').catch(()=>'');
const active=env.match(/^TURSO_DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
const databaseIdentity=value=>new URL(value).hostname.toLowerCase();
if(active&&databaseIdentity(target)===databaseIdentity(active))throw new Error('La base TEST coincide con la base activa del proyecto. No se permite aplicar.');
const db=connect({url:target,authToken:token});
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
