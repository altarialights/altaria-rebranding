import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { assertCardsTest } from '../cards/service';
import { madridDay } from './common';

export type WorkPriority = 'normal' | 'high' | 'urgent';
export interface WorkEntry {
  key: string; category: 'crm' | 'proposal' | 'cards' | 'incident' | 'approval' | 'alert' | 'content';
  title: string; context: string; priority: WorkPriority; dueAt: string | null;
  href: string; completion: 'crm_task' | 'work_item' | null; id: string;
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class WorkError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const priorityRank = { urgent: 0, high: 1, normal: 2 };

export async function listMyWork(principal: AdminPrincipal, db: Connection = getDatabase(), at = new Date()) {
  if (!hasAdminPermission(principal,'admin:read')) throw new WorkError('forbidden',403);
  await assertCardsTest(db);
  const owner=principal.roles.includes('owner');
  const canCrm=hasAdminPermission(principal,'crm:read');
  const canCards=hasAdminPermission(principal,'cards:read');
  const canCrmWrite=hasAdminPermission(principal,'crm:write');
  const canCardsWrite=hasAdminPermission(principal,'cards:write');
  const output: WorkEntry[]=[];
  if (canCrm) {
    const tasks=await db.all(`SELECT t.id,t.title,t.due_at,t.organization_id,o.name,
      t.responsible_user_id FROM crm_tasks t JOIN crm_organizations o ON o.id=t.organization_id
      WHERE t.status='open' AND t.cancelled_at IS NULL AND o.status='active'
        AND (?=1 OR ?=1 OR t.responsible_user_id=?)
      ORDER BY t.due_at IS NULL,t.due_at LIMIT 100`,[owner?1:0,principal.roles.includes('viewer')?1:0,principal.id]);
    for(const row of tasks) output.push({key:`crm:${row.id}`,category:'crm',title:String(row.title),
      context:String(row.name),priority:row.due_at&&String(row.due_at)<at.toISOString()?'urgent':'normal',
      dueAt:row.due_at?String(row.due_at):null,href:`/admin/crm/empresas/${row.organization_id}#tareas`,
      completion:canCrmWrite?'crm_task':null,id:String(row.id)});
    const proposals=await db.all(`SELECT p.id,p.title,p.expires_at,p.organization_id,o.name
      FROM crm_proposals p JOIN crm_organizations o ON o.id=p.organization_id
      WHERE p.status='sent' AND o.status='active' AND (?=1 OR ?=1 OR o.responsible_user_id=?)
        AND NOT EXISTS(SELECT 1 FROM crm_proposal_followups f
          JOIN crm_proposal_versions v ON v.id=f.version_id
          JOIN crm_tasks t ON t.id=f.task_id
          WHERE v.proposal_id=p.id AND t.status='open' AND t.cancelled_at IS NULL)
      ORDER BY p.sent_at LIMIT 50`,[owner?1:0,principal.roles.includes('viewer')?1:0,principal.id]);
    for(const row of proposals) output.push({key:`proposal:${row.id}`,category:'proposal',
      title:`Revisar propuesta: ${String(row.title)}`,context:String(row.name),
      priority:row.expires_at&&String(row.expires_at)<at.toISOString()?'high':'normal',
      dueAt:row.expires_at?String(row.expires_at):null,
      href:`/admin/crm/propuestas/${row.id}`,completion:null,id:String(row.id)});
  }
  if (canCards) {
    const orders=await db.all(`SELECT p.id,p.numero_pedido,p.pagado_en FROM pedidos_tarjetas p
      WHERE p.stripe_entorno='test' AND p.pagado_en IS NOT NULL
        AND EXISTS(SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=p.id
          AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado')
        AND NOT EXISTS(SELECT 1 FROM cards_production_jobs j WHERE j.order_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM os_work_items w WHERE w.order_id=p.id
          AND w.kind='cards' AND w.status='open')
      ORDER BY p.pagado_en LIMIT 50`);
    for(const row of orders) output.push({key:`paid:${row.id}`,category:'cards',
      title:'Preparar pedido pagado',context:String(row.numero_pedido),priority:'high',
      dueAt:String(row.pagado_en),href:`/admin/cards/${row.id}`,completion:null,id:String(row.id)});
    const incidents=await db.all(`SELECT i.id,i.order_id,i.summary,i.severity,p.numero_pedido
      FROM cards_production_incidents i JOIN pedidos_tarjetas p ON p.id=i.order_id
      WHERE i.status='open' AND p.stripe_entorno='test'
        AND NOT EXISTS(SELECT 1 FROM os_work_items w WHERE w.source_type='card_incident'
          AND w.source_id=i.id AND w.status='open')
      ORDER BY i.created_at LIMIT 50`);
    for(const row of incidents) output.push({key:`incident:${row.id}`,category:'incident',
      title:'Revisar incidencia de producción',context:String(row.numero_pedido),
      priority:row.severity==='blocking'?'urgent':'high',dueAt:null,
      href:`/admin/cards/${row.order_id}#incidencias`,completion:null,id:String(row.id)});
  }
  const workItems=await db.all(`SELECT w.*,o.responsible_user_id AS org_owner,p.stripe_entorno
    FROM os_work_items w LEFT JOIN crm_organizations o ON o.id=w.organization_id
    LEFT JOIN pedidos_tarjetas p ON p.id=w.order_id
    WHERE w.status='open' ORDER BY w.created_at DESC LIMIT 200`);
  for(const row of workItems) {
    if(row.source_type==='content_piece')continue;
    const org=Boolean(row.organization_id),card=Boolean(row.order_id);
    if (org && (!canCrm || (!owner && !principal.roles.includes('viewer')
      && row.org_owner!==principal.id))) continue;
    if(card && (!canCards || row.stripe_entorno!=='test')) continue;
    if(!org&&!card&&!owner) continue;
    const category:WorkEntry['category']=card?(row.kind==='incident'?'incident':row.kind==='link_alert'?'alert':'cards')
      :row.kind==='proposal'?'proposal':'crm';
    const href=card ? (row.kind==='link_alert'?`/admin/cards/enlaces/${row.source_id}`
      :`/admin/cards/${row.order_id}`) : row.kind==='proposal'
      ? `/admin/crm/propuestas/${row.source_id}` : row.source_type==='crm_opportunity'
      && String(row.dedupe_key).startsWith('sales.opportunity.guide:')
      ? `/admin/crm/guia-comercial?empresa=${encodeURIComponent(String(row.organization_id))}&oportunidad=${encodeURIComponent(String(row.source_id))}`
      : `/admin/crm/empresas/${row.organization_id}`;
    output.push({key:`work:${row.id}`,category,title:String(row.title),
      context:card?'Altaria Cards':'CRM',priority:row.priority as WorkPriority,
      dueAt:row.due_at?String(row.due_at):null,href,
      completion:(card?canCardsWrite:canCrmWrite)?'work_item':null,id:String(row.id)});
  }
  if (principal.roles.includes('owner')||principal.contentGrants?.some(x=>x.read)) {
    const brandIds=principal.roles.includes('owner')?null:
      principal.contentGrants?.filter(x=>x.read).map(x=>x.brandId)??[];
    const content=await db.all(`SELECT w.id,w.title,w.priority,w.due_at,w.source_id,
      c.brand_id,b.name AS brand_name,w.assigned_user_id
      FROM os_work_items w JOIN content_work_links l ON l.work_item_id=w.id
      JOIN content_pieces c ON c.id=l.piece_id
      JOIN content_brands b ON b.id=c.brand_id
      WHERE w.source_type='content_piece' AND w.status='open' AND b.status='active'
      ORDER BY w.created_at DESC LIMIT 100`);
    for(const row of content){
      if(brandIds&&!brandIds.includes(String(row.brand_id)))continue;
      if(row.assigned_user_id&&row.assigned_user_id!==principal.id
        &&!principal.roles.includes('owner'))continue;
      output.push({key:`content:${row.id}`,category:'content',title:String(row.title),
        context:String(row.brand_name),priority:row.priority as WorkPriority,
        dueAt:row.due_at?String(row.due_at):null,
        href:`/admin/contenido/piezas/${row.source_id}`,completion:null,id:String(row.id)});
    }
  }
  if(owner) {
    const approvals=await db.all(`SELECT id,action_key,requested_at,expires_at FROM os_approvals
      WHERE status IN ('pending','approved') AND expires_at>? ORDER BY expires_at LIMIT 50`,[at.toISOString()]);
    for(const row of approvals) output.push({key:`approval:${row.id}`,category:'approval',
      title:'Revisar aprobación pendiente',context:String(row.action_key),priority:'high',
      dueAt:String(row.expires_at),href:'/admin#aprobaciones',completion:null,id:String(row.id)});
  }
  output.sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority]
    || (a.dueAt??'9999').localeCompare(b.dueAt??'9999') || a.key.localeCompare(b.key));
  return output;
}

