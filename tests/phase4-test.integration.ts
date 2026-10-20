import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Connection } from '@tursodatabase/serverless';
import { describe, expect, it } from 'vitest';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from '../scripts/lib/test-isolation.mjs';
import { hasAdminPermission, type AdminPrincipal } from '../src/lib/admin/access';
import { advanceProduction, createBatch, getCardOrder, listCardOrders, openIncident,
  recordCheck, resolveIncident, setPriority, startProduction } from '../src/lib/admin/cards/service';
import { approveDestinationDomain, generateBatchLinks } from '../src/lib/admin/cards/links';
import { linkSource } from '../src/lib/admin/crm/service';

describe('Fase 4: Cards sintéticos en Turso TEST con rollback', () => {
  it('separa pagos, permisos y etapas; deduplica unidades y audita cada acción', async () => {
    expect(process.env.ALTARIA_PHASE4_INTEGRATION_TEST).toBe('1');
    const production = readProjectEnv('.env'), test = readProjectEnv('.env.test');
    if (!test?.TURSO_DATABASE_URL || !test.TURSO_AUTH_TOKEN || !test.ALTARIA_TEST_DB_MARKER) {
      throw new Error('Falta Turso TEST.');
    }
    assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
      approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: production as never });
    assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
      webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: production as never });
    assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
      redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
      productionEnv: production as never });
    const token = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] || '', 'base64url').toString());
    expect(token.exp * 1000).toBeGreaterThan(Date.now());
    const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
    await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
    const hash = createHash('sha256').update(readFileSync('migrations/011_altaria_os_cards_production.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
      ['011_altaria_os_cards_production.sql']))?.sha256).toBe(hash);
    const hash012 = createHash('sha256').update(readFileSync('migrations/012_altaria_os_cards_payment_guards.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
      ['012_altaria_os_cards_payment_guards.sql']))?.sha256).toBe(hash012);
    const tables = ['pedidos_tarjetas','cards_production_jobs','cards_production_checks','cards_batches',
      'cards_units','cards_destination_refs','cards_production_incidents','cards_production_events',
      'crm_source_links','altaria_admin_audit_events'];
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (name) =>
      [name, Number((await db.get(`SELECT count(*) AS n FROM ${name}`))?.n)] as const)));
    const before = await counts();
    process.env.ALTARIA_TEST_ISOLATED = '1';
    process.env.ALTARIA_TEST_DB_MARKER = test.ALTARIA_TEST_DB_MARKER;
    process.env.ALTARIA_TEST_TURSO_URL = test.ALTARIA_TEST_TURSO_URL;
    process.env.TURSO_DATABASE_URL = test.TURSO_DATABASE_URL;
    process.env.STRIPE_MODE = 'test';
    process.env.STRIPE_SECRET_KEY = test.STRIPE_SECRET_KEY;
    const rollback = new Error('ROLLBACK_SYNTHETIC_PHASE4');
    try {
      await db.transactionAsync(async (tx) => {
        const wrapped = { get: tx.get.bind(tx), all: tx.all.bind(tx), run: tx.run.bind(tx),
          batch: tx.batch.bind(tx), transactionAsync: (callback: (conn: typeof tx) => Promise<unknown>) =>
            ({ immediate: () => callback(tx) }) } as unknown as Connection;
        const at = new Date().toISOString();
        const ids = { owner: randomUUID(), production: randomUUID(), viewer: randomUUID(), sales: randomUUID() };
        for (const [role, id] of Object.entries(ids)) {
          await tx.run(`INSERT INTO altaria_admin_users
            (id,email,workos_user_id,display_name,status,created_at,updated_at)
            VALUES (?,?,?,'Persona sintética','active',?,?)`,
          [id,`${role}.cards@example.test`,`user_synthetic_${id}`,at,at]);
          await tx.run('INSERT INTO altaria_admin_user_roles (user_id,role_key,granted_at) VALUES (?,?,?)',
            [id,role,at]);
        }
        const principal = (role: keyof typeof ids): AdminPrincipal => ({ id: ids[role],
          email: `${role}.cards@example.test`, displayName: 'Persona sintética', roles: [role],
          sessionHash: `synthetic-${role}` });
        const owner = principal('owner'), maker = principal('production');
        process.env.STRIPE_MODE = 'live';
        await expect(listCardOrders(owner,{},wrapped)).rejects.toMatchObject({ code: 'test_required' });
        process.env.STRIPE_MODE = 'test';
        process.env.TURSO_DATABASE_URL = production!.TURSO_DATABASE_URL;
        await expect(listCardOrders(owner,{},wrapped)).rejects.toMatchObject({ code: 'test_required' });
        process.env.TURSO_DATABASE_URL = test.TURSO_DATABASE_URL;
        expect(hasAdminPermission(maker, 'cards:write')).toBe(true);
        expect(hasAdminPermission(principal('viewer'), 'cards:write')).toBe(false);
        expect(hasAdminPermission(principal('viewer'), 'cards:artwork')).toBe(false);
        const orderId = randomUUID(), unpaidId = randomUUID(), liveId = randomUUID(), unverifiedId = randomUUID();
        const createOrder = async (id: string, environment: 'test' | 'live', paid: boolean) => {
          await tx.run(`INSERT INTO pedidos_tarjetas
            (id,numero_pedido,clave_idempotencia,huella_solicitud,estado,google_place_id,
            negocio_nombre,negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,
            envio_centimos,total_centimos,cliente_nombre,cliente_email,cliente_telefono,
            envio_direccion,envio_codigo_postal,envio_ciudad,envio_provincia,stripe_entorno,
            creado_en,pagado_en,producto_id,producto_nombre,personalizacion_json)
            VALUES (?,?,?,?,?,?,'Negocio Sintético','Calle de Prueba 1',6,1000,6000,0,6000,
            'Cliente Sintético','cliente@example.test','600000000','Calle de Prueba 1','28001',
            'Madrid','Madrid',?,?,?,?,?,?)`, [id,`TEST-${id.slice(0,8)}`,randomUUID(),
              createHash('sha256').update(id).digest('hex'),paid ? 'pagado' : 'pendiente_pago',
              `place_${id}`,environment,at,paid ? at : null,'resenas','Tarjetas de prueba','{}']);
        };
        await createOrder(orderId,'test',true);
        await createOrder(unpaidId,'test',false);
        await createOrder(liveId,'live',true); // Synthetic live-flag row only inside this rollback.
        await createOrder(unverifiedId,'test',true); // Paid timestamp alone must not authorize production.
        for (const id of [orderId,liveId]) await tx.run(`INSERT INTO eventos_pedido
          (id,pedido_id,tipo_evento,estado_anterior,estado_nuevo,datos_minimos_json,clave_idempotencia,creado_en)
          VALUES (?,?,'pago_confirmado','pendiente_pago','pagado','{}',?,?)`,
        [randomUUID(),id,`synthetic-payment-${id}`,at]);
        const listed = await listCardOrders(owner, {}, wrapped);
        expect(listed.some((row) => row.id === orderId)).toBe(true);
        expect(listed.some((row) => row.id === unpaidId)).toBe(true);
        expect(listed.some((row) => row.id === liveId)).toBe(false);
        expect(await getCardOrder(owner, liveId, wrapped)).toBeNull();
        await expect(startProduction(owner, unpaidId, wrapped)).rejects.toMatchObject({ code: 'payment_required' });
        await expect(startProduction(owner, unverifiedId, wrapped)).rejects.toMatchObject({ code: 'payment_required' });
        await expect(tx.run(`INSERT INTO cards_production_jobs
          (order_id,stage,priority,version,started_by,started_at,updated_at)
          VALUES (?,'preparation','normal',1,?,?,?)`, [unverifiedId,owner.id,at,at])).rejects.toThrow();
        await expect(startProduction(owner, liveId, wrapped)).rejects.toMatchObject({ code: 'order_missing' });
        await expect(startProduction(principal('viewer'), orderId, wrapped)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(startProduction(principal('sales'), orderId, wrapped)).rejects.toMatchObject({ code: 'forbidden' });
        expect(await startProduction(maker, orderId, wrapped)).toBe(true);
        expect(await startProduction(maker, orderId, wrapped)).toBe(false);
        await expect(advanceProduction(maker,orderId,1,{},wrapped)).rejects.toMatchObject({ code: 'stage_blocked' });
        const modes = ['shared_batch','individual','identified_shared'] as const;
        for (const mode of modes) {
          const key = randomUUID();
          const batch = await createBatch(maker,orderId,{ mode,quantity:2,idempotencyKey:key },wrapped);
          expect(await createBatch(maker,orderId,{ mode,quantity:2,idempotencyKey:key },wrapped)).toBe(batch);
          await expect(createBatch(maker,orderId,{ mode,quantity:1,idempotencyKey:key },wrapped))
            .rejects.toMatchObject({ code: 'idempotency_conflict' });
        }
        const units = await tx.all('SELECT u.*,b.mode,b.internal_batch_code FROM cards_units u JOIN cards_batches b ON b.id=u.batch_id WHERE u.order_id=?', [orderId]);
        expect(units).toHaveLength(6);
        expect(new Set(units.map((unit) => unit.id)).size).toBe(6);
        expect(new Set(units.filter((unit) => unit.internal_unit_code).map((unit) => unit.internal_unit_code)).size).toBe(4);
        expect(new Set(units.filter((unit) => unit.mode === 'identified_shared').map((unit) => unit.destination_ref_id)).size).toBe(1);
        expect(new Set(units.filter((unit) => unit.mode === 'individual').map((unit) => unit.destination_ref_id)).size).toBe(2);
        expect((await tx.get('SELECT count(*) AS n FROM cards_production_checks WHERE order_id=?', [orderId]))?.n).toBe(0);
        for (const key of ['preparation','artwork_review'] as const) await recordCheck(maker,orderId,key,'Revisión física sintética',wrapped);
        expect(await advanceProduction(maker,orderId,1,{},wrapped)).toBe('production');
        await expect(advanceProduction(maker,orderId,1,{},wrapped)).rejects.toMatchObject({ code: 'version_conflict' });
        for (const key of ['print_record','nfc_programmed'] as const) await recordCheck(maker,orderId,key,'Acción física sintética',wrapped);
        expect(await advanceProduction(maker,orderId,2,{},wrapped)).toBe('verification');
        const incident = await openIncident(maker,orderId,'Incidencia sintética de prueba','blocking',wrapped);
        await expect(recordCheck(maker,orderId,'qr_verified','Verificación física sintética',wrapped))
          .rejects.toMatchObject({ code: 'links_required' });
        await approveDestinationDomain(owner,orderId,'example.org',wrapped);
        const batches=await tx.all('SELECT id FROM cards_batches WHERE order_id=?',[orderId]);
        for (const batch of batches) await generateBatchLinks(maker,orderId,{batchId:String(batch.id),
          destination:'https://example.org/cards/synthetic',idempotencyKey:randomUUID()},wrapped);
        for (const key of ['qr_verified','nfc_verified','physical_control'] as const) await recordCheck(maker,orderId,key,'Verificación física sintética',wrapped);
        await expect(advanceProduction(maker,orderId,3,{},wrapped)).rejects.toMatchObject({ code: 'stage_blocked' });
        await resolveIncident(maker,orderId,incident,'Resuelta con inspección sintética',wrapped);
        expect(await advanceProduction(maker,orderId,3,{},wrapped)).toBe('ready_to_ship');
        const lateIncident = await openIncident(maker,orderId,'Incidencia bloqueante tardía','blocking',wrapped);
        await expect(advanceProduction(maker,orderId,4,{ carrier:'Transportista TEST',tracking:'TEST12345' },wrapped))
          .rejects.toMatchObject({ code: 'stage_blocked' });
        await resolveIncident(maker,orderId,lateIncident,'Resuelta tras nueva inspección',wrapped);
        await expect(advanceProduction(maker,orderId,4,{},wrapped)).rejects.toMatchObject({ code: 'shipment_required' });
        expect(await advanceProduction(maker,orderId,4,{ carrier:'Transportista TEST',tracking:'TEST12345' },wrapped)).toBe('shipped');
        expect(await advanceProduction(maker,orderId,5,{},wrapped)).toBe('delivered');
        await setPriority(maker,orderId,'high',wrapped);
        expect((await tx.get('SELECT estado FROM pedidos_tarjetas WHERE id=?',[orderId]))?.estado).toBe('pagado');
        const org = randomUUID();
        await tx.run(`INSERT INTO crm_organizations
          (id,name,normalized_name,responsible_user_id,created_at,updated_at)
          VALUES (?,'Empresa Sintética Cards','empresa sintetica cards',?,?,?)`,[org,owner.id,at,at]);
        await linkSource(owner,{ organizationId:org,sourceKind:'cards_order',sourceId:orderId },wrapped);
        expect((await getCardOrder(owner,orderId,wrapped))?.order.organization_id).toBe(org);
        await expect(linkSource(owner,{ organizationId:org,sourceKind:'cards_order',sourceId:orderId },wrapped))
          .rejects.toMatchObject({ code: 'source_already_linked' });
        expect(Number((await tx.get('SELECT count(*) AS n FROM altaria_admin_audit_events WHERE actor_user_id=? AND action LIKE ?',
          [maker.id,'cards.%']))?.n)).toBeGreaterThan(10);
        await expect(tx.run('DELETE FROM cards_units WHERE order_id=?',[orderId])).rejects.toThrow();
        await expect(tx.run('UPDATE cards_production_checks SET note=? WHERE order_id=?',['fake',orderId])).rejects.toThrow();
        throw rollback;
      }).immediate();
    } catch (error) { if (error !== rollback) throw error; }
    await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
    expect(await counts()).toEqual(before);
    expect(await db.all('PRAGMA foreign_key_check')).toHaveLength(0);
  });
});
