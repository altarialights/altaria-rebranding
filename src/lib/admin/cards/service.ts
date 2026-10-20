import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { batchModes, checkKeys, nextStage, productionStages, stageBlockers,
  type BatchMode, type CheckKey, type ProductionStage } from './workflow';

type Value = string | number | null;
type Statement = { sql: string; args: Value[] };
const now = () => new Date().toISOString();
const uid = () => randomUUID();
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class CardsError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
function requirePermission(principal: AdminPrincipal, permission: 'cards:read' | 'cards:write' | 'cards:artwork') {
  if (!hasAdminPermission(principal, permission)) throw new CardsError('forbidden', 403);
}
export async function assertCardsTest(db: Pick<Connection, 'get'>) {
  assertCardsTestConfiguration();
  const row = await db.get('SELECT marker FROM altaria_test_environment WHERE id = ?', ['test']);
  if (row?.marker !== process.env.ALTARIA_TEST_DB_MARKER) throw new CardsError('test_required', 503);
}
export function assertCardsTestConfiguration() {
  if (process.env.ALTARIA_TEST_ISOLATED !== '1'
    || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV
    || !/^[a-f0-9]{64}$/.test(process.env.ALTARIA_TEST_DB_MARKER ?? '')
    || process.env.STRIPE_MODE !== 'test'
    || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new CardsError('test_required', 503);
  const target = process.env.TURSO_DATABASE_URL, approved = process.env.ALTARIA_TEST_TURSO_URL;
  try {
    if (!target || !approved || new URL(target).hostname.toLowerCase() !== new URL(approved).hostname.toLowerCase()
      || !new URL(target).hostname.toLowerCase().startsWith('altaria-os-test-')
      || new URL(target).hostname.toLowerCase() === 'altaria-digital-index-altarialights.aws-eu-west-1.turso.io') {
      throw new Error('wrong_database');
    }
  } catch { throw new CardsError('test_required', 503); }
}
const assertTest = assertCardsTest;
function audit(principal: AdminPrincipal, action: string, targetType: string, targetId: string, at: string): Statement {
  return { sql: `INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES (?,?,?,?,?,?,?,'success','{}')`,
  args: [uid(), at, principal.id, principal.sessionHash, action, targetType, targetId] };
}
function event(principal: AdminPrincipal, orderId: string, kind: string, at: string,
  from: string | null = null, to: string | null = null, details: Record<string, string | number> = {}): Statement {
  return { sql: `INSERT INTO cards_production_events
    (id,order_id,kind,from_stage,to_stage,actor_user_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?,?)`,
  args: [uid(), orderId, kind, from, to, principal.id, at, JSON.stringify(details)] };
}
async function paidTestOrder(db: Pick<Connection, 'get'>, orderId: string) {
  if (!uuid(orderId)) throw new CardsError('order_missing', 404);
  const row = await db.get(`SELECT p.id,p.cantidad,p.estado,p.pagado_en,p.stripe_entorno,
    EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
      AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado') AS payment_confirmed
    FROM pedidos_tarjetas p WHERE p.id=?`, [orderId]);
  if (!row || row.stripe_entorno !== 'test') throw new CardsError('order_missing', 404);
  if (!row.pagado_en || Number(row.payment_confirmed) !== 1
    || !['pagado', 'preparando', 'enviado', 'entregado'].includes(String(row.estado))) {
    throw new CardsError('payment_required', 409);
  }
  return row;
}
const missingActiveLinksSql = `SELECT count(*) AS missing FROM cards_units u
  JOIN cards_batches b ON b.id=u.batch_id
  CROSS JOIN (SELECT 'qr' AS channel UNION ALL SELECT 'nfc') ch
  WHERE u.order_id=? AND NOT EXISTS (
    SELECT 1 FROM cards_dynamic_links l
    JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
    JOIN cards_redirect_domains d ON d.order_id=t.order_id AND d.hostname=t.hostname
    WHERE l.batch_id=u.batch_id AND l.destination_ref_id=u.destination_ref_id
      AND l.channel=ch.channel AND l.status='active' AND d.active=1
      AND (l.unit_id=u.id OR (b.mode='shared_batch' AND l.unit_id IS NULL)))`;

export async function listCardOrders(principal: AdminPrincipal, filters: {
  status?: string; from?: string; to?: string; q?: string; priority?: string; limit?: number;
} = {}, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:read'); await assertTest(db);
  const where = ["p.stripe_entorno='test'"];
  const args: Value[] = [];
  if (filters.status && ['pending', ...productionStages].includes(filters.status)) {
    if (filters.status === 'pending') where.push('j.order_id IS NULL');
    else { where.push('j.stage=?'); args.push(filters.status); }
  }
  if (filters.priority && ['normal', 'high', 'urgent'].includes(filters.priority)) {
    where.push("coalesce(j.priority,'normal')=?"); args.push(filters.priority);
  }
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) { where.push('p.creado_en>=?'); args.push(filters.from); }
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) { where.push('p.creado_en<?'); args.push(`${filters.to}T23:59:59.999Z`); }
  if (filters.q?.trim()) {
    const q = `%${filters.q.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(p.numero_pedido LIKE ? ESCAPE '\\' OR p.negocio_nombre LIKE ? ESCAPE '\\' OR p.cliente_nombre LIKE ? ESCAPE '\\' OR p.cliente_email LIKE ? ESCAPE '\\')");
    args.push(q, q, q, q);
  }
  args.push(Math.min(Math.max(filters.limit ?? 100, 1), 200));
  return db.all(`SELECT p.id,p.numero_pedido,p.negocio_nombre,p.cliente_nombre,p.cliente_email,
    p.producto_nombre,p.cantidad,p.total_centimos,p.estado,p.creado_en,p.pagado_en,
    EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
      AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado') AS payment_confirmed,
    j.stage,j.priority,j.updated_at,o.id AS organization_id,o.name AS organization_name,
    (SELECT count(*) FROM cards_production_incidents i WHERE i.order_id=p.id AND i.status='open') AS open_incidents
    FROM pedidos_tarjetas p LEFT JOIN cards_production_jobs j ON j.order_id=p.id
    LEFT JOIN crm_source_links l ON l.card_order_id=p.id
    LEFT JOIN crm_organizations o ON o.id=l.organization_id
    WHERE ${where.join(' AND ')} ORDER BY CASE coalesce(j.priority,'normal')
      WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, p.creado_en DESC LIMIT ?`, args);
}

export async function getCardOrder(principal: AdminPrincipal, orderId: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:read'); await assertTest(db);
  if (!uuid(orderId)) return null;
  const order = await db.get(`SELECT p.*,j.stage,j.priority,j.version,j.carrier,j.tracking,j.shipped_at,j.delivered_at,
    EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
      AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado') AS payment_confirmed,
    o.id AS organization_id,o.name AS organization_name
    FROM pedidos_tarjetas p LEFT JOIN cards_production_jobs j ON j.order_id=p.id
    LEFT JOIN crm_source_links l ON l.card_order_id=p.id
    LEFT JOIN crm_organizations o ON o.id=l.organization_id
    WHERE p.id=? AND p.stripe_entorno='test'`, [orderId]);
  if (!order) return null;
  const [artwork, batches, units, checks, incidents, events, orderEvents, linksGap] = await Promise.all([
    db.all(`SELECT filename,mime_type,size_bytes,width,height,validation_status,created_at
      FROM card_artwork WHERE order_id=?`, [orderId]),
    db.all('SELECT id,mode,quantity,internal_batch_code,created_at FROM cards_batches WHERE order_id=? ORDER BY created_at', [orderId]),
    db.all('SELECT batch_id,sequence,internal_unit_code,destination_ref_id FROM cards_units WHERE order_id=? ORDER BY batch_id,sequence', [orderId]),
    db.all(`SELECT c.check_key,c.note,c.checked_at,u.display_name AS actor_name FROM cards_production_checks c
      JOIN altaria_admin_users u ON u.id=c.checked_by WHERE c.order_id=?`, [orderId]),
    db.all(`SELECT i.*,u.display_name AS actor_name FROM cards_production_incidents i
      JOIN altaria_admin_users u ON u.id=i.created_by WHERE i.order_id=? ORDER BY i.created_at DESC`, [orderId]),
    db.all(`SELECT e.*,u.display_name AS actor_name FROM cards_production_events e
      JOIN altaria_admin_users u ON u.id=e.actor_user_id WHERE e.order_id=? ORDER BY e.occurred_at DESC LIMIT 100`, [orderId]),
    db.all('SELECT tipo_evento,estado_anterior,estado_nuevo,creado_en FROM eventos_pedido WHERE pedido_id=? ORDER BY creado_en DESC LIMIT 50', [orderId]),
    db.get(missingActiveLinksSql, [orderId]),
  ]);
  const allocated = batches.reduce((sum, row) => sum + Number(row.quantity), 0);
  const stage = productionStages.includes(String(order.stage) as ProductionStage) ? String(order.stage) as ProductionStage : null;
  const blockers = stage ? stageBlockers(stage, new Set(checks.map((row) => String(row.check_key))),
    allocated, Number(order.cantidad), incidents.filter((row) => row.status === 'open' && row.severity === 'blocking').length) : [];
  if (['verification','ready_to_ship'].includes(stage??'') && Number(linksGap?.missing ?? 0)>0) {
    blockers.push('Activar QR y NFC con destinos aprobados para todas las unidades');
  }
  return { order, artwork, batches, units, checks, incidents, events, orderEvents, allocated, stage, blockers };
}

export async function startProduction(principal: AdminPrincipal, orderId: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  return db.transactionAsync(async (tx) => {
    await assertTest(tx); await paidTestOrder(tx, orderId);
    const existing = await tx.get('SELECT order_id FROM cards_production_jobs WHERE order_id=?', [orderId]);
    if (existing) return false;
    const at = now();
    await tx.batch([{ sql: `INSERT INTO cards_production_jobs
      (order_id,stage,priority,version,started_by,started_at,updated_at)
      VALUES (?,'preparation','normal',1,?,?,?)`, args: [orderId, principal.id, at, at] },
    event(principal, orderId, 'started', at, null, 'preparation'),
    audit(principal, 'cards.production.start', 'card_order', orderId, at)]);
    return true;
  }).immediate();
}

export async function recordCheck(principal: AdminPrincipal, orderId: string, key: CheckKey,
  note: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (!checkKeys.includes(key) || note.trim().length < 3 || note.trim().length > 500) throw new CardsError('invalid_input');
  return db.transactionAsync(async (tx) => {
    await assertTest(tx); await paidTestOrder(tx, orderId);
    const job = await tx.get('SELECT stage FROM cards_production_jobs WHERE order_id=?', [orderId]);
    if (!job) throw new CardsError('job_missing', 404);
    const allowed = (['preparation','artwork_review'].includes(key) && job.stage === 'preparation')
      || (['print_record','nfc_programmed'].includes(key) && job.stage === 'production')
      || (['qr_verified','nfc_verified','physical_control'].includes(key) && job.stage === 'verification');
    if (!allowed) throw new CardsError('check_stage', 409);
    if (['qr_verified','nfc_verified'].includes(key)
      && Number((await tx.get(missingActiveLinksSql,[orderId]))?.missing ?? 0)>0) {
      throw new CardsError('links_required',409);
    }
    const existing = await tx.get('SELECT check_key FROM cards_production_checks WHERE order_id=? AND check_key=?', [orderId, key]);
    if (existing) return false;
    const at = now();
    await tx.batch([{ sql: `INSERT INTO cards_production_checks
      (order_id,check_key,note,checked_by,checked_at) VALUES (?,?,?,?,?)`,
      args: [orderId, key, note.trim(), principal.id, at] },
    event(principal, orderId, 'check_recorded', at, null, null, { check: key }),
    audit(principal, 'cards.check.record', 'card_order', orderId, at)]);
    return true;
  }).immediate();
}

export async function createBatch(principal: AdminPrincipal, orderId: string,
  input: { mode: BatchMode; quantity: number; idempotencyKey: string }, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (!batchModes.includes(input.mode) || !Number.isInteger(input.quantity)
    || input.quantity < 1 || input.quantity > 500 || !uuid(input.idempotencyKey)) throw new CardsError('invalid_input');
  const hash = createHash('sha256').update(JSON.stringify([orderId,input.mode,input.quantity])).digest('hex');
  return db.transactionAsync(async (tx) => {
    await assertTest(tx); const order = await paidTestOrder(tx, orderId);
    const existing = await tx.get('SELECT id,request_hash,order_id FROM cards_batches WHERE idempotency_key=?', [input.idempotencyKey]);
    if (existing) {
      if (existing.request_hash !== hash || existing.order_id !== orderId) throw new CardsError('idempotency_conflict', 409);
      return String(existing.id);
    }
    const job = await tx.get('SELECT stage FROM cards_production_jobs WHERE order_id=?', [orderId]);
    if (job?.stage !== 'preparation') throw new CardsError('batch_stage', 409);
    const allocated = await tx.get('SELECT coalesce(sum(quantity),0) AS quantity FROM cards_batches WHERE order_id=?', [orderId]);
    if (Number(allocated?.quantity ?? 0) + input.quantity > Number(order.cantidad)) throw new CardsError('batch_quantity', 409);
    const id = uid(); const at = now();
    const sharedDestination = input.mode !== 'individual' ? uid() : null;
    const statements: Statement[] = [];
    if (sharedDestination) statements.push({ sql: `INSERT INTO cards_destination_refs (id,order_id,created_at) VALUES (?,?,?)`, args: [sharedDestination,orderId,at] });
    statements.push({ sql: `INSERT INTO cards_batches
      (id,order_id,mode,quantity,idempotency_key,request_hash,internal_batch_code,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, args: [id,orderId,input.mode,input.quantity,input.idempotencyKey,hash,
        input.mode === 'shared_batch' ? `B${randomBytes(15).toString('hex')}` : null,principal.id,at] });
    for (let sequence = 1; sequence <= input.quantity; sequence++) {
      const destinationId = sharedDestination ?? uid();
      if (!sharedDestination) statements.push({ sql: `INSERT INTO cards_destination_refs (id,order_id,created_at) VALUES (?,?,?)`, args: [destinationId,orderId,at] });
      statements.push({ sql: `INSERT INTO cards_units
        (id,order_id,batch_id,sequence,internal_unit_code,destination_ref_id,created_at)
        VALUES (?,?,?,?,?,?,?)`, args: [uid(),orderId,id,sequence,
        input.mode === 'shared_batch' ? null : `U${randomBytes(15).toString('hex')}`,destinationId,at] });
    }
    statements.push(event(principal, orderId, 'batch_created', at, null, null,
      { mode: input.mode, quantity: input.quantity }), audit(principal, 'cards.batch.create', 'card_batch', id, at));
    for (let offset = 0; offset < statements.length; offset += 100) {
      await tx.batch(statements.slice(offset, offset + 100));
    }
    return id;
  }).immediate();
}

