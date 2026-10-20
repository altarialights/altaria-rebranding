import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { assertCardsTest } from '../cards/service';
import { approvalDigest, workItemVersion } from './common';
import { WorkError } from './work';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const audit=(principal:AdminPrincipal,action:string,id:string,at:string,
  outcome:'success'|'failure'='success')=>({sql:`INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES (?,?,?,?,?,'approval',?,?, '{}')`,
  args:[randomUUID(),at,principal.id,principal.sessionHash,action,id,outcome]});
const event=(id:string,action:string,actor:string|null,at:string,code:string|null=null)=>({
  sql:`INSERT INTO os_approval_events(id,approval_id,action,actor_user_id,occurred_at,result_code)
    VALUES (?,?,?,?,?,?)`,args:[randomUUID(),id,action,actor,at,code],
});

async function accessibleWork(db:Pick<Connection,'get'>,principal:AdminPrincipal,id:string) {
  const row=await db.get(`SELECT w.*,o.responsible_user_id AS org_owner,p.stripe_entorno
    FROM os_work_items w LEFT JOIN crm_organizations o ON o.id=w.organization_id
    LEFT JOIN pedidos_tarjetas p ON p.id=w.order_id WHERE w.id=?`,[id]);
  if(!row) throw new WorkError('work_missing',404);
  if(row.source_type==='content_piece') throw new WorkError('editorial_action_required',403);
  const owner=principal.roles.includes('owner');
  const permitted=row.order_id
    ? hasAdminPermission(principal,'cards:write')&&row.stripe_entorno==='test'
    : hasAdminPermission(principal,'crm:write')&&(owner||row.org_owner===principal.id);
  if(!permitted) throw new WorkError('forbidden',403);
  return row;
}

export async function requestWorkApproval(principal:AdminPrincipal,itemId:string,
  expiresAt:string,db:Connection=getDatabase()) {
  if(!uuid.test(itemId)||!Number.isFinite(Date.parse(expiresAt))
    ||Date.parse(expiresAt)<=Date.now()+60_000||Date.parse(expiresAt)>Date.now()+7*24*60*60_000)
    throw new WorkError('invalid_approval');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await accessibleWork(tx,principal,itemId);
    if(row.status!=='open') throw new WorkError('work_closed',409);
    const previous=await tx.get(`SELECT id FROM os_approvals WHERE resource_id=?
      AND status IN ('pending','approved') AND expires_at>? ORDER BY requested_at DESC LIMIT 1`,
      [itemId,new Date().toISOString()]);
    if(previous) return String(previous.id);
    const version=workItemVersion(row);
    const request={actionKey:'work_item.complete',resourceType:'work_item',
      resourceId:itemId,resourceVersion:version};
    const digest=approvalDigest(request),id=randomUUID(),at=new Date().toISOString();
    await tx.batch([{sql:`INSERT INTO os_approvals
      (id,action_key,resource_type,resource_id,request_json,request_sha256,resource_version,
        requested_by,requested_at,expires_at,status)
      VALUES (?,'work_item.complete','work_item',?,?,?,?,?,? ,?,'pending')`,
      args:[id,itemId,JSON.stringify(request),digest,version,principal.id,at,expiresAt]},
      event(id,'requested',principal.id,at),audit(principal,'os.approval.request',id,at)]);
    return id;
  }).immediate();
}

export async function reviewApproval(principal:AdminPrincipal,id:string,
  decision:'approved'|'rejected',db:Connection=getDatabase()) {
  if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
  if(!uuid.test(id)||!['approved','rejected'].includes(decision)) throw new WorkError('invalid_approval');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT status,expires_at FROM os_approvals WHERE id=?',[id]);
    if(!row) throw new WorkError('approval_missing',404);
    if(row.status!=='pending') throw new WorkError('approval_closed',409);
    const at=new Date().toISOString();
    if(String(row.expires_at)<=at) {
      await tx.batch([{sql:"UPDATE os_approvals SET status='expired' WHERE id=? AND status='pending'",args:[id]},
        event(id,'expired',null,at),audit(principal,'os.approval.expire',id,at)]);
      return 'expired';
    }
    const changed=await tx.run(`UPDATE os_approvals SET status=?,reviewed_by=?,reviewed_at=?
      WHERE id=? AND status='pending'`,[decision,principal.id,at,id]);
    if(Number(changed.changes)!==1) throw new WorkError('approval_conflict',409);
    await tx.batch([event(id,decision,principal.id,at),
      audit(principal,`os.approval.${decision}`,id,at)]);
    return decision;
  }).immediate();
}