export async function completeWorkItem(principal:AdminPrincipal,id:string,db:Connection=getDatabase()) {
  if(!idPattern.test(id)) throw new WorkError('invalid_id');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await tx.get(`SELECT w.*,o.responsible_user_id AS org_owner,p.stripe_entorno
      FROM os_work_items w LEFT JOIN crm_organizations o ON o.id=w.organization_id
      LEFT JOIN pedidos_tarjetas p ON p.id=w.order_id WHERE w.id=?`,[id]);
    if(!row) throw new WorkError('work_missing',404);
    if(row.source_type==='content_piece')throw new WorkError('editorial_action_required',403);
    const owner=principal.roles.includes('owner');
    const permitted=row.order_id
      ? hasAdminPermission(principal,'cards:write')&&row.stripe_entorno==='test'
      : hasAdminPermission(principal,'crm:write')&&(owner||row.org_owner===principal.id);
    if(!permitted) throw new WorkError('forbidden',403);
    if(row.status!=='open') throw new WorkError('work_closed',409);
    const now=new Date().toISOString();
    const changed=await tx.run(`UPDATE os_work_items SET status='done',completed_by=?,completed_at=?
      WHERE id=? AND status='open'`,[principal.id,now,id]);
    if(Number(changed.changes)!==1) throw new WorkError('work_conflict',409);
    await tx.run(`INSERT INTO altaria_admin_audit_events
      (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
      VALUES (?,?,?,?,?,?,?,'success','{}')`,[randomUUID(),now,principal.id,principal.sessionHash,
      'os.work.complete','work_item',id]);
  }).immediate();
}

export function briefFromWork(items:WorkEntry[],date=new Date()) {
  const day=madridDay(date);
  return {day,timezone:'Europe/Madrid',
    counts:{priorities:items.filter(x=>x.priority==='urgent').length,
      followups:items.filter(x=>x.category==='crm').length,
      proposals:items.filter(x=>x.category==='proposal').length,
      cards:items.filter(x=>x.category==='cards').length,
      incidents:items.filter(x=>x.category==='incident'||x.category==='alert').length},
    actions:items.slice(0,5).map(x=>({category:x.category,title:x.title,href:x.href}))};
}