export async function advanceProduction(principal: AdminPrincipal, orderId: string, version: number,
  shipping: { carrier?: string; tracking?: string } = {}, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (!Number.isInteger(version) || version < 1) throw new CardsError('invalid_input');
  return db.transactionAsync(async (tx) => {
    await assertTest(tx); const order = await paidTestOrder(tx, orderId);
    const job = await tx.get('SELECT stage,version FROM cards_production_jobs WHERE order_id=?', [orderId]);
    if (!job) throw new CardsError('job_missing', 404);
    if (Number(job.version) !== version) throw new CardsError('version_conflict', 409);
    const from = String(job.stage) as ProductionStage; const to = nextStage(from);
    if (!to) throw new CardsError('stage_final', 409);
    const checks = await tx.all('SELECT check_key FROM cards_production_checks WHERE order_id=?', [orderId]);
    const allocated = await tx.get('SELECT coalesce(sum(quantity),0) AS quantity FROM cards_batches WHERE order_id=?', [orderId]);
    const incidents = await tx.get(`SELECT count(*) AS count FROM cards_production_incidents
      WHERE order_id=? AND status='open' AND severity='blocking'`, [orderId]);
    if (stageBlockers(from, new Set(checks.map((row) => String(row.check_key))),
      Number(allocated?.quantity ?? 0), Number(order.cantidad), Number(incidents?.count ?? 0)).length) {
      throw new CardsError('stage_blocked', 409);
    }
    if (['ready_to_ship','shipped'].includes(to)
      && Number((await tx.get(missingActiveLinksSql,[orderId]))?.missing ?? 0)>0) {
      throw new CardsError('links_required',409);
    }
    const carrier = to === 'shipped' ? (shipping.carrier ?? '').trim() : null;
    const tracking = to === 'shipped' ? (shipping.tracking ?? '').trim() : null;
    if (to === 'shipped' && (carrier!.length < 2 || carrier!.length > 100
      || tracking!.length < 3 || tracking!.length > 120)) throw new CardsError('shipment_required');
    const at = now();
    const result = await tx.run(`UPDATE cards_production_jobs SET stage=?,version=version+1,updated_at=?,
      carrier=coalesce(?,carrier),tracking=coalesce(?,tracking),
      shipped_at=CASE WHEN ?='shipped' THEN ? ELSE shipped_at END,
      delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END
      WHERE order_id=? AND stage=? AND version=?`, [to,at,carrier,tracking,to,at,to,at,orderId,from,version]);
    if (Number(result.changes) !== 1) throw new CardsError('version_conflict', 409);
    await tx.batch([event(principal, orderId, 'stage_changed', at, from, to),
      audit(principal, 'cards.stage.advance', 'card_order', orderId, at)]);
    return to;
  }).immediate();
}