export async function executeApproval(principal:AdminPrincipal,id:string,db:Connection=getDatabase()) {
  if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
  if(!uuid.test(id)) throw new WorkError('invalid_approval');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT * FROM os_approvals WHERE id=?',[id]);
    if(!row) throw new WorkError('approval_missing',404);
    if(row.status!=='approved') throw new WorkError('approval_not_approved',409);
    const at=new Date().toISOString();
    if(String(row.expires_at)<=at) {
      await tx.batch([{sql:"UPDATE os_approvals SET status='expired' WHERE id=? AND status='approved'",args:[id]},
        event(id,'expired',null,at),audit(principal,'os.approval.expire',id,at)]);
      return 'expired';
    }
    const item=await tx.get('SELECT * FROM os_work_items WHERE id=?',[row.resource_id]);
    const expected={actionKey:'work_item.complete',resourceType:'work_item',
      resourceId:String(row.resource_id),resourceVersion:String(row.resource_version)};
    const changed=String(row.action_key)!==expected.actionKey
      ||String(row.resource_type)!==expected.resourceType
      ||String(row.request_json)!==JSON.stringify(expected)
      ||String(row.request_sha256)!==approvalDigest(expected)
      ||!item||item.status!=='open'||workItemVersion(item)!==row.resource_version;
    if(changed) {
      await tx.batch([{sql:`UPDATE os_approvals SET status='failed',result_json=?
        WHERE id=? AND status='approved'`,args:[JSON.stringify({code:'content_changed'}),id]},
        event(id,'failed',principal.id,at,'content_changed'),
        audit(principal,'os.approval.execute',id,at,'failure')]);
      return 'content_changed';
    }
    const claim=await tx.run(`UPDATE os_approvals SET status='executing',execution_key=?
      WHERE id=? AND status='approved' AND execution_key IS NULL`,[`approval:${id}`,id]);
    if(Number(claim.changes)!==1) throw new WorkError('approval_conflict',409);
    const completed=await tx.run(`UPDATE os_work_items SET status='done',completed_by=?,completed_at=?
      WHERE id=? AND status='open'`,[principal.id,at,row.resource_id]);
    if(Number(completed.changes)!==1) throw new WorkError('work_conflict',409);
    await tx.batch([{sql:`UPDATE os_approvals SET status='executed',executed_at=?,result_json=?
      WHERE id=? AND status='executing'`,args:[at,JSON.stringify({code:'completed'}),id]},
      event(id,'executed',principal.id,at,'completed'),audit(principal,'os.approval.execute',id,at)]);
    return 'executed';
  }).immediate();
}

export async function listApprovals(principal:AdminPrincipal,db:Connection=getDatabase()) {
  await assertCardsTest(db);
  if(!hasAdminPermission(principal,'admin:read')) throw new WorkError('forbidden',403);
  return db.all(`SELECT a.id,a.action_key,a.resource_type,a.resource_id,a.request_sha256,
    a.resource_version,a.requested_at,a.expires_at,a.status,a.reviewed_at,a.executed_at,
    w.title AS resource_title,w.priority AS resource_priority
    FROM os_approvals a JOIN os_work_items w ON w.id=a.resource_id
    WHERE (?=1 OR a.requested_by=?) ORDER BY a.requested_at DESC LIMIT 50`,
    [principal.roles.includes('owner')?1:0,principal.id]);
}

export async function expireApprovals(db:Connection=getDatabase()) {
  await assertCardsTest(db);
  const at=new Date().toISOString();
  return db.transactionAsync(async tx=>{
    const rows=await tx.all(`SELECT id FROM os_approvals WHERE status IN ('pending','approved')
      AND expires_at<=? ORDER BY expires_at LIMIT 50`,[at]);
    for(const row of rows) await tx.batch([{sql:`UPDATE os_approvals SET status='expired'
      WHERE id=? AND status IN ('pending','approved')`,args:[String(row.id)]},
      event(String(row.id),'expired',null,at)]);
    return rows.length;
  }).immediate();
}
