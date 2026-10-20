import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Connection } from '@tursodatabase/serverless';
import { describe, expect, it } from 'vitest';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from '../scripts/lib/test-isolation.mjs';
import type { AdminPrincipal } from '../src/lib/admin/access';
import { advanceProduction, createBatch, getCardOrder, recordCheck, startProduction } from '../src/lib/admin/cards/service';
import { approveDestinationDomain, changeDestination, generateBatchLinks, listLinkMetrics,
  listOrderLinks, publicCodePattern, recordOpening, replaceRetiredLink, resolvePublicLink, revertDestination,
  setLinkStatus, validateDestination } from '../src/lib/admin/cards/links';
import { linkSource } from '../src/lib/admin/crm/service';

describe('Fase 5: QR/NFC TEST con datos sintéticos y rollback',()=>{
  it('rechaza destinos peligrosos antes de acceder a Turso',()=>{
    for (const url of ['http://example.org/a','https://localhost/a','https://127.0.0.1/a',
      'https://user:pass@example.org/a','https://example.org/a#secret',
      'https://example.org/?access_token=x','https://example.org:444/a',
      'https://example.org\\@evil.org/a','https://internal.local/a']) {
      expect(()=>validateDestination(url),url).toThrow();
    }
    expect(validateDestination('https://example.org/cards/test').hostname).toBe('example.org');
  });

  it('mantiene códigos, versiones, permisos, métricas y barrera de envío sin residuos',async()=>{
    expect(process.env.ALTARIA_PHASE5_INTEGRATION_TEST).toBe('1');
    const production=readProjectEnv('.env'),test=readProjectEnv('.env.test');
    if (!test?.TURSO_DATABASE_URL || !test.TURSO_AUTH_TOKEN || !test.ALTARIA_TEST_DB_MARKER) throw new Error('Falta Turso TEST.');
    assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
      approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production as never});
    assertTestStripe({mode:test.STRIPE_MODE,secretKey:test.STRIPE_SECRET_KEY,
      webhookSecret:test.STRIPE_WEBHOOK_SECRET,productionEnv:production as never});
    assertStagingWorkOS({clientId:test.WORKOS_CLIENT_ID,apiKey:test.WORKOS_API_KEY,
      redirectUri:test.WORKOS_REDIRECT_URI,cookiePassword:test.WORKOS_COOKIE_PASSWORD,productionEnv:production as never});
    const token=JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1]||'','base64url').toString());
    expect(token.exp*1000).toBeGreaterThan(Date.now());
    const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
    await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
    const hash=createHash('sha256').update(readFileSync('migrations/013_altaria_os_cards_dynamic_links.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
      ['013_altaria_os_cards_dynamic_links.sql']))?.sha256).toBe(hash);
    for(const name of ['014_altaria_os_cards_link_replacements.sql','015_altaria_os_cards_link_verification.sql',
      '016_altaria_os_cards_destination_analytics.sql']) {
      const expected=createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex');
      expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',[name]))?.sha256).toBe(expected);
    }
    const tables=['cards_dynamic_links','cards_destination_targets','cards_destination_history',
      'cards_link_status_history','cards_link_generation_requests','cards_link_replacements',
      'cards_open_events','cards_link_daily_metrics','cards_link_destination_daily_metrics','crm_source_links'];
    const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>
      [name,Number((await db.get(`SELECT count(*) AS n FROM ${name}`))?.n)] as const)));
    const before=await counts();
    process.env.ALTARIA_TEST_ISOLATED='1';
    process.env.ALTARIA_TEST_DB_MARKER=test.ALTARIA_TEST_DB_MARKER;
    process.env.ALTARIA_TEST_TURSO_URL=test.ALTARIA_TEST_TURSO_URL;
    process.env.TURSO_DATABASE_URL=test.TURSO_DATABASE_URL;
    process.env.STRIPE_MODE='test';
    process.env.STRIPE_SECRET_KEY=test.STRIPE_SECRET_KEY;
    const rollback=new Error('ROLLBACK_SYNTHETIC_PHASE5');
    try {
      await db.transactionAsync(async tx=>{
        const wrapped={get:tx.get.bind(tx),all:tx.all.bind(tx),run:tx.run.bind(tx),batch:tx.batch.bind(tx),
          transactionAsync:(callback:(conn:typeof tx)=>Promise<unknown>)=>({immediate:()=>callback(tx)})} as unknown as Connection;
        const when=new Date().toISOString();
        const ids={owner:randomUUID(),production:randomUUID(),viewer:randomUUID()};
        for(const [role,id] of Object.entries(ids)){
          await tx.run(`INSERT INTO altaria_admin_users
            (id,email,workos_user_id,display_name,status,created_at,updated_at)
            VALUES (?,?,?,'Persona sintética','active',?,?)`,
            [id,`${role}.links@example.test`,`user_synthetic_${id}`,when,when]);
          await tx.run('INSERT INTO altaria_admin_user_roles(user_id,role_key,granted_at) VALUES (?,?,?)',[id,role,when]);
        }
        const principal=(role:keyof typeof ids):AdminPrincipal=>({id:ids[role],email:`${role}.links@example.test`,
          displayName:'Persona sintética',roles:[role],sessionHash:`synthetic-${role}`});
        const owner=principal('owner'),maker=principal('production'),viewer=principal('viewer');
        const orderId=randomUUID();
        await tx.run(`INSERT INTO pedidos_tarjetas
          (id,numero_pedido,clave_idempotencia,huella_solicitud,estado,google_place_id,
          negocio_nombre,negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,
          envio_centimos,total_centimos,cliente_nombre,cliente_email,cliente_telefono,
          envio_direccion,envio_codigo_postal,envio_ciudad,envio_provincia,stripe_entorno,
          creado_en,pagado_en,producto_id,producto_nombre,personalizacion_json)
          VALUES (?,?,?,?,?,'place_synthetic','Negocio Sintético','Calle de Prueba 1',6,1000,6000,0,6000,
          'Cliente Sintético','cliente@example.test','600000000','Calle de Prueba 1','28001',
          'Madrid','Madrid','test',?,?,?,'Tarjetas de prueba','{}')`,
          [orderId,`TEST-${orderId.slice(0,8)}`,randomUUID(),createHash('sha256').update(orderId).digest('hex'),
            'pagado',when,when,'resenas']);
        await tx.run(`INSERT INTO eventos_pedido
          (id,pedido_id,tipo_evento,estado_anterior,estado_nuevo,datos_minimos_json,clave_idempotencia,creado_en)
          VALUES (?,?,'pago_confirmado','pendiente_pago','pagado','{}',?,?)`,
          [randomUUID(),orderId,`synthetic-payment-${orderId}`,when]);
        await startProduction(maker,orderId,wrapped);
        await expect(approveDestinationDomain(viewer,orderId,'example.org',wrapped))
          .rejects.toMatchObject({code:'forbidden'});
        await approveDestinationDomain(owner,orderId,'example.org',wrapped);
        const batches:string[]=[];
        for(const [mode,quantity] of [['shared_batch',2],['individual',2],['identified_shared',2]] as const){
          batches.push(await createBatch(maker,orderId,{mode,quantity,idempotencyKey:randomUUID()},wrapped));
        }
        await expect(generateBatchLinks(viewer,orderId,{batchId:batches[0],destination:'https://example.org/cards/a',
          idempotencyKey:randomUUID()},wrapped)).rejects.toMatchObject({code:'forbidden'});
        await expect(generateBatchLinks(maker,orderId,{batchId:batches[0],destination:'https://evil.org/cards/a',
          idempotencyKey:randomUUID()},wrapped)).rejects.toMatchObject({code:'domain_not_approved'});
        for(const batchId of batches){
          const key=randomUUID();
          expect(await generateBatchLinks(maker,orderId,{batchId,destination:'https://example.org/cards/a',
            idempotencyKey:key,campaign:'TEST'},wrapped)).toBe(true);
          expect(await generateBatchLinks(maker,orderId,{batchId,destination:'https://example.org/cards/a',
            idempotencyKey:key,campaign:'TEST'},wrapped)).toBe(false);
          await expect(generateBatchLinks(maker,orderId,{batchId,destination:'https://example.org/cards/b',
            idempotencyKey:key,campaign:'TEST'},wrapped)).rejects.toMatchObject({code:'idempotency_conflict'});
        }
        const data=await listOrderLinks(owner,orderId,wrapped);
        expect(data.links).toHaveLength(10); // 2 shared, 4 individual, 4 identified shared.
        expect(new Set(data.links.map(link=>link.public_code)).size).toBe(10);
        expect(data.links.every(link=>publicCodePattern.test(String(link.public_code)))).toBe(true);
        expect(new Set(data.links.filter(link=>link.batch_id===batches[0]).map(link=>link.unit_id))).toEqual(new Set([null]));
        expect(new Set(data.links.filter(link=>link.batch_id===batches[2]).map(link=>link.destination_ref_id)).size).toBe(1);
        const link=data.links[0];
        expect((await resolvePublicLink(String(link.public_code),wrapped))?.url).toBe('https://example.org/cards/a');
        expect(await resolvePublicLink('invalid',wrapped)).toBeNull();
        await recordOpening(String(link.id),'unclassified',1,wrapped);
        await recordOpening(String(link.id),'suspected_bot',1,wrapped);
        const orgId=randomUUID();
        await tx.run(`INSERT INTO crm_organizations
          (id,name,normalized_name,responsible_user_id,created_at,updated_at)
          VALUES (?,'Empresa Sintética Fase 5',?,?,?,?)`,
          [orgId,`empresa sintetica fase 5 ${orgId}`,owner.id,when,when]);
        await linkSource(owner,{organizationId:orgId,sourceKind:'cards_order',sourceId:orderId},wrapped);
        const metrics=await listLinkMetrics(owner,{orderId},wrapped);
        expect(metrics.reduce((sum,row)=>sum+Number(row.openings),0)).toBe(2);
        expect(metrics.some(row=>row.traffic_class==='suspected_bot')).toBe(true);
        expect((await listLinkMetrics(owner,{organizationId:orgId},wrapped)).reduce((sum,row)=>sum+Number(row.openings),0)).toBe(2);
        const refId=String(link.destination_ref_id);
        await expect(changeDestination(viewer,orderId,refId,'https://example.org/cards/b','Motivo sintético',1,wrapped))
          .rejects.toMatchObject({code:'forbidden'});
        await changeDestination(maker,orderId,refId,'https://example.org/cards/b','Cambio sintético',1,wrapped);
        expect((await resolvePublicLink(String(link.public_code),wrapped))?.url).toBe('https://example.org/cards/b');
        await recordOpening(String(link.id),'unclassified',2,wrapped);
        await expect(changeDestination(maker,orderId,refId,'https://example.org/cards/c','Cambio sintético',1,wrapped))
          .rejects.toMatchObject({code:'version_conflict'});
        await revertDestination(maker,orderId,refId,1,'Restaurar prueba',2,wrapped);
        expect((await resolvePublicLink(String(link.public_code),wrapped))?.url).toBe('https://example.org/cards/a');
        await recordOpening(String(link.id),'unclassified',3,wrapped);
        expect((await listLinkMetrics(owner,{orderId,destination:'https://example.org/cards/a'},wrapped))
          .reduce((sum,row)=>sum+Number(row.openings),0)).toBe(3);
        expect((await listLinkMetrics(owner,{orderId,destination:'https://example.org/cards/b'},wrapped))
          .reduce((sum,row)=>sum+Number(row.openings),0)).toBe(1);
        await tx.run(`INSERT INTO cards_open_events(id,link_id,occurred_at,day_utc,traffic_class)
          VALUES (?,?,?,?,?)`,[randomUUID(),String(link.id),when,when.slice(0,10),'unclassified']);
        expect((await listLinkMetrics(owner,{orderId,destination:'Destino histórico no clasificado'},wrapped))
          .reduce((sum,row)=>sum+Number(row.openings),0)).toBe(1);
        await setLinkStatus(maker,orderId,String(link.id),'paused','Pausa de prueba',1,wrapped);
        expect(await resolvePublicLink(String(link.public_code),wrapped)).toBeNull();
        await setLinkStatus(maker,orderId,String(link.id),'active','Reactivar prueba',2,wrapped);
        expect(await resolvePublicLink(String(link.public_code),wrapped)).not.toBeNull();
        await setLinkStatus(maker,orderId,String(link.id),'retired','Retirada de prueba',3,wrapped);
        await expect(setLinkStatus(maker,orderId,String(link.id),'active','Reactivar prueba',4,wrapped))
          .rejects.toMatchObject({code:'link_retired'});
        expect(await resolvePublicLink(String(link.public_code),wrapped)).toBeNull();
        for(const key of ['preparation','artwork_review'] as const) await recordCheck(maker,orderId,key,'Revisión sintética',wrapped);
        await advanceProduction(maker,orderId,1,{},wrapped);
        for(const key of ['print_record','nfc_programmed'] as const) await recordCheck(maker,orderId,key,'Acción humana sintética',wrapped);
        await advanceProduction(maker,orderId,2,{},wrapped);
        await expect(recordCheck(maker,orderId,'qr_verified','Verificación sintética',wrapped))
          .rejects.toMatchObject({code:'links_required'});
        await expect(tx.run(`INSERT INTO cards_production_checks(order_id,check_key,note,checked_by,checked_at)
          VALUES (?,'qr_verified','Verificación sintética',?,?)`,[orderId,maker.id,when])).rejects.toThrow();
        expect((await getCardOrder(owner,orderId,wrapped))?.blockers).toContain('Activar QR y NFC con destinos aprobados para todas las unidades');
        const key=randomUUID();
        const replacement=await replaceRetiredLink(maker,orderId,String(link.id),'Sustitución sintética',key,wrapped);
        expect(await replaceRetiredLink(maker,orderId,String(link.id),'Sustitución sintética',key,wrapped)).toBe(replacement);
        const replacementRow=await tx.get('SELECT public_code FROM cards_dynamic_links WHERE id=?',[replacement]);
        expect(replacementRow?.public_code).not.toBe(link.public_code);
        expect(await resolvePublicLink(String(replacementRow?.public_code),wrapped)).not.toBeNull();
        expect(await resolvePublicLink(String(link.public_code),wrapped)).toBeNull();
        for(const check of ['qr_verified','nfc_verified','physical_control'] as const) await recordCheck(maker,orderId,check,'Verificación sintética',wrapped);
        await expect(replaceRetiredLink(maker,orderId,String(link.id),'Otra sustitución',randomUUID(),wrapped))
          .rejects.toMatchObject({code:'idempotency_conflict'});
        expect(await advanceProduction(maker,orderId,3,{},wrapped)).toBe('ready_to_ship');
        await setLinkStatus(maker,orderId,replacement,'paused','Pausa previa al envío',1,wrapped);
        await expect(advanceProduction(maker,orderId,4,{carrier:'Transportista TEST',tracking:'TEST12345'},wrapped))
          .rejects.toMatchObject({code:'links_required'});
        await setLinkStatus(maker,orderId,replacement,'active','Reactivación verificada',2,wrapped);
        expect(await advanceProduction(maker,orderId,4,{carrier:'Transportista TEST',tracking:'TEST12345'},wrapped)).toBe('shipped');
        expect((await tx.get('SELECT estado FROM pedidos_tarjetas WHERE id=?',[orderId]))?.estado).toBe('pagado');
        expect(Number((await tx.get('SELECT count(*) AS n FROM cards_destination_history WHERE destination_ref_id=?',[refId]))?.n)).toBe(3);
        expect(Number((await tx.get('SELECT count(*) AS n FROM altaria_admin_audit_events WHERE actor_user_id=? AND action LIKE ?',
          [maker.id,'cards.%']))?.n)).toBeGreaterThan(5);
        throw rollback;
      }).immediate();
    }catch(error){if(error!==rollback)throw error;}
    await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
    expect(await counts()).toEqual(before);
    expect(await db.all('PRAGMA foreign_key_check')).toHaveLength(0);
  });
});
