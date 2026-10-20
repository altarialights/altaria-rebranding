import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import type { AdminPrincipal } from '../access';
import { assertCardsTest } from '../cards/service';
import { madridDay, madridTime, retryDelayMs, safeErrorCode } from './common';
import { briefFromWork, listMyWork } from './work';
import { expireApprovals } from './approvals';
import { renderTelegram, simulatedTelegram, type TelegramAdapter,
  type TelegramPayload, type Urgency } from './telegram';

type SqlArg = string | number | null;
type Statement = {sql:string;args:SqlArg[]};
const iso=()=>new Date().toISOString();
const plus=(ms:number)=>new Date(Date.now()+ms).toISOString();
const audit=(action:string,type:string,id:string,at:string):Statement=>({
  sql:`INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES (?,?,NULL,NULL,?,?,?,'success','{}')`,
  args:[randomUUID(),at,action,type,id],
});
const work=(kind:string,sourceType:string,sourceId:string,key:string,title:string,
  priority:'normal'|'high'|'urgent',orgId:string|null,orderId:string|null,
  assignee:string|null,at:string,dueAt:string|null=null):Statement=>({
  sql:`INSERT OR IGNORE INTO os_work_items
    (id,kind,source_type,source_id,dedupe_key,title,priority,organization_id,order_id,
     assigned_user_id,status,due_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
  args:[randomUUID(),kind,sourceType,sourceId,key,title,priority,orgId,orderId,assignee,dueAt,at],
});
const notification=(template:string,urgency:Urgency,key:string,payload:TelegramPayload,at:string):Statement=>({
  sql:`INSERT OR IGNORE INTO os_notifications
    (id,channel,template_key,urgency,dedupe_key,payload_json,status,run_at,created_at)
    VALUES (?,'telegram_simulated',?,?,?,?,'queued',?,?)`,
  args:[randomUUID(),template,urgency,key,JSON.stringify(payload),at,at],
});

// Reconciles only historic, verified TEST payments. New source writes use trigger
// outbox entries in the same transaction as their business event.
export async function reconcileTestEvents(db:Connection) {
  await assertCardsTest(db);
  const at=iso();
  const result=await db.run(`INSERT OR IGNORE INTO os_outbox
    (id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
    SELECT lower(hex(randomblob(16))),'cards.paid','card_order',e.pedido_id,
      'cards.paid:'||e.id,'{}',e.creado_en FROM eventos_pedido e
      JOIN pedidos_tarjetas p ON p.id=e.pedido_id
      WHERE e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado'
        AND p.stripe_entorno='test' AND p.pagado_en IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM os_outbox o WHERE o.dedupe_key='cards.paid:'||e.id)
      LIMIT 100`);
  const expired=await db.run(`INSERT OR IGNORE INTO os_outbox
    (id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
    SELECT lower(hex(randomblob(16))),'proposal.expired','crm_proposal',p.id,
      'proposal.expiry:'||p.id||':'||p.current_version,'{}',?
      FROM crm_proposals p WHERE p.status='sent' AND p.expires_at IS NOT NULL
        AND p.expires_at<=? AND NOT EXISTS(SELECT 1 FROM os_outbox o
          WHERE o.dedupe_key='proposal.expiry:'||p.id||':'||p.current_version)
      LIMIT 100`,[at,at]);
  const contentDue=await db.run(`INSERT OR IGNORE INTO os_outbox
    (id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
    SELECT lower(hex(randomblob(16))),'content.due','content_piece',p.id,
      'content.due:'||p.id||':'||p.current_version||':'||substr(p.due_at,1,10),
      json_object('pieceId',p.id,'version',p.current_version),?
    FROM content_pieces p WHERE p.due_at BETWEEN ? AND ?
      AND p.on_hold=0 AND p.publication_state='none' AND p.stage<>'ready'
    LIMIT 100`,[at,at,new Date(Date.parse(at)+48*60*60_000).toISOString()]);
  await db.transactionAsync(async tx=>{
    const obsolete=await tx.all(`SELECT id,CASE
      WHEN kind='cards' AND EXISTS(SELECT 1 FROM cards_production_jobs j
        WHERE j.order_id=os_work_items.order_id) THEN 'production_started'
      WHEN kind='incident' AND EXISTS(SELECT 1 FROM cards_production_incidents i
        WHERE i.id=os_work_items.source_id AND i.status='resolved') THEN 'incident_resolved'
      WHEN kind='link_alert' AND EXISTS(SELECT 1 FROM cards_dynamic_links l
        WHERE l.id=os_work_items.source_id AND l.status='active') THEN 'link_reactivated'
      ELSE NULL END AS reason FROM os_work_items WHERE status='open'
      AND kind IN ('cards','incident','link_alert') LIMIT 100`);
    for(const row of obsolete) if(row.reason) await tx.batch([{
      sql:`UPDATE os_work_items SET status='cancelled',cancel_reason=?
        WHERE id=? AND status='open'`,args:[String(row.reason),String(row.id)]},
      audit('os.work.cancel_obsolete','work_item',String(row.id),at)]);
  }).immediate();
  return Number(result.changes)+Number(expired.changes)+Number(contentDue.changes);
}

export async function dispatchOutbox(db:Connection,limit=50) {
  await assertCardsTest(db);
  if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error('invalid_limit');
  return db.transactionAsync(async tx=>{
    const rows=await tx.all(`SELECT id,event_type,payload_json,created_at FROM os_outbox
      WHERE dispatched_at IS NULL ORDER BY created_at LIMIT ?`,[limit]);
    const at=iso();
    for(const row of rows) {
      const config=await tx.get('SELECT rule_key FROM os_rule_config WHERE rule_key=?',[row.event_type]);
      if(!config) throw new Error('unknown_rule');
      await tx.batch([{sql:`INSERT OR IGNORE INTO os_jobs
          (id,rule_key,event_id,idempotency_key,payload_json,status,run_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'queued',?,?,?)`,args:[randomUUID(),String(row.event_type),
          String(row.id),`event:${row.id}`,String(row.payload_json),String(row.created_at),at,at]},
        {sql:'UPDATE os_outbox SET dispatched_at=? WHERE id=? AND dispatched_at IS NULL',
          args:[at,String(row.id)]}]);
    }
    return rows.length;
  }).immediate();
}

export async function claimJob(db:Connection,at=iso()) {
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const exhausted=await tx.all(`SELECT id,lease_token,updated_at FROM os_jobs
      WHERE status='leased' AND leased_until<? AND attempts>=max_attempts LIMIT 50`,[at]);
    for(const row of exhausted) await tx.run(`INSERT INTO os_job_attempts
      (id,job_id,lease_token,started_at,finished_at,outcome,error_code)
      VALUES (?,?,?,?,?,'dead','lease_exhausted')`,
      [randomUUID(),row.id,row.lease_token,row.updated_at,at]);
    await tx.run(`UPDATE os_jobs SET status='dead',lease_token=NULL,leased_until=NULL,
      last_error_code='lease_exhausted',updated_at=? WHERE id IN
      (SELECT id FROM os_jobs WHERE status='leased' AND leased_until<?
        AND attempts>=max_attempts LIMIT 50)`,[at,at]);
    const row=await tx.get(`SELECT j.* FROM os_jobs j JOIN os_rule_config r ON r.rule_key=j.rule_key
      WHERE r.enabled=1 AND j.run_at<=?
        AND (j.status='queued' OR (j.status='leased' AND j.leased_until<?))
      ORDER BY j.run_at,j.created_at LIMIT 1`,[at,at]);
    if(!row) return null;
    if(row.status==='leased'&&row.lease_token) {
      await tx.run(`INSERT INTO os_job_attempts
        (id,job_id,lease_token,started_at,finished_at,outcome,error_code)
        VALUES (?,?,?,?,?,'retry','lease_expired')`,[randomUUID(),row.id,row.lease_token,row.updated_at,at]);
    }
    const token=randomUUID(),until=new Date(Date.parse(at)+90_000).toISOString();
    const result=await tx.run(`UPDATE os_jobs SET status='leased',lease_token=?,leased_until=?,
      attempts=attempts+1,updated_at=? WHERE id=? AND attempts<max_attempts
      AND (status='queued' OR (status='leased' AND leased_until<?))`,[token,until,at,row.id,at]);
    if(Number(result.changes)!==1) return null;
    return {...row,lease_token:token,attempts:Number(row.attempts)+1,started_at:at};
  }).immediate();
}

async function executeRule(tx:Pick<Connection,'get'|'batch'>,job:Record<string,unknown>,at:string) {
  const event=await tx.get('SELECT source_type,source_id,event_type,payload_json FROM os_outbox WHERE id=?',[job.event_id]);
  if(!event||event.event_type!==job.rule_key) throw Object.assign(new Error('event_missing'),{code:'event_missing'});
  const sourceId=String(event.source_id),rule=String(job.rule_key);
  const payload=JSON.parse(String(event.payload_json)) as Record<string,unknown>;
  const statements:Statement[]=[];
  if(rule.startsWith('content.')) {
    const row=await tx.get(`SELECT p.id,p.brand_id,p.stage,p.on_hold,p.publication_state,
      p.current_version,p.assigned_user_id,p.due_at,b.status AS brand_status FROM content_pieces p
      JOIN content_brands b ON b.id=p.brand_id WHERE p.id=?`,[sourceId]);
    const version=Number(payload.version);
    const applicable=row&&row.brand_status==='active'&&Number(row.current_version)===version
      &&row.publication_state==='none'
      &&(rule==='content.script_pending'&&row.stage==='script'&&!row.on_hold
        ||rule==='content.review_requested'&&['script','visuals','review'].includes(String(row.stage))
        ||rule==='content.hold'&&row.on_hold
        ||rule==='content.due'&&row.due_at!==null&&!row.on_hold
        ||rule==='content.ready'&&row.stage==='ready'&&!row.on_hold);
    if(applicable){
      const label=rule==='content.script_pending'?'Preparar guion editorial'
        :rule==='content.review_requested'?'Revisar pieza editorial'
        :rule==='content.hold'?'Resolver bloqueo editorial'
        :rule==='content.due'?'Revisar fecha prevista de contenido'
        :'Registrar siguiente paso de publicación';
      const key=`${rule}:${sourceId}:${version}`,workId=randomUUID();
      statements.push({sql:`UPDATE os_work_items SET status='cancelled',
        cancel_reason='content_work_replaced' WHERE source_type='content_piece'
        AND source_id=? AND status='open' AND dedupe_key<>?`,args:[sourceId,key]});
      statements.push({sql:`INSERT OR IGNORE INTO os_work_items
        (id,kind,source_type,source_id,dedupe_key,title,priority,assigned_user_id,
        status,due_at,created_at) VALUES(?,?,'content_piece',?,?,?,?,?,'open',?,?)`,
        args:[workId,rule==='content.review_requested'?'review':'next_action',
          sourceId,key,label,rule==='content.hold'?'high':'normal',
          row.assigned_user_id?String(row.assigned_user_id):null,
          rule==='content.due'?String(row.due_at):null,at]});
      statements.push({sql:`INSERT OR IGNORE INTO content_work_links(work_item_id,piece_id,linked_at)
        SELECT id,?,? FROM os_work_items WHERE dedupe_key=?`,args:[sourceId,at,key]});
    }
  } else if(rule==='lead.review') {
    const row=await tx.get(`SELECT l.organization_id,l.linked_by,o.responsible_user_id
      FROM crm_source_links l JOIN crm_organizations o ON o.id=l.organization_id
      WHERE l.id=? AND l.digital_lead_id IS NOT NULL AND o.status='active'`,[sourceId]);
    if(row) statements.push({sql:`INSERT OR IGNORE INTO crm_tasks
      (id,organization_id,title,responsible_user_id,created_by,created_at,updated_at,automation_key)
      VALUES (?,?,'Revisar nuevo lead',?,?,?,?,?)`,args:[randomUUID(),String(row.organization_id),
      String(row.responsible_user_id),String(row.linked_by),at,at,`lead.review:${sourceId}`]});
  } else if(rule==='call.next') {
    const row=await tx.get(`SELECT a.organization_id,o.responsible_user_id FROM crm_activities a
      JOIN crm_organizations o ON o.id=a.organization_id
      WHERE a.id=? AND a.kind='call' AND o.status='active'
      AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.origin_activity_id=a.id
        AND t.status='open' AND t.cancelled_at IS NULL)`,[sourceId]);
    if(row) statements.push(work('next_action','crm_activity',sourceId,`call.next:${sourceId}`,
      'Definir próxima acción tras la llamada','normal',String(row.organization_id),null,
      String(row.responsible_user_id),at));
  } else if(rule==='sales.opportunity.guide') {
    const row=await tx.get(`SELECT q.organization_id,q.stage,q.version,q.responsible_user_id,
      o.status AS organization_status FROM crm_opportunities q
      JOIN crm_organizations o ON o.id=q.organization_id WHERE q.id=?`,[sourceId]);
    if(row&&row.organization_status==='active'&&Number(row.version)===Number(payload.stageVersion)
      &&!['won','lost'].includes(String(row.stage))) {
      statements.push({sql:`UPDATE os_work_items SET status='cancelled',
        cancel_reason='opportunity_stage_changed' WHERE source_type='crm_opportunity'
        AND source_id=? AND status='open' AND dedupe_key LIKE 'sales.opportunity.guide:%'
        AND dedupe_key<>?`,args:[sourceId,`sales.opportunity.guide:${sourceId}:${payload.stageVersion}`]});
      statements.push(work('next_action','crm_opportunity',sourceId,
        `sales.opportunity.guide:${sourceId}:${payload.stageVersion}`,
        'Preparar conversación y siguiente paso comercial','normal',String(row.organization_id),
        null,String(row.responsible_user_id),at));
    }
  } else if(rule==='opportunity.won'||rule==='opportunity.lost') {
    const row=await tx.get(`SELECT q.organization_id,q.stage,q.responsible_user_id,e.actor_user_id
      FROM crm_opportunities q JOIN crm_opportunity_stage_events e ON e.opportunity_id=q.id
      WHERE q.id=? AND e.to_stage=? ORDER BY e.opportunity_version DESC LIMIT 1`,
      [sourceId,rule.endsWith('won')?'won':'lost']);
    if(row&&row.stage==='won'&&rule.endsWith('won')) statements.push(work('opportunity',
      'crm_opportunity',sourceId,`opportunity.won:${sourceId}`,
      'Preparar siguientes pasos de la oportunidad ganada','high',String(row.organization_id),null,
      String(row.responsible_user_id),at));
    if(row&&['won','lost'].includes(String(row.stage)))statements.push({
      sql:`UPDATE os_work_items SET status='cancelled',cancel_reason='opportunity_closed'
        WHERE source_type='crm_opportunity' AND source_id=? AND status='open'
        AND dedupe_key LIKE 'sales.opportunity.guide:%'`,args:[sourceId]});
    if(row&&row.stage==='lost'&&rule.endsWith('lost')) statements.push({
      sql:`UPDATE crm_tasks SET cancelled_at=?,cancelled_by=?,cancel_reason='opportunity_lost',
        updated_at=? WHERE opportunity_id=? AND status='open' AND cancelled_at IS NULL`,
      args:[at,String(row.actor_user_id),at,sourceId]});
    if(row&&row.stage==='lost'&&rule.endsWith('lost')) statements.push({
      sql:`UPDATE os_work_items SET status='cancelled',cancel_reason='opportunity_lost'
        WHERE status='open' AND source_type='crm_activity' AND source_id IN
          (SELECT id FROM crm_activities WHERE opportunity_id=?)`,args:[sourceId]});
  } else if(rule.startsWith('proposal.')) {
    const row=await tx.get(`SELECT p.id,p.status,p.organization_id,p.title,p.expires_at,
      o.responsible_user_id FROM crm_proposals p JOIN crm_organizations o ON o.id=p.organization_id
      WHERE p.id=? AND o.status='active'`,[sourceId]);
    if(row&&rule==='proposal.sent'&&row.status==='sent') statements.push(notification(
      'proposal.sent','informational',`proposal.sent:${job.event_id}`,
      {resourceType:'crm_proposal',resourceId:sourceId},at));
    if(row&&rule==='proposal.responded'&&payload.eventKind==='changes_requested') {
      statements.push(work('proposal','crm_proposal',sourceId,
        `proposal.changes:${sourceId}:${payload.versionId}`,
        'Revisar cambios solicitados en la propuesta','high',String(row.organization_id),null,
        String(row.responsible_user_id),at));
      statements.push(notification('proposal.responded','important',
        `proposal.reply:${job.event_id}`,{resourceType:'crm_proposal',resourceId:sourceId},at));
    }
    if(row&&rule==='proposal.expired'&&row.status==='sent'&&row.expires_at
      &&String(row.expires_at)<=at) statements.push(work('proposal','crm_proposal',sourceId,
      `proposal.expired:${sourceId}:${payload.versionId??'scheduled'}`,
      'Revisar propuesta caducada','high',String(row.organization_id),null,
      String(row.responsible_user_id),at));
  } else if(rule==='cards.paid') {
    const row=await tx.get(`SELECT p.id FROM pedidos_tarjetas p WHERE p.id=?
      AND p.stripe_entorno='test' AND p.pagado_en IS NOT NULL
      AND EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
        AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado')`,[sourceId]);
    if(row) {
      const jobExists=await tx.get('SELECT order_id FROM cards_production_jobs WHERE order_id=?',[sourceId]);
      if(!jobExists) statements.push(work('cards','card_order',sourceId,`cards.paid:${sourceId}`,
        'Preparar pedido pagado','high',null,sourceId,null,at));
      statements.push(notification('cards.paid','important',`cards.paid:${sourceId}`,
        {resourceType:'card_order',resourceId:sourceId},at));
    }
  } else if(rule==='cards.incident') {
    const row=await tx.get(`SELECT i.order_id,i.severity,i.status FROM cards_production_incidents i
      JOIN pedidos_tarjetas p ON p.id=i.order_id WHERE i.id=? AND p.stripe_entorno='test'`,[sourceId]);
    if(row&&row.status==='open') {
      statements.push(work('incident','card_incident',sourceId,`cards.incident:${sourceId}`,
        'Revisar incidencia de producción',row.severity==='blocking'?'urgent':'high',
        null,String(row.order_id),null,at));
      statements.push(notification('cards.incident',row.severity==='blocking'?'urgent':'important',
        `cards.incident:${sourceId}`,{resourceType:'card_incident',resourceId:sourceId},at));
    }
  } else if(rule==='cards.link.alert') {
    const row=await tx.get(`SELECT l.order_id,l.status FROM cards_dynamic_links l
      JOIN pedidos_tarjetas p ON p.id=l.order_id WHERE l.id=? AND p.stripe_entorno='test'`,[sourceId]);
    if(row&&row.status!=='active') {
      statements.push(work('link_alert','card_link',sourceId,`cards.link.alert:${sourceId}`,
        'Revisar enlace Cards pausado o retirado','urgent',null,String(row.order_id),null,at));
      statements.push(notification('cards.link.alert','urgent',`cards.link.alert:${sourceId}`,
        {resourceType:'card_link',resourceId:sourceId},at));
    }
  } else if(rule==='cards.delivered') {
    const row=await tx.get(`SELECT j.order_id FROM cards_production_jobs j
      JOIN pedidos_tarjetas p ON p.id=j.order_id WHERE j.order_id=?
      AND j.stage='delivered' AND p.stripe_entorno='test'`,[sourceId]);
    if(row) statements.push(work('aftersales','card_order',sourceId,`cards.delivered:${sourceId}`,
      'Preparar seguimiento posventa','normal',null,sourceId,null,at,plus(7*24*60*60_000)));
  } else throw Object.assign(new Error('unknown_rule'),{code:'unknown_rule'});
  statements.push(audit(`os.rule.${rule}`,'automation_job',String(job.id),at));
  await tx.batch(statements);
}

export async function processOneJob(db:Connection) {
  const job=await claimJob(db);
  if(!job) return false;
  try {
    await db.transactionAsync(async tx=>{
      await assertCardsTest(tx);
      await executeRule(tx,job,iso());
      const at=iso();
      const result=await tx.run(`UPDATE os_jobs SET status='done',lease_token=NULL,
        leased_until=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_token=?`,
        [at,job.id,job.lease_token]);
      if(Number(result.changes)!==1) throw Object.assign(new Error('stale_lease'),{code:'stale_lease'});
      await tx.run(`INSERT INTO os_job_attempts
        (id,job_id,lease_token,started_at,finished_at,outcome)
        VALUES (?,?,?,?,?,'success')`,[randomUUID(),job.id,job.lease_token,job.started_at,at]);
    }).immediate();
  } catch(error) {
    const code=safeErrorCode(error),dead=Number(job.attempts)>=Number(job.max_attempts),at=iso();
    await db.transactionAsync(async tx=>{
      const result=await tx.run(`UPDATE os_jobs SET status=?,lease_token=NULL,leased_until=NULL,
        run_at=?,last_error_code=?,updated_at=? WHERE id=? AND status='leased' AND lease_token=?`,
        [dead?'dead':'queued',dead?at:plus(retryDelayMs(Number(job.attempts))),code,at,
          job.id,job.lease_token]);
      if(Number(result.changes)===1) await tx.run(`INSERT INTO os_job_attempts
        (id,job_id,lease_token,started_at,finished_at,outcome,error_code)
        VALUES (?,?,?,?,?,?,?)`,[randomUUID(),job.id,job.lease_token,job.started_at,at,
          dead?'dead':'retry',code]);
    }).immediate();
  }
  return true;
}

export async function prepareDailyBrief(db:Connection,date=new Date(),force=false) {
  await assertCardsTest(db);
  const config=await db.get(`SELECT enabled,local_time FROM os_rule_config WHERE rule_key='daily.brief'`);
  if(!config||Number(config.enabled)!==1||(!force&&(!config.local_time||madridTime(date)<String(config.local_time)))) return false;
  const day=madridDay(date);
  if(await db.get('SELECT day_madrid FROM os_daily_briefs WHERE day_madrid=?',[day])) return false;
  const owner=await db.get(`SELECT u.id,u.email,coalesce(u.display_name,u.email) AS display_name
    FROM altaria_admin_users u JOIN altaria_admin_user_roles r ON r.user_id=u.id
    WHERE u.status='active' AND r.role_key='owner' ORDER BY u.created_at LIMIT 1`);
  if(!owner) return false;
  const principal:AdminPrincipal={id:String(owner.id),email:String(owner.email),
    displayName:String(owner.display_name),roles:['owner'],sessionHash:'automation-system'};
  const snapshot=briefFromWork(await listMyWork(principal,db,date),date);
  return db.transactionAsync(async tx=>{
    if(await tx.get('SELECT day_madrid FROM os_daily_briefs WHERE day_madrid=?',[day])) return false;
    const at=iso(),notificationId=randomUUID();
    await tx.batch([{sql:`INSERT INTO os_notifications
      (id,channel,template_key,urgency,dedupe_key,payload_json,status,run_at,created_at)
      VALUES (?,'telegram_simulated','daily.brief','informational',?,?,'queued',?,?)`,
      args:[notificationId,`daily.brief:${day}`,JSON.stringify({resourceType:'daily_brief',
        resourceId:day,day,count:snapshot.actions.length,briefCounts:snapshot.counts}),at,at]},
    {sql:`INSERT INTO os_daily_briefs(day_madrid,snapshot_json,generated_at,telegram_notification_id)
      VALUES (?,?,?,?)`,args:[day,JSON.stringify(snapshot),at,notificationId]},
    audit('os.brief.generate','daily_brief',day,at)]);
    return true;
  }).immediate();
}

export async function processOneNotification(db:Connection,adapter:TelegramAdapter=simulatedTelegram) {
  await assertCardsTest(db);
  const claim=await db.transactionAsync(async tx=>{
    const at=iso();
    const exhausted=await tx.all(`SELECT id,lease_token FROM os_notifications
      WHERE status='leased' AND leased_until<? AND attempts>=max_attempts LIMIT 50`,[at]);
    for(const row of exhausted) await tx.run(`INSERT INTO os_notification_attempts
      (id,notification_id,lease_token,occurred_at,outcome,error_code)
      VALUES (?,?,?,?,'dead','lease_exhausted')`,[randomUUID(),row.id,row.lease_token,at]);
    await tx.run(`UPDATE os_notifications SET status='dead',lease_token=NULL,
      leased_until=NULL,last_error_code='lease_exhausted' WHERE id IN
      (SELECT id FROM os_notifications WHERE status='leased' AND leased_until<?
        AND attempts>=max_attempts LIMIT 50)`,[at]);
    const row=await tx.get(`SELECT n.* FROM os_notifications n
      JOIN os_rule_config r ON r.rule_key='telegram.simulated' AND r.enabled=1
      WHERE n.run_at<=? AND (n.status='queued' OR (n.status='leased' AND n.leased_until<?))
      ORDER BY n.run_at LIMIT 1`,[at,at]);
    if(!row) return null;
    if(row.status==='leased'&&row.lease_token) await tx.run(`INSERT INTO os_notification_attempts
      (id,notification_id,lease_token,occurred_at,outcome,error_code)
      VALUES (?,?,?,?,'retry','lease_expired')`,[randomUUID(),row.id,row.lease_token,at]);
    const token=randomUUID();
    const updated=await tx.run(`UPDATE os_notifications SET status='leased',lease_token=?,
      leased_until=?,attempts=attempts+1 WHERE id=? AND attempts<max_attempts
      AND (status='queued' OR (status='leased' AND leased_until<?))`,
      [token,new Date(Date.parse(at)+90_000).toISOString(),row.id,at]);
    return Number(updated.changes)===1?{...row,lease_token:token,attempts:Number(row.attempts)+1}:null;
  }).immediate();
  if(!claim) return false;
  let errorCode:string|null=null;
  try {
    const payload=JSON.parse(String(claim.payload_json)) as TelegramPayload;
    renderTelegram(String(claim.template_key),claim.urgency as Urgency,payload);
    const response=await adapter.deliver({template:String(claim.template_key),
      urgency:claim.urgency as Urgency,payload});
    if(response.result!=='simulated') throw Object.assign(new Error('unexpected_adapter'),{code:'unexpected_adapter'});
  } catch(error) {errorCode=safeErrorCode(error);}
  const at=iso(),dead=Boolean(errorCode)&&Number(claim.attempts)>=Number(claim.max_attempts);
  await db.transactionAsync(async tx=>{
    const changed=await tx.run(`UPDATE os_notifications SET status=?,lease_token=NULL,
      leased_until=NULL,run_at=?,last_error_code=?,delivered_at=?
      WHERE id=? AND status='leased' AND lease_token=?`,
      [errorCode?(dead?'dead':'queued'):'delivered',errorCode&&!dead
        ?plus(retryDelayMs(Number(claim.attempts))):at,errorCode,errorCode?null:at,
      claim.id,claim.lease_token]);
    if(Number(changed.changes)!==1) return;
    await tx.batch([{sql:`INSERT INTO os_notification_attempts
      (id,notification_id,lease_token,occurred_at,outcome,error_code)
      VALUES (?,?,?,?,?,?)`,args:[randomUUID(),String(claim.id),String(claim.lease_token),at,
      errorCode?(dead?'dead':'retry'):'delivered',errorCode]},
      audit('os.notification.simulate','notification',String(claim.id),at)]);
  }).immediate();
  return true;
}

export async function runAutomationTick(db:Connection=getDatabase(),options:{limit?:number;adapter?:TelegramAdapter}={}) {
  await assertCardsTest(db);
  const limit=Math.max(1,Math.min(25,options.limit??10));
  const reconciled=await reconcileTestEvents(db);
  const dispatched=await dispatchOutbox(db,limit);
  const expiredApprovals=await expireApprovals(db);
  let jobs=0,notifications=0;
  for(;jobs<limit&&await processOneJob(db);jobs++);
  await prepareDailyBrief(db);
  for(;notifications<limit&&await processOneNotification(db,options.adapter);notifications++);
  return {reconciled,dispatched,expiredApprovals,jobs,notifications};
}