export async function setPriority(principal: AdminPrincipal, orderId: string,
  priority: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (!['normal','high','urgent'].includes(priority)) throw new CardsError('invalid_input');
  await db.transactionAsync(async (tx) => {
    await assertTest(tx); await paidTestOrder(tx,orderId);
    const job = await tx.get('SELECT priority FROM cards_production_jobs WHERE order_id=?', [orderId]);
    if (!job) throw new CardsError('job_missing', 404);
    if (job.priority === priority) return;
    const at = now();
    await tx.batch([{ sql: 'UPDATE cards_production_jobs SET priority=?,updated_at=? WHERE order_id=?', args: [priority,at,orderId] },
      event(principal,orderId,'priority_changed',at,null,null,{ priority }),
      audit(principal,'cards.priority.change','card_order',orderId,at)]);
  }).immediate();
}

export async function openIncident(principal: AdminPrincipal, orderId: string,
  summary: string, severity: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (summary.trim().length < 5 || summary.trim().length > 500 || !['minor','blocking'].includes(severity)) throw new CardsError('invalid_input');
  return db.transactionAsync(async (tx) => {
    await assertTest(tx); await paidTestOrder(tx,orderId);
    if (!await tx.get('SELECT order_id FROM cards_production_jobs WHERE order_id=?', [orderId])) throw new CardsError('job_missing',404);
    const id=uid(); const at=now();
    await tx.batch([{ sql: `INSERT INTO cards_production_incidents
      (id,order_id,summary,severity,status,created_by,created_at) VALUES (?,?,?,?,'open',?,?)`,
      args: [id,orderId,summary.trim(),severity,principal.id,at] },
      event(principal,orderId,'incident_opened',at,null,null,{ severity }),
      audit(principal,'cards.incident.open','card_incident',id,at)]);
    return id;
  }).immediate();
}

export async function resolveIncident(principal: AdminPrincipal, orderId: string, incidentId: string,
  resolution: string, db: Connection = getDatabase()) {
  requirePermission(principal, 'cards:write');
  if (!uuid(incidentId) || resolution.trim().length < 5 || resolution.trim().length > 500) throw new CardsError('invalid_input');
  await db.transactionAsync(async (tx) => {
    await assertTest(tx); await paidTestOrder(tx,orderId);
    const existing = await tx.get('SELECT id FROM cards_production_incidents WHERE id=? AND order_id=? AND status=?', [incidentId,orderId,'open']);
    if (!existing) throw new CardsError('incident_missing',404);
    const at=now();
    await tx.batch([{ sql: `UPDATE cards_production_incidents SET status='resolved',resolved_by=?,resolved_at=?,resolution=?
      WHERE id=? AND order_id=? AND status='open'`, args: [principal.id,at,resolution.trim(),incidentId,orderId] },
      event(principal,orderId,'incident_resolved',at),
      audit(principal,'cards.incident.resolve','card_incident',incidentId,at)]);
  }).immediate();
}
