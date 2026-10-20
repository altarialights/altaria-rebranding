// Herramienta interna. Ejecutar con credenciales Turso de la base deseada; nunca en navegador.
// node --env-file=.env.test scripts/export-card-artwork.mjs order UUID /ruta/privada/original.png
import { connect } from '@tursodatabase/serverless';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { assertRemoteTestMarker, assertTestDatabase, assertTestMarkerFormat, readProjectEnv } from './lib/test-isolation.mjs';
const [kind,id,destination]=process.argv.slice(2);
if(!['order','inquiry'].includes(kind)||!id||!destination)throw new Error('Uso: export-card-artwork.mjs order|inquiry ID ARCHIVO_DESTINO');
for (const folder of ['public', 'dist', '.vercel']) {
 const path = relative(resolve(folder), resolve(destination));
 if (!path || (!path.startsWith('..') && !isAbsolute(path))) throw new Error('El destino debe estar fuera de los directorios publicados.');
}
const test=readProjectEnv('.env.test'),production=readProjectEnv('.env');
if(!test)throw new Error('Falta .env.test. Esta herramienta sólo admite la base TEST aislada.');
assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production});
assertTestMarkerFormat(test.ALTARIA_TEST_DB_MARKER);
const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const column=kind==='order'?'order_id':'inquiry_id';
const rows=await db.all(`SELECT filename, content_base64, sha256, width, height, validation_status FROM card_artwork WHERE ${column} = ?`,id);
if(rows.length!==1)throw new Error('Se esperaba exactamente un diseño asociado. Comprueba el ID interno.');
const row=rows[0],bytes=Buffer.from(row.content_base64,'base64');
if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new Error('El original no supera la comprobación de integridad.');
await writeFile(destination,bytes,{flag:'wx',mode:0o600});
console.log(`Original exportado sin modificaciones: ${row.width} x ${row.height}; estado ${row.validation_status}.`);
