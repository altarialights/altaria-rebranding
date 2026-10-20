// Temporary unpaid synthetic order for visual QA; cleanup targets only its exact ID.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

const action = process.argv[2];
if (!['--create-test','--remove-test'].includes(action) || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Usa --create-test o --remove-test en local.');
}
const test = readProjectEnv('.env.test'), production = readProjectEnv('.env');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl:test.TURSO_DATABASE_URL, token:test.TURSO_AUTH_TOKEN,
  approvedUrl:test.ALTARIA_TEST_TURSO_URL, productionEnv:production });
assertTestStripe({ mode:test.STRIPE_MODE, secretKey:test.STRIPE_SECRET_KEY,
  webhookSecret:test.STRIPE_WEBHOOK_SECRET, productionEnv:production });
assertStagingWorkOS({ clientId:test.WORKOS_CLIENT_ID, apiKey:test.WORKOS_API_KEY,
  redirectUri:test.WORKOS_REDIRECT_URI, cookiePassword:test.WORKOS_COOKIE_PASSWORD,
  productionEnv:production });
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp*1000 <= Date.now()) throw new Error('Token TEST caducado.');
const db = connect({ url:test.TURSO_DATABASE_URL, authToken:test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
const fixturePath=resolve('review/altaria-os/phase4/visual-fixture.json');
if (action === '--create-test') {
  if (existsSync(fixturePath)) throw new Error('Ya existe una ficha visual pendiente de retirar.');
  const id=randomUUID(), number=`QA-SINTETICO-${id.slice(0,8).toUpperCase()}`, at=new Date().toISOString();
  await db.run(`INSERT INTO pedidos_tarjetas
    (id,numero_pedido,clave_idempotencia,huella_solicitud,estado,google_place_id,
    negocio_nombre,negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,
    envio_centimos,total_centimos,cliente_nombre,cliente_email,cliente_telefono,
    envio_direccion,envio_codigo_postal,envio_ciudad,envio_provincia,stripe_entorno,
    creado_en,producto_id,producto_nombre,personalizacion_json)
    VALUES (?,?,?,?, 'pendiente_pago', ?,'NEGOCIO SINTÉTICO · NO ENVIAR','Calle Ficticia 1',
      4,1000,4000,0,4000,'Cliente de prueba','cliente@example.test','600000000',
      'Calle Ficticia 1','28001','Madrid','Madrid','test',?,'resenas',
      'Tarjetas de prueba','{}')`, [id,number,randomUUID(),createHash('sha256').update(id).digest('hex'),
      `synthetic_${id}`,at]);
  mkdirSync(resolve('review/altaria-os/phase4'),{recursive:true});
  writeFileSync(fixturePath,JSON.stringify({id,number})+'\n',{flag:'wx'});
  console.log(`Ficha visual sintética TEST creada: ${id}`);
} else {
  if (!existsSync(fixturePath)) throw new Error('No existe la ficha visual local.');
  const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
  const row=await db.get(`SELECT id,numero_pedido,stripe_entorno,pagado_en,stripe_checkout_session_id
    FROM pedidos_tarjetas WHERE id=?`,[fixture.id]);
  if (!row || row.id!==fixture.id || row.numero_pedido!==fixture.number
    || !String(row.numero_pedido).startsWith('QA-SINTETICO-') || row.stripe_entorno!=='test'
    || row.pagado_en || row.stripe_checkout_session_id) throw new Error('Identidad de ficha TEST inesperada.');
  for (const table of ['eventos_pedido','card_artwork','cards_production_jobs','crm_source_links']) {
    const key=table==='eventos_pedido'?'pedido_id':table==='crm_source_links'?'card_order_id':
      table==='cards_production_jobs'?'order_id':'order_id';
    if (Number((await db.get(`SELECT count(*) AS n FROM ${table} WHERE ${key}=?`,[fixture.id]))?.n)!==0) {
      throw new Error('La ficha tiene relaciones; retirada bloqueada.');
    }
  }
  await db.run('DELETE FROM pedidos_tarjetas WHERE id=? AND numero_pedido=? AND stripe_entorno=?',
    [fixture.id,fixture.number,'test']);
  unlinkSync(fixturePath);
  await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
  console.log('Ficha visual sintética TEST retirada y marcador verificado.');
}
