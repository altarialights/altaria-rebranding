import {createHash} from 'node:crypto';
import type {Connection} from '@tursodatabase/serverless';
import {getDatabase} from '../../db/client';
import {hasAdminPermission,type AdminPrincipal} from '../access';
import {assertCardsTest,listCardOrders} from '../cards/service';
import {getOrganization,listOrganizations} from '../crm/queries';
import {getSalesEntry} from '../sales/library';
import {listBrands,listPieces,getPiece} from '../content/service';
import {requireBrand,uuid} from '../content/model';
import {listPendingContentReviews} from '../content/workflow';
import {McpError} from './auth';

export type ReadToolName=
  'crm_search_companies'|'crm_get_company'|'crm_list_contacts'|'crm_list_opportunities'
  |'crm_followups_needed'|'crm_list_pending_proposals'|'crm_list_tasks'|'crm_list_timeline'
  |'sales_find_approved'|'sales_find_objections'
  |'sales_get_template'|'sales_suggest_materials'|'cards_list_orders'|'cards_needing_production'
  |'cards_get_production'
  |'cards_list_batches'|'cards_list_incidents'|'cards_aggregate_stats'|'content_list_brands'
  |'content_calendar'|'content_get_piece'|'content_list_states'|'content_list_tasks'
  |'content_list_approvals'|'content_get_approved_guide';
export const readToolNames:ReadToolName[]=[
  'crm_search_companies','crm_get_company','crm_list_contacts','crm_list_opportunities',
  'crm_followups_needed','crm_list_pending_proposals',
  'crm_list_tasks','crm_list_timeline','sales_find_approved','sales_find_objections',
  'sales_get_template','sales_suggest_materials','cards_list_orders','cards_needing_production',
  'cards_get_production',
  'cards_list_batches','cards_list_incidents','cards_aggregate_stats','content_list_brands',
  'content_calendar','content_get_piece','content_list_states','content_list_tasks',
  'content_list_approvals','content_get_approved_guide'];
type Args={id?:string;organizationId?:string;orderId?:string;brandId?:string;q?:string;
  status?:string;from?:string;to?:string;limit?:number;offset?:number;
  dateKind?:'editorial_due'|'publication_scheduled'};
const limit=(a:Args)=>Math.min(Math.max(Number(a.limit??10),1),20);
const offset=(a:Args)=>Math.min(Math.max(Number(a.offset??0),0),200);
const page=(rows:unknown[],a:Args)=>({items:rows.slice(offset(a),offset(a)+limit(a)),
  nextOffset:rows.length>offset(a)+limit(a)?offset(a)+limit(a):null});
