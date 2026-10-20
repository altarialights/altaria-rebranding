// One clearly labelled synthetic QA order in the isolated TEST database.
// Kept in TEST because Cards production history is intentionally immutable.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertTestDatabase, assertTestStripe,
  assertStagingWorkOS, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--create-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --create-test en local.');
}
const path=resolve('review/altaria-os/phase5/qa-fixture.json');
if (existsSync(path)) throw new Error('El fixture TEST ya está registrado.');
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
const hash=createHash('sha256').update(readFileSync('migrations/013_altaria_os_cards_dynamic_links.sql')).digest('hex');
if ((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
  ['013_altaria_os_cards_dynamic_links.sql']))?.sha256!==hash) throw new Error('Migración 013 no verificada.');
const now=new Date(),at=now.toISOString(),userId=randomUUID(),orderId=randomUUID();
const statements=[];
const push=(sql,...args)=>statements.push({sql,args});
push(`INSERT INTO altaria_admin_users(id,email,workos_user_id,display_name,status,created_at,updated_at)
  VALUES (?,?,?,'QA sintético · no es usuario real','active',?,?)`,userId,
  `phase5-qa-${orderId.slice(0,8)}@example.test`,`user_synthetic_${userId}`,at,at);
push('INSERT INTO altaria_admin_user_roles(user_id,role_key,granted_at) VALUES (?,?,?)',userId,'production',at);
push(`INSERT INTO pedidos_tarjetas
  (id,numero_pedido,clave_idempotencia,huella_solicitud,estado,google_place_id,
  negocio_nombre,negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,
  envio_centimos,total_centimos,cliente_nombre,cliente_email,cliente_telefono,
  envio_direccion,envio_codigo_postal,envio_ciudad,envio_provincia,stripe_entorno,
  creado_en,pagado_en,producto_id,producto_nombre,personalizacion_json)
  VALUES (?,?,?,?,?,'place_phase5_synthetic','QA SINTÉTICO · NO ENVIAR','Calle Ficticia 1',
  3,1000,3000,0,3000,'Persona ficticia','qa@example.test','600000000','Calle Ficticia 1',
  '28001','Madrid','Madrid','test',?,?,?,'Tarjetas de prueba','{}')`,
  orderId,`QA-FASE5-${orderId.slice(0,8).toUpperCase()}`,randomUUID(),
  createHash('sha256').update(orderId).digest('hex'),'pagado',at,at,'resenas');
push(`INSERT INTO eventos_pedido
  (id,pedido_id,tipo_evento,estado_anterior,estado_nuevo,datos_minimos_json,clave_idempotencia,creado_en)
  VALUES (?,?,'pago_confirmado','pendiente_pago','pagado','{}',?,?)`,
  randomUUID(),orderId,`synthetic-phase5-${orderId}`,at);
push(`INSERT INTO cards_production_jobs(order_id,stage,priority,version,started_by,started_at,updated_at)
  VALUES (?,'preparation','normal',1,?,?,?)`,orderId,userId,at,at);
push(`INSERT INTO cards_redirect_domains(order_id,hostname,active,approved_by,approved_at)
  VALUES (?,'example.org',1,?,?)`,orderId,userId,at);
const links=[];
for (const mode of ['shared_batch','individual','identified_shared']) {
  const batchId=randomUUID(),refId=randomUUID(),unitId=randomUUID();
  push('INSERT INTO cards_destination_refs(id,order_id,created_at) VALUES (?,?,?)',refId,orderId,at);
  push(`INSERT INTO cards_batches
    (id,order_id,mode,quantity,idempotency_key,request_hash,internal_batch_code,created_by,created_at)
    VALUES (?,?,?,1,?,?,?,?,?)`,batchId,orderId,mode,randomUUID(),
    createHash('sha256').update(`${orderId}:${mode}`).digest('hex'),
    mode==='shared_batch'?`B${randomBytes(15).toString('hex')}`:null,userId,at);
  push(`INSERT INTO cards_units(id,order_id,batch_id,sequence,internal_unit_code,destination_ref_id,created_at)
    VALUES (?,?,?,1,?,?,?)`,unitId,orderId,batchId,
    mode==='shared_batch'?null:`U${randomBytes(15).toString('hex')}`,refId,at);
  const url=`https://example.org/altaria-test/${mode}`;
  push(`INSERT INTO cards_destination_targets(destination_ref_id,order_id,hostname,url,revision,updated_by,updated_at)
    VALUES (?,?,'example.org',?,1,?,?)`,refId,orderId,url,userId,at);
  push(`INSERT INTO cards_destination_history
    (id,destination_ref_id,revision,action,previous_url,next_url,reason,actor_user_id,occurred_at)
    VALUES (?,?,1,'create',NULL,?,'Fixture visual sintético',?,?)`,randomUUID(),refId,url,userId,at);
  for (const channel of ['qr','nfc']) {
    const id=randomUUID(),code=randomBytes(24).toString('base64url');
    push(`INSERT INTO cards_dynamic_links
      (id,order_id,batch_id,destination_ref_id,unit_id,channel,public_code,status,revision,campaign,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'active',1,'QA SINTÉTICA',?,?,?)`,id,orderId,batchId,refId,
      mode==='shared_batch'?null:unitId,channel,code,userId,at,at);
    links.push({id,code,mode,channel});
  }
}
for (let day=8;day>=0;day--) {
  const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-day,12)).toISOString();
  for(let index=0;index<Math.max(1,9-day);index++) {
    const link=links[index%links.length];
    push(`INSERT INTO cards_open_events(id,link_id,occurred_at,day_utc,traffic_class)
      VALUES (?,?,?,?,?)`,randomUUID(),link.id,date,date.slice(0,10),index%7===0?'suspected_bot':'unclassified');
  }
}
push(`INSERT INTO altaria_admin_audit_events
  (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
  VALUES (?,?,?,?,?,? ,?,'success','{}')`,randomUUID(),at,userId,'synthetic-fixture',
  'cards.qa_fixture.create','card_order',orderId);
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
await db.batch(statements,'immediate');
await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
mkdirSync(resolve('review/altaria-os/phase5'),{recursive:true});
writeFileSync(path,JSON.stringify({orderId,links})+'\n',{flag:'wx'});
console.log(`Fixture QA sintético creado únicamente en Turso TEST: ${orderId}; ${links.length} enlaces.`);
