import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { assertCardsTest, assertCardsTestConfiguration, CardsError } from './service';

const at = () => new Date().toISOString();
const uuid = () => randomUUID();
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const publicCodePattern = /^[A-Za-z0-9_-]{32}$/;
export const unclassifiedDestination = 'Destino histórico no clasificado';
type SqlValue = string | number | null;
function requireCards(principal: AdminPrincipal, write = false) {
  if (!hasAdminPermission(principal, write ? 'cards:write' : 'cards:read')) throw new CardsError('forbidden', 403);
}
function requireOwner(principal: AdminPrincipal) {
  requireCards(principal, true);
  if (!principal.roles.includes('owner')) throw new CardsError('forbidden', 403);
}
function audit(principal: AdminPrincipal, action: string, type: string, id: string, when: string) {
  return { sql: `INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES (?,?,?,?,?,?,?,'success','{}')`,
  args: [uuid(), when, principal.id, principal.sessionHash, action, type, id] };
}
export function validateDestination(input: string) {
  const source = input.trim();
  if (source.length < 12 || source.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(source)) throw new CardsError('unsafe_destination');
  let url: URL;
  try { url = new URL(source); } catch { throw new CardsError('unsafe_destination'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
    || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('xn--')
    || host.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-') || part.startsWith('xn--'))
    || /^(localhost|.*\.(?:localhost|local|internal|test|invalid|example))$/.test(host)
    || /^\d+(?:\.\d+){3}$/.test(host) || host.includes('..')) throw new CardsError('unsafe_destination');
  for (const key of url.searchParams.keys()) {
    if (/(?:token|secret|password|email|phone|session|auth|api.?key|access.?key|code)/i.test(key)) {
      throw new CardsError('unsafe_destination');
    }
  }
  return { url: url.href, hostname: host };
}
async function testOrder(db: Pick<Connection,'get'>, orderId: string) {
  if (!idPattern.test(orderId)) throw new CardsError('order_missing', 404);
  const row = await db.get(`SELECT id FROM pedidos_tarjetas WHERE id=? AND stripe_entorno='test'`, [orderId]);
  if (!row) throw new CardsError('order_missing', 404);
}
async function approvedDomain(db: Pick<Connection,'get'>, orderId: string, hostname: string) {
  const row = await db.get('SELECT active FROM cards_redirect_domains WHERE order_id=? AND hostname=?', [orderId,hostname]);
  if (Number(row?.active) !== 1) throw new CardsError('domain_not_approved', 409);
}

export async function approveDestinationDomain(principal: AdminPrincipal, orderId: string,
  hostname: string, db: Connection = getDatabase()) {
  requireOwner(principal);
  const checked = validateDestination(`https://${hostname}/`);
  if (checked.hostname !== hostname.toLowerCase()) throw new CardsError('unsafe_destination');
  return db.transactionAsync(async (tx) => {
    await assertCardsTest(tx); await testOrder(tx,orderId);
    const existing = await tx.get('SELECT active FROM cards_redirect_domains WHERE order_id=? AND hostname=?', [orderId,checked.hostname]);
    const when = at();
    if (existing) {
      if (Number(existing.active) === 1) return false;
      await tx.run('UPDATE cards_redirect_domains SET active=1,approved_by=?,approved_at=? WHERE order_id=? AND hostname=?',
        [principal.id,when,orderId,checked.hostname]);
    } else {
      await tx.run('INSERT INTO cards_redirect_domains(order_id,hostname,active,approved_by,approved_at) VALUES (?,?,1,?,?)',
        [orderId,checked.hostname,principal.id,when]);
    }
    await tx.batch([audit(principal,'cards.domain.approve','card_order',orderId,when)]);
    return true;
  }).immediate();
}

export async function generateBatchLinks(principal: AdminPrincipal, orderId: string,
  input: { batchId: string; destination: string; idempotencyKey: string; campaign?: string },
  db: Connection = getDatabase()) {
  requireCards(principal,true);
  if (!idPattern.test(input.batchId) || !idPattern.test(input.idempotencyKey)
    || (input.campaign && (input.campaign.length > 80 || !input.campaign.trim()))) throw new CardsError('invalid_input');
  const target = validateDestination(input.destination);
  const campaign = input.campaign?.trim() || null;
  const hash = createHash('sha256').update(JSON.stringify([orderId,input.batchId,target.url,campaign])).digest('hex');
  return db.transactionAsync(async (tx) => {
    await assertCardsTest(tx); await testOrder(tx,orderId); await approvedDomain(tx,orderId,target.hostname);
    const batch = await tx.get('SELECT id,mode FROM cards_batches WHERE id=? AND order_id=?', [input.batchId,orderId]);
    if (!batch) throw new CardsError('batch_missing',404);
    const job=await tx.get('SELECT stage FROM cards_production_jobs WHERE order_id=?',[orderId]);
    if (!job || !['preparation','production','verification'].includes(String(job.stage))) throw new CardsError('links_stage',409);
    const verified=await tx.get(`SELECT count(*) AS n FROM cards_production_checks
      WHERE order_id=? AND check_key IN ('qr_verified','nfc_verified')`,[orderId]);
    if (Number(verified?.n)>0) throw new CardsError('links_already_verified',409);
    const existing = await tx.get('SELECT batch_id,request_hash FROM cards_link_generation_requests WHERE idempotency_key=?', [input.idempotencyKey]);
    if (existing) {
      if (existing.batch_id !== input.batchId || existing.request_hash !== hash) throw new CardsError('idempotency_conflict',409);
      return false;
    }
    const units = await tx.all('SELECT id,destination_ref_id FROM cards_units WHERE batch_id=? ORDER BY sequence', [input.batchId]);
    if (!units.length) throw new CardsError('batch_missing',404);
    const refs = [...new Set(units.map((item) => String(item.destination_ref_id)))];
    const already = await tx.get('SELECT id FROM cards_dynamic_links WHERE batch_id=? LIMIT 1', [input.batchId]);
    if (already) throw new CardsError('links_exist',409);
    const when = at();
    const statements: {sql:string;args:SqlValue[]}[] = [];
    for (const ref of refs) {
      const destination = await tx.get('SELECT destination_ref_id FROM cards_destination_targets WHERE destination_ref_id=?', [ref]);
      if (destination) throw new CardsError('links_exist',409);
      statements.push({ sql: `INSERT INTO cards_destination_targets
        (destination_ref_id,order_id,hostname,url,revision,updated_by,updated_at) VALUES (?,?,?,?,1,?,?)`,
        args: [ref,orderId,target.hostname,target.url,principal.id,when] });
      statements.push({ sql: `INSERT INTO cards_destination_history
        (id,destination_ref_id,revision,action,previous_url,next_url,reason,actor_user_id,occurred_at)
        VALUES (?,?,1,'create',NULL,?,'Destino inicial aprobado',?,?)`,
        args: [uuid(),ref,target.url,principal.id,when] });
    }
    const entries = batch.mode === 'shared_batch' ? [{ unitId: null, ref: refs[0] }] :
      units.map((unit) => ({ unitId: String(unit.id), ref: String(unit.destination_ref_id) }));
    for (const entry of entries) for (const channel of ['qr','nfc']) {
      statements.push({ sql: `INSERT INTO cards_dynamic_links
        (id,order_id,batch_id,destination_ref_id,unit_id,channel,public_code,status,revision,campaign,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',1,?,?,?,?)`, args: [uuid(),orderId,input.batchId,entry.ref,entry.unitId,
          channel,randomBytes(24).toString('base64url'),campaign,principal.id,when,when] });
    }
    statements.push({ sql: `INSERT INTO cards_link_generation_requests
      (idempotency_key,batch_id,request_hash,actor_user_id,created_at) VALUES (?,?,?,?,?)`,
      args: [input.idempotencyKey,input.batchId,hash,principal.id,when] });
    statements.push(audit(principal,'cards.links.generate','card_batch',input.batchId,when));
    for (let i=0;i<statements.length;i+=80) await tx.batch(statements.slice(i,i+80));
    return true;
  }).immediate();
}

export async function changeDestination(principal: AdminPrincipal, orderId: string, refId: string,
  destination: string, reason: string, expectedRevision: number, db: Connection = getDatabase(),
  action: 'change'|'revert' = 'change') {
  requireCards(principal,true);
  if (!idPattern.test(refId) || !Number.isInteger(expectedRevision) || reason.trim().length < 5
    || reason.trim().length > 500) throw new CardsError('invalid_input');
  const target = validateDestination(destination);
  return db.transactionAsync(async (tx) => {
    await assertCardsTest(tx); await testOrder(tx,orderId); await approvedDomain(tx,orderId,target.hostname);
    const old = await tx.get('SELECT url,revision FROM cards_destination_targets WHERE destination_ref_id=? AND order_id=?', [refId,orderId]);
    if (!old) throw new CardsError('target_missing',404);
    if (Number(old.revision) !== expectedRevision) throw new CardsError('version_conflict',409);
    if (old.url === target.url) return false;
    const when=at(), revision=expectedRevision+1;
    await tx.batch([{ sql: `INSERT INTO cards_destination_history
      (id,destination_ref_id,revision,action,previous_url,next_url,reason,actor_user_id,occurred_at)
      VALUES (?,?,?, ?,?,?,?,?,?)`,
      args: [uuid(),refId,revision,action,String(old.url),target.url,reason.trim(),principal.id,when] },
    { sql: `UPDATE cards_destination_targets SET url=?,hostname=?,revision=?,updated_by=?,updated_at=?
      WHERE destination_ref_id=? AND order_id=? AND revision=?`,
      args: [target.url,target.hostname,revision,principal.id,when,refId,orderId,expectedRevision] },
    audit(principal,`cards.destination.${action}`,'card_destination',refId,when)]);
    return true;
  }).immediate();
}

export async function revertDestination(principal: AdminPrincipal, orderId: string, refId: string,
  historicalRevision: number, reason: string, expectedRevision: number, db: Connection = getDatabase()) {
  requireCards(principal,true);
  if (!idPattern.test(refId) || !Number.isInteger(historicalRevision) || historicalRevision < 1
    || !Number.isInteger(expectedRevision) || reason.trim().length < 5 || reason.length > 500) throw new CardsError('invalid_input');
  await assertCardsTest(db);
  const prior = await db.get(`SELECT h.next_url FROM cards_destination_history h
    JOIN cards_destination_targets t ON t.destination_ref_id=h.destination_ref_id
    WHERE h.destination_ref_id=? AND t.order_id=? AND h.revision=?`, [refId,orderId,historicalRevision]);
  if (!prior) throw new CardsError('history_missing',404);
  // The same validation, revision and domain approval rules apply to a revert.
  return changeDestination(principal,orderId,refId,String(prior.next_url),`Reversión: ${reason.trim()}`,expectedRevision,db,'revert');
}

export async function setLinkStatus(principal: AdminPrincipal, orderId: string, linkId: string,
  status: 'active'|'paused'|'retired', reason: string, expectedRevision: number, db: Connection = getDatabase()) {
  requireCards(principal,true);
  if (!idPattern.test(linkId) || !['active','paused','retired'].includes(status)
    || !Number.isInteger(expectedRevision) || reason.trim().length < 5 || reason.length > 500) throw new CardsError('invalid_input');
  return db.transactionAsync(async (tx) => {
    await assertCardsTest(tx); await testOrder(tx,orderId);
    const old = await tx.get('SELECT status,revision FROM cards_dynamic_links WHERE id=? AND order_id=?', [linkId,orderId]);
    if (!old) throw new CardsError('link_missing',404);
    if (Number(old.revision) !== expectedRevision) throw new CardsError('version_conflict',409);
    if (old.status === status) return false;
    if (old.status === 'retired') throw new CardsError('link_retired',409);
    const when=at(), revision=expectedRevision+1;
    await tx.batch([{ sql: `INSERT INTO cards_link_status_history
      (id,link_id,revision,previous_status,next_status,reason,actor_user_id,occurred_at) VALUES (?,?,?,?,?,?,?,?)`,
      args: [uuid(),linkId,revision,String(old.status),status,reason.trim(),principal.id,when] },
    { sql: 'UPDATE cards_dynamic_links SET status=?,revision=?,updated_at=? WHERE id=? AND order_id=? AND revision=?',
      args: [status,revision,when,linkId,orderId,expectedRevision] },
    audit(principal,`cards.link.${status}`,'card_link',linkId,when)]);
    return true;
  }).immediate();
}

export async function replaceRetiredLink(principal:AdminPrincipal,orderId:string,oldLinkId:string,
  reason:string,idempotencyKey:string,db:Connection=getDatabase()) {
  requireCards(principal,true);
  if (!idPattern.test(oldLinkId) || !idPattern.test(idempotencyKey)
    || reason.trim().length<5 || reason.trim().length>500) throw new CardsError('invalid_input');
  const hash=createHash('sha256').update(JSON.stringify([orderId,oldLinkId,reason.trim()])).digest('hex');
  return db.transactionAsync(async(tx)=>{
    await assertCardsTest(tx); await testOrder(tx,orderId);
    const prior=await tx.get('SELECT new_link_id,idempotency_key,request_hash FROM cards_link_replacements WHERE old_link_id=?',[oldLinkId]);
    if (prior) {
      if (prior.idempotency_key!==idempotencyKey || prior.request_hash!==hash) throw new CardsError('idempotency_conflict',409);
      return String(prior.new_link_id);
    }
    const old=await tx.get(`SELECT l.*,t.url,t.hostname FROM cards_dynamic_links l
      JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
      WHERE l.id=? AND l.order_id=?`,[oldLinkId,orderId]);
    if (!old) throw new CardsError('link_missing',404);
    if (old.status!=='retired') throw new CardsError('link_not_retired',409);
    const job=await tx.get('SELECT stage FROM cards_production_jobs WHERE order_id=?',[orderId]);
    const verified=await tx.get(`SELECT count(*) AS n FROM cards_production_checks
      WHERE order_id=? AND check_key IN ('qr_verified','nfc_verified')`,[orderId]);
    if (!job || !['preparation','production','verification'].includes(String(job.stage))
      || Number(verified?.n)>0) throw new CardsError('replacement_requires_new_verification',409);
    const destination=validateDestination(String(old.url));
    if (destination.hostname!==old.hostname) throw new CardsError('unsafe_destination');
    await approvedDomain(tx,orderId,destination.hostname);
    const id=uuid(),when=at();
    await tx.batch([{sql:`INSERT INTO cards_dynamic_links
      (id,order_id,batch_id,destination_ref_id,unit_id,channel,public_code,status,revision,campaign,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'active',1,?,?,?,?)`,args:[id,orderId,String(old.batch_id),
      String(old.destination_ref_id),old.unit_id?String(old.unit_id):null,String(old.channel),
      randomBytes(24).toString('base64url'),old.campaign?String(old.campaign):null,principal.id,when,when]},
    {sql:`INSERT INTO cards_link_replacements
      (old_link_id,new_link_id,idempotency_key,request_hash,reason,actor_user_id,occurred_at)
      VALUES (?,?,?,?,?,?,?)`,args:[oldLinkId,id,idempotencyKey,hash,reason.trim(),principal.id,when]},
    audit(principal,'cards.link.replace','card_link',oldLinkId,when)]);
    return id;
  }).immediate();
}

export async function listOrderLinks(principal: AdminPrincipal, orderId: string, db: Connection = getDatabase()) {
  requireCards(principal); await assertCardsTest(db); await testOrder(db,orderId);
  const [domains,links,history,total] = await Promise.all([
    db.all('SELECT hostname,active,approved_at FROM cards_redirect_domains WHERE order_id=? ORDER BY hostname',[orderId]),
    db.all(`SELECT l.id,l.batch_id,l.unit_id,l.destination_ref_id,l.channel,l.public_code,l.status,l.revision,l.campaign,
      b.mode,u.sequence,t.url,t.revision AS target_revision,t.hostname FROM cards_dynamic_links l
      JOIN cards_batches b ON b.id=l.batch_id LEFT JOIN cards_units u ON u.id=l.unit_id
      JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
      WHERE l.order_id=? ORDER BY l.created_at,l.channel,u.sequence`,[orderId]),
    db.all(`SELECT h.destination_ref_id,h.revision,h.action,h.previous_url,h.next_url,h.reason,h.occurred_at
      FROM cards_destination_history h JOIN cards_destination_targets t ON t.destination_ref_id=h.destination_ref_id
      WHERE t.order_id=? ORDER BY h.occurred_at DESC LIMIT 100`,[orderId]),
    db.get(`SELECT coalesce(sum(m.openings),0) AS openings FROM cards_link_daily_metrics m
      JOIN cards_dynamic_links l ON l.id=m.link_id WHERE l.order_id=?`,[orderId]),
  ]);
  return { domains, links, history, totalOpenings:Number(total?.openings??0) };
}

export async function getLinkDetail(principal:AdminPrincipal,linkId:string,db:Connection=getDatabase()) {
  requireCards(principal); await assertCardsTest(db);
  if (!idPattern.test(linkId)) return null;
  const link=await db.get(`SELECT l.*,b.mode,u.sequence,t.url,t.hostname,t.revision AS target_revision,
    d.active AS domain_active,p.numero_pedido,p.negocio_nombre,sl.organization_id,o.name AS organization_name
    FROM cards_dynamic_links l JOIN cards_batches b ON b.id=l.batch_id
    LEFT JOIN cards_units u ON u.id=l.unit_id
    JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
    JOIN cards_redirect_domains d ON d.order_id=t.order_id AND d.hostname=t.hostname
    JOIN pedidos_tarjetas p ON p.id=l.order_id
    LEFT JOIN crm_source_links sl ON sl.card_order_id=l.order_id
    LEFT JOIN crm_organizations o ON o.id=sl.organization_id
    WHERE l.id=? AND p.stripe_entorno='test'`,[linkId]);
  if (!link) return null;
  const [history,statusHistory,metrics,incidents]=await Promise.all([
    db.all('SELECT revision,action,previous_url,next_url,reason,occurred_at FROM cards_destination_history WHERE destination_ref_id=? ORDER BY revision DESC',[link.destination_ref_id]),
    db.all('SELECT revision,previous_status,next_status,reason,occurred_at FROM cards_link_status_history WHERE link_id=? ORDER BY revision DESC',[linkId]),
    db.all('SELECT day_utc,traffic_class,openings FROM cards_link_daily_metrics WHERE link_id=? ORDER BY day_utc DESC LIMIT 180',[linkId]),
    db.all(`SELECT summary,severity,created_at FROM cards_production_incidents
      WHERE order_id=? AND status='open' ORDER BY created_at DESC LIMIT 10`,[link.order_id]),
  ]);
  return {link,history,statusHistory,metrics,incidents};
}

export async function listLinkMetrics(principal: AdminPrincipal,
  filters: {orderId?:string;organizationId?:string;from?:string;to?:string;channel?:string;campaign?:string;batchId?:string;unitId?:string;destination?:string;trafficClass?:string} = {},
  db: Connection = getDatabase()) {
  requireCards(principal); await assertCardsTest(db);
  const where=["p.stripe_entorno='test'"]; const args:SqlValue[]=[];
  for (const [key,column] of [['orderId','l.order_id'],['organizationId','sl.organization_id'],['batchId','l.batch_id'],['unitId','l.unit_id'],
    ['channel','l.channel'],['campaign','l.campaign'],['destination',"coalesce(h.next_url,'Destino histórico no clasificado')"],
    ['trafficClass','m.traffic_class']] as const) {
    const value=filters[key]; if (!value) continue;
    if (value.length>(key==='destination'?2048:100) || (['orderId','organizationId','batchId','unitId'].includes(key) && !idPattern.test(value))
      || (key==='channel' && !['qr','nfc'].includes(value))
      || (key==='trafficClass' && !['unclassified','suspected_bot'].includes(value))) throw new CardsError('invalid_input');
    where.push(`${column}=?`); args.push(value);
  }
  for (const [key,operator] of [['from','>='],['to','<=']] as const) {
    const value=filters[key]; if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CardsError('invalid_input');
    where.push(`m.day_utc${operator}?`); args.push(value);
  }
  const rows=await db.all(`WITH metrics AS (
      SELECT link_id,day_utc,traffic_class,target_revision,openings
        FROM cards_link_destination_daily_metrics
      UNION ALL
      SELECT d.link_id,d.day_utc,d.traffic_class,NULL,
        d.openings-coalesce(sum(x.openings),0) AS openings
        FROM cards_link_daily_metrics d LEFT JOIN cards_link_destination_daily_metrics x
          ON x.link_id=d.link_id AND x.day_utc=d.day_utc AND x.traffic_class=d.traffic_class
        GROUP BY d.link_id,d.day_utc,d.traffic_class,d.openings
        HAVING d.openings>coalesce(sum(x.openings),0)
    )
    SELECT m.day_utc,l.order_id,sl.organization_id,o.name AS organization_name,
    l.batch_id,l.unit_id,l.channel,l.campaign,
    coalesce(h.next_url,'Destino histórico no clasificado') AS destination,
    m.traffic_class,sum(m.openings) AS openings FROM metrics m
    JOIN cards_dynamic_links l ON l.id=m.link_id JOIN pedidos_tarjetas p ON p.id=l.order_id
    LEFT JOIN cards_destination_history h ON h.destination_ref_id=l.destination_ref_id
      AND h.revision=m.target_revision
    LEFT JOIN crm_source_links sl ON sl.card_order_id=l.order_id
    LEFT JOIN crm_organizations o ON o.id=sl.organization_id
    WHERE ${where.join(' AND ')} GROUP BY m.day_utc,l.order_id,sl.organization_id,o.name,
      l.batch_id,l.unit_id,l.channel,l.campaign,h.next_url,m.traffic_class
    ORDER BY m.day_utc DESC LIMIT 2001`,args);
  if (rows.length>2000) throw new CardsError('metrics_limit',413);
  return rows;
}

export async function resolvePublicLink(code: string, db: Connection = getDatabase()) {
  if (!publicCodePattern.test(code)) return null;
  assertCardsTestConfiguration();
  const row=await db.get(`SELECT l.id,l.status,t.url,t.hostname,t.revision,d.active FROM cards_dynamic_links l
    JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
    JOIN cards_redirect_domains d ON d.order_id=t.order_id AND d.hostname=t.hostname
    JOIN pedidos_tarjetas p ON p.id=l.order_id
    JOIN altaria_test_environment e ON e.id='test' AND e.marker=?
    WHERE l.public_code=? AND p.stripe_entorno='test'`,[process.env.ALTARIA_TEST_DB_MARKER??'',code]);
  if (!row || row.status!=='active' || Number(row.active)!==1) return null;
  try { if (validateDestination(String(row.url)).hostname!==row.hostname) return null; }
  catch { return null; }
  return { linkId:String(row.id),url:String(row.url),targetRevision:Number(row.revision) };
}

export async function recordOpening(linkId:string, trafficClass:'unclassified'|'suspected_bot',
  targetRevision:number,db:Connection=getDatabase()) {
  if (!idPattern.test(linkId) || !Number.isInteger(targetRevision) || targetRevision<1) return;
  await assertCardsTest(db);
  const when=at();
  await db.run(`INSERT INTO cards_open_events
    (id,link_id,occurred_at,day_utc,traffic_class,target_revision) VALUES (?,?,?,?,?,?)`,
    [uuid(),linkId,when,when.slice(0,10),trafficClass,targetRevision]);
}

export async function setRetention(principal:AdminPrincipal,rawDays:number,aggregateDays:number,db:Connection=getDatabase()) {
  requireOwner(principal);
  if (!Number.isInteger(rawDays) || rawDays<1 || rawDays>90 || !Number.isInteger(aggregateDays)
    || aggregateDays<31 || aggregateDays>730 || aggregateDays<rawDays) throw new CardsError('invalid_input');
  return db.transactionAsync(async(tx)=>{
    await assertCardsTest(tx);
    const when=at();
    await tx.batch([{sql:'UPDATE cards_link_retention SET raw_days=?,aggregate_days=? WHERE id=?',args:[rawDays,aggregateDays,'test']},
      audit(principal,'cards.analytics.retention','card_analytics','test',when)]);
  }).immediate();
}

export async function pruneAnalytics(principal:AdminPrincipal,db:Connection=getDatabase()) {
  requireOwner(principal);
  return db.transactionAsync(async(tx)=>{
    await assertCardsTest(tx);
    const policy=await tx.get('SELECT raw_days,aggregate_days FROM cards_link_retention WHERE id=?',['test']);
    if (!policy) throw new CardsError('invalid_input');
    const raw=new Date(Date.now()-Number(policy.raw_days)*86400000).toISOString().slice(0,10);
    const aggregate=new Date(Date.now()-Number(policy.aggregate_days)*86400000).toISOString().slice(0,10);
    await tx.batch([{sql:'DELETE FROM cards_open_events WHERE day_utc<?',args:[raw]},
      {sql:'DELETE FROM cards_link_daily_metrics WHERE day_utc<?',args:[aggregate]},
      {sql:'DELETE FROM cards_link_destination_daily_metrics WHERE day_utc<?',args:[aggregate]},
      audit(principal,'cards.analytics.prune','card_analytics','test',at())]);
  }).immediate();
}