// Midnight in Europe/Madrid uses the offset at the preceding local noon. DST changes
// occur after midnight, so this preserves the correct boundary on transition days.
export function madridMidnight(date:string){
  const utc=Date.parse(`${date}T00:00:00.000Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(utc)
    ||new Date(utc).toISOString().slice(0,10)!==date)throw new McpError('invalid_date');
  const zone=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Madrid',
    timeZoneName:'shortOffset'}).formatToParts(new Date(utc-12*60*60_000))
    .find(part=>part.type==='timeZoneName')?.value;
  const match=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone??'');
  if(!match)throw new McpError('invalid_timezone',503);
  const minutes=(Number(match[2])*60+Number(match[3]??0))*(match[1]==='+'?1:-1);
  return new Date(utc-minutes*60_000).toISOString();
}
function madridWindow(a:Args){
  if(a.from&&a.to&&a.from>a.to)throw new McpError('invalid_date_range');
  const next=a.to?new Date(Date.parse(`${a.to}T00:00:00.000Z`)+86_400_000)
    .toISOString().slice(0,10):null;
  return {from:a.from?madridMidnight(a.from):null,to:next?madridMidnight(next):null};
}
const forbidden=()=>{throw new McpError('forbidden',403);};
const requirePermission=(p:AdminPrincipal,k:'crm:read'|'cards:read'|'content:read')=>
  hasAdminPermission(p,k)||forbidden();
async function organization(p:AdminPrincipal,id:string,db:Connection){
  requirePermission(p,'crm:read');
  if(!uuid.test(id))throw new McpError('invalid_id');
  const row=await getOrganization(p,id,db);
  if(!row)throw new McpError('not_found',404);
  return row;
}
async function order(id:string,db:Connection){
  if(!uuid.test(id))throw new McpError('invalid_id');
  const row=await db.get(`SELECT p.id,p.numero_pedido,p.estado,p.pagado_en,p.creado_en,
    EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
      AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado') AS payment_confirmed
    FROM pedidos_tarjetas p WHERE p.id=? AND p.stripe_entorno='test'`,[id]);
  if(!row)throw new McpError('not_found',404);
  return row;
}
async function minimalSales(p:AdminPrincipal,row:Record<string,unknown>,db:Connection){
  const verified=await getSalesEntry(p,String(row.id),db,Number(row.approved_version));
  const v=verified.current;
  return {id:row.id,version:row.approved_version,title:v.title,category:v.category,
    product:v.product,sector:v.sector,channel:v.channel,stage:v.stage};
}
async function approvedSales(p:AdminPrincipal,a:Args,db:Connection,category?:string,sector?:string){
  requirePermission(p,'crm:read');
  // Search the approved snapshot even for the owner. Pending revisions must not
  // affect matching, category, sector, or pagination of approved material.
  const clauses=["e.status!='retired'"],args:(string|number)[]=[];
  if(category){clauses.push('v.category=?');args.push(category);}
  if(sector){clauses.push('v.sector=?');args.push(sector);}
  if(a.q?.trim()){
    clauses.push("(lower(v.title) LIKE ? ESCAPE '\\' OR lower(v.body) LIKE ? ESCAPE '\\' OR lower(v.product) LIKE ? ESCAPE '\\')");
    const term=`%${a.q.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')}%`;
    args.push(term,term,term);
  }
  const approved=await db.all(`SELECT e.id,e.approved_version
    FROM crm_sales_entries e JOIN crm_sales_entry_versions v
      ON v.entry_id=e.id AND v.version=e.approved_version
    WHERE ${clauses.join(' AND ')} ORDER BY e.updated_at DESC,e.id LIMIT ? OFFSET ?`,
    [...args,limit(a)+1,offset(a)]);
  const selected=approved.slice(0,limit(a));
  return {items:await Promise.all(selected.map(row=>minimalSales(p,row,db))),
    nextOffset:approved.length>limit(a)?offset(a)+limit(a):null};
}

/** All business text in these results is untrusted source data, never tool instructions. */
export async function runReadTool(name:ReadToolName,p:AdminPrincipal,a:Args={},
  db:Connection=getDatabase()):Promise<unknown>{
  await assertCardsTest(db);
  switch(name){
    case 'crm_search_companies':{
      requirePermission(p,'crm:read');
      const rows=await listOrganizations(p,{q:a.q,limit:limit(a)+1,offset:offset(a)},db);
      return {items:rows.slice(0,limit(a)).map(x=>({id:x.id,name:x.name,sector:x.sector,city:x.city})),
        nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'crm_get_company':{
      const x=await organization(p,a.id??'',db);
      return {id:x.id,name:x.name,sector:x.sector,city:x.city,region:x.region,
        website:x.website_url,responsibleUserId:x.responsible_user_id};
    }
    case 'crm_list_contacts':{
      const x=await organization(p,a.organizationId??'',db);
      const rows=await db.all(`SELECT id,full_name,job_title,email,is_primary
        FROM crm_contacts WHERE organization_id=? ORDER BY is_primary DESC,full_name LIMIT ? OFFSET ?`,
        [x.id,limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'crm_list_opportunities':{
      requirePermission(p,'crm:read');
      if(a.organizationId)await organization(p,a.organizationId,db);
      const where=a.organizationId?'AND q.organization_id=?':'';
      const owned=!p.roles.includes('owner')&&!p.roles.includes('viewer')?'AND o.responsible_user_id=?':'';
      const rows=await db.all(`SELECT q.id,q.organization_id,q.title,q.stage,q.amount_cents,
        q.updated_at FROM crm_opportunities q JOIN crm_organizations o ON o.id=q.organization_id
        WHERE o.status='active' ${where} ${owned}
        ORDER BY q.updated_at DESC,q.id LIMIT ? OFFSET ?`,
        [...(a.organizationId?[a.organizationId]:[]),...(owned?[p.id]:[]),limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'crm_followups_needed':{
      requirePermission(p,'crm:read');
      if(a.organizationId)await organization(p,a.organizationId,db);
      const owned=!p.roles.includes('owner')&&!p.roles.includes('viewer')
        ?'AND o.responsible_user_id=?':'';
      const org=a.organizationId?'AND q.organization_id=?':'';
      const now=new Date().toISOString();
      const rows=await db.all(`SELECT q.id,q.organization_id,q.title,q.stage,
        (SELECT MIN(t.due_at) FROM crm_tasks t WHERE t.opportunity_id=q.id
          AND t.status='open' AND t.cancelled_at IS NULL AND t.due_at<=?) AS due_at,
        EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=q.id
          AND t.status='open' AND t.cancelled_at IS NULL AND t.due_at IS NOT NULL)
          AS has_scheduled_task
        FROM crm_opportunities q JOIN crm_organizations o ON o.id=q.organization_id
        WHERE o.status='active' AND q.stage NOT IN ('won','lost') ${org} ${owned}
          AND (EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=q.id
            AND t.status='open' AND t.cancelled_at IS NULL AND t.due_at<=?)
            OR NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=q.id
              AND t.status='open' AND t.cancelled_at IS NULL AND t.due_at IS NOT NULL))
        ORDER BY due_at IS NULL,due_at,q.updated_at,q.id LIMIT ? OFFSET ?`,
        [now,...(a.organizationId?[a.organizationId]:[]),...(owned?[p.id]:[]),
          now,limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)).map(x=>({id:x.id,organizationId:x.organization_id,
        title:x.title,stage:x.stage,dueAt:x.due_at,
        reason:Number(x.has_scheduled_task)===1?'due_task':'no_scheduled_task'})),
        nextOffset:rows.length>limit(a)?offset(a)+limit(a):null,
        note:'Sin tarea con fecha significa seguimiento no programado; no implica urgencia.'};
    }
    case 'crm_list_pending_proposals':{
      requirePermission(p,'crm:read');
      if(a.organizationId)await organization(p,a.organizationId,db);
      const org=a.organizationId?'AND p.organization_id=?':'';
      const owned=!p.roles.includes('owner')&&!p.roles.includes('viewer')
        ?'AND o.responsible_user_id=?':'';
      const rows=await db.all(`SELECT p.id,p.organization_id,p.opportunity_id,p.title,
        p.status,p.current_version,p.sent_at,p.expires_at,p.updated_at
        FROM crm_proposals p JOIN crm_organizations o ON o.id=p.organization_id
        WHERE o.status='active' AND p.status IN ('draft','sent') ${org} ${owned}
        ORDER BY CASE p.status WHEN 'sent' THEN 0 ELSE 1 END,
          p.expires_at IS NULL,p.expires_at,p.updated_at DESC,p.id LIMIT ? OFFSET ?`,
        [...(a.organizationId?[a.organizationId]:[]),...(owned?[p.id]:[]),
          limit(a)+1,offset(a)]);
      const now=new Date().toISOString();
      return {items:rows.slice(0,limit(a)).map(x=>({...x,
        pendingKind:x.status==='sent'?'awaiting_response':'draft_for_review',
        pastExpiry:x.status==='sent'&&Boolean(x.expires_at&&String(x.expires_at)<now)})),
        nextOffset:rows.length>limit(a)?offset(a)+limit(a):null,
        note:'Borrador y enviada sin decisión son estados distintos; caducidad pasada requiere revisión.'};
    }
    case 'crm_list_tasks':{
      requirePermission(p,'crm:read');
      if(a.organizationId)await organization(p,a.organizationId,db);
      const where=a.organizationId?'AND t.organization_id=?':'';
      const owned=!p.roles.includes('owner')&&!p.roles.includes('viewer')?'AND o.responsible_user_id=?':'';
      const rows=await db.all(`SELECT t.id,t.organization_id,t.opportunity_id,t.title,t.due_at,
        t.status,t.responsible_user_id FROM crm_tasks t
        JOIN crm_organizations o ON o.id=t.organization_id
        WHERE o.status='active' AND t.cancelled_at IS NULL ${where} ${owned}
        ORDER BY t.due_at IS NULL,t.due_at,t.id LIMIT ? OFFSET ?`,
        [...(a.organizationId?[a.organizationId]:[]),...(owned?[p.id]:[]),limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'crm_list_timeline':{
      const x=await organization(p,a.organizationId??'',db);
      const rows=await db.all(`SELECT id,event_type,entity_id,occurred_at FROM crm_timeline_events
        WHERE organization_id=? ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
        [x.id,limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'sales_find_approved':return approvedSales(p,a,db);
    case 'sales_find_objections':return approvedSales(p,a,db,'objection');
    case 'sales_get_template':{
      requirePermission(p,'crm:read');
      if(!uuid.test(a.id??''))throw new McpError('invalid_id');
      const meta=await db.get(`SELECT approved_version,status FROM crm_sales_entries WHERE id=?`,[a.id]);
      if(!meta?.approved_version||meta.status==='retired')throw new McpError('not_found',404);
      const entry=await getSalesEntry(p,a.id!,db,Number(meta.approved_version));
      const v=entry.current;
      return {id:a.id,version:meta.approved_version,title:v.title,category:v.category,
        body:v.body,nextStep:v.next_step,provenance:v.provenance,sourceRef:v.source_ref};
    }
    case 'sales_suggest_materials':{
      const x=await organization(p,a.organizationId??'',db);
      const approved=await approvedSales(p,{...a,limit:Math.min(limit(a),5)},db,
        undefined,x.sector??'general');
      return {companyId:x.id,sector:x.sector,
        suggestions:approved.items,nextOffset:approved.nextOffset,
        note:'Selección por sector; no infiere necesidades ni autoriza comunicaciones.'};
    }
    case 'cards_list_orders':{
      requirePermission(p,'cards:read');
      const rows=await listCardOrders(p,{status:a.status,q:a.q,limit:Math.min(200,offset(a)+limit(a)+1)},db);
      return page(rows.map(x=>({id:x.id,number:x.numero_pedido,product:x.producto_nombre,
        quantity:x.cantidad,orderStatus:x.estado,productionStage:x.stage,
        paidConfirmed:Number(x.payment_confirmed)===1,priority:x.priority,
        createdAt:x.creado_en})),a);
    }
    case 'cards_needing_production':{
      requirePermission(p,'cards:read');
      const rows=await db.all(`SELECT p.id,p.numero_pedido,p.producto_nombre,p.cantidad,
        p.creado_en,coalesce(j.stage,'not_started') AS stage,
        coalesce(j.priority,'normal') AS priority
        FROM pedidos_tarjetas p LEFT JOIN cards_production_jobs j ON j.order_id=p.id
        WHERE p.stripe_entorno='test' AND p.pagado_en IS NOT NULL
          AND p.estado IN ('pagado','preparando')
          AND (j.stage IS NULL OR j.stage IN
            ('preparation','production','verification'))
          AND EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
            AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado')
        ORDER BY CASE coalesce(j.priority,'normal') WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1 ELSE 2 END,p.creado_en,p.id LIMIT ? OFFSET ?`,
        [limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)
        ?offset(a)+limit(a):null,note:'Pago TEST confirmado; etapa de producción independiente.'};
    }
    case 'cards_get_production':{
      requirePermission(p,'cards:read');const x=await order(a.orderId??'',db);
      const job=await db.get(`SELECT stage,priority,updated_at,shipped_at,delivered_at
        FROM cards_production_jobs WHERE order_id=?`,[x.id]);
      return {orderId:x.id,orderNumber:x.numero_pedido,orderStatus:x.estado,
        paidConfirmed:Boolean(x.pagado_en)&&Number(x.payment_confirmed)===1
          &&['pagado','preparando','enviado','entregado'].includes(String(x.estado)),
        production:job??null};
    }
    case 'cards_list_batches':{
      requirePermission(p,'cards:read');const x=await order(a.orderId??'',db);
      const rows=await db.all(`SELECT id,mode,quantity,created_at FROM cards_batches
        WHERE order_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`,[x.id,limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'cards_list_incidents':{
      requirePermission(p,'cards:read');const x=await order(a.orderId??'',db);
      const rows=await db.all(`SELECT id,severity,status,summary,created_at,resolved_at
        FROM cards_production_incidents WHERE order_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [x.id,limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'cards_aggregate_stats':{
      requirePermission(p,'cards:read');
      const orderStats=await db.all(`SELECT coalesce(j.stage,'not_started') AS stage,count(*) AS count
        FROM pedidos_tarjetas p LEFT JOIN cards_production_jobs j ON j.order_id=p.id
        WHERE p.stripe_entorno='test' GROUP BY coalesce(j.stage,'not_started')`);
      const openings=await db.get(`SELECT coalesce(sum(m.openings),0) AS openings
        FROM cards_link_daily_metrics m JOIN cards_dynamic_links l ON l.id=m.link_id
        JOIN pedidos_tarjetas p ON p.id=l.order_id WHERE p.stripe_entorno='test'`);
      return {ordersByProductionStage:orderStats,qrNfcOpenings:Number(openings?.openings??0),
        note:'Aperturas agregadas; no equivalen a personas ni ventas.'};
    }
    case 'content_list_brands':{
      requirePermission(p,'content:read');
      const rows=await listBrands(p,db);
      return {items:rows.map(x=>({id:x.id,name:x.name,status:x.status,channel:x.channel,
        channelStatus:x.channel_status}))};
    }
    case 'content_calendar':{
      requirePermission(p,'content:read');
      if(!a.from||!a.to||Date.parse(`${a.to}T00:00:00Z`)
        -Date.parse(`${a.from}T00:00:00Z`)>31*86_400_000)
        throw new McpError('date_range_required');
      if(a.brandId)requireBrand(p,a.brandId,'read');
      const ids=p.roles.includes('owner')?null:(p.contentGrants??[])
        .filter(x=>x.read).map(x=>x.brandId);
      if(ids?.length===0)return {items:[],nextOffset:null};
      const window=madridWindow(a);
      const publication=a.dateKind==='publication_scheduled';
      const dateColumn=publication?'r.scheduled_at':'p.due_at';
      const join=publication?`JOIN content_publication_records r ON r.piece_id=p.id
        AND r.status='scheduled' AND p.publication_state='scheduled'`:'';
      const brand=a.brandId?'AND p.brand_id=?':ids?
        `AND p.brand_id IN (${ids.map(()=>'?').join(',')})`:'';
      const rows=await db.all(`SELECT p.id,p.brand_id,p.title,p.channel,p.stage,
        p.publication_state,p.due_at,${publication?'r.scheduled_at':'NULL'} AS scheduled_at
        FROM content_pieces p ${join}
        WHERE ${dateColumn}>=? AND ${dateColumn}<? ${brand}
        ORDER BY ${dateColumn},p.id LIMIT ? OFFSET ?`,
        [window.from,window.to,...(a.brandId?[a.brandId]:ids??[]),
          limit(a)+1,offset(a)]);
      return {dateKind:publication?'publication_scheduled':'editorial_due',
        timezone:'Europe/Madrid',items:rows.slice(0,limit(a)).map(x=>({id:x.id,
          brandId:x.brand_id,title:x.title,channel:x.channel,stage:x.stage,
          publicationState:x.publication_state,dueAt:x.due_at,
          scheduledAt:x.scheduled_at})),
        nextOffset:rows.length>limit(a)?offset(a)+limit(a):null,
        note:publication?'Programada; no equivale a publicada.':'Fecha de trabajo editorial; no equivale a publicación.'};
    }
    case 'content_list_states':{
      requirePermission(p,'content:read');
      if(a.brandId)requireBrand(p,a.brandId,'read');
      const rows=await listPieces(p,{brandId:a.brandId,stage:a.status,q:a.q},db);
      return page(rows.map(x=>({id:x.id,brandId:x.brand_id,title:x.title,
        channel:x.channel,stage:x.stage,publicationState:x.publication_state,
        dueAt:x.due_at,assignedUserId:x.assigned_user_id,
        pendingReviews:Number(x.pending_reviews)})),a);
    }
    case 'content_get_piece':{
      requirePermission(p,'content:read');
      const x=await getPiece(p,a.id??'',db);
      return {id:x.piece.id,brandId:x.piece.brand_id,channel:x.piece.channel,
        stage:x.piece.stage,publicationState:x.piece.publication_state,
        version:x.piece.current_version,title:x.current.title,objective:x.current.objective,
        script:x.current.script,copy:x.current.copy,dueAt:x.piece.due_at,
        resources:x.assets.filter(y=>Number(y.version)===Number(x.piece.current_version))
          .map(y=>({id:y.id,mime:y.mime_type,class:y.asset_class}))};
    }
    case 'content_list_tasks':{
      requirePermission(p,'content:read');
      const ids=p.roles.includes('owner')?null:(p.contentGrants??[]).filter(x=>x.read).map(x=>x.brandId);
      if(ids?.length===0)return {items:[],nextOffset:null};
      if(a.brandId)requireBrand(p,a.brandId,'read');
      const brandWhere=a.brandId?'AND c.brand_id=?':ids?`AND c.brand_id IN (${ids.map(()=>'?').join(',')})`:'';
      const rows=await db.all(`SELECT w.id,w.title,w.status,w.priority,w.due_at,c.id AS piece_id,
        c.brand_id FROM os_work_items w JOIN content_pieces c ON c.id=w.source_id
        WHERE w.source_type='content_piece' AND w.status='open' ${brandWhere}
        ORDER BY w.due_at IS NULL,w.due_at LIMIT ? OFFSET ?`,
        [...(a.brandId?[a.brandId]:ids??[]),limit(a)+1,offset(a)]);
      return {items:rows.slice(0,limit(a)),nextOffset:rows.length>limit(a)?offset(a)+limit(a):null};
    }
    case 'content_list_approvals':{
      requirePermission(p,'content:read');
      const rows=await listPendingContentReviews(p,db);
      return page(rows.map(x=>({id:x.id,pieceId:x.piece_id,brandId:x.brand_id,
        stage:x.review_stage,version:x.version,requestedAt:x.requested_at})),a);
    }
    case 'content_get_approved_guide':{
      requirePermission(p,'content:read');requireBrand(p,a.brandId??'','read');
      const row=await db.get(`SELECT version,identity_text,objectives_text,audience_text,tone_text,
        colors_text,typography_text,visual_rules_text,formats_text,approved_examples_text,
        restrictions_text,sha256 FROM content_brand_guide_versions
        WHERE brand_id=? AND status='approved' ORDER BY version DESC LIMIT 1`,[a.brandId]);
      if(!row)throw new McpError('not_found',404);
      const values=['identity_text','objectives_text','audience_text','tone_text','colors_text',
        'typography_text','visual_rules_text','formats_text','approved_examples_text',
        'restrictions_text'].map(key=>row[key]);
      const sha=createHash('sha256').update(JSON.stringify(values)).digest('hex');
      if(sha!==row.sha256)throw new McpError('integrity_failed',503);
      return {brandId:a.brandId,version:row.version,identity:row.identity_text,
        audience:row.audience_text,tone:row.tone_text,visualRules:row.visual_rules_text,
        restrictions:row.restrictions_text};
    }
  }
}
export function canListReadTool(name:ReadToolName,p:AdminPrincipal){
  return name.startsWith('crm_')||name.startsWith('sales_')
    ?hasAdminPermission(p,'crm:read')
    :name.startsWith('cards_')?hasAdminPermission(p,'cards:read')
    :hasAdminPermission(p,'content:read');
}
