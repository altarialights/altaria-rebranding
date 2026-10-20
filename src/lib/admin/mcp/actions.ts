import {createHash,randomUUID} from 'node:crypto';
import * as z from 'zod/v4';
import type {Connection} from '@tursodatabase/serverless';
import {getDatabase} from '../../db/client';
import {hasAdminPermission,type AdminPrincipal} from '../access';
import {assertCardsTest} from '../cards/service';
import {canWriteOrganization} from '../crm/model';
import {createActivity,createTask} from '../crm/service';
import {createSalesEntry} from '../sales/library';
import {createProposal} from '../proposals/service';
import {createLocalDraft} from '../gmail/service';
import {createPiece,getPiece,revisePiece} from '../content/service';
import {requestReview} from '../content/workflow';
import {requireBrand,uuid} from '../content/model';
import {principalForSubject,McpError} from './auth';

const key=z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const text=(max:number,min=2)=>z.string().trim().min(min).max(max);
const id=z.string().uuid();
const base={idempotencyKey:key,expiresAt:z.iso.datetime().optional()};
export const actionSchemas={
  sales_prepare_candidate:z.object({...base,title:text(180,3),category:z.enum([
    'prospecting','email','call','in_person','diagnosis','demo','objection','followup',
    'closing','upsell','aftersales']),product:text(100),sector:text(100),
    channel:z.enum(['general','email','phone','in_person']),
    stage:z.enum(['new','contacted','interested','proposal','negotiation','won','lost','general']),
    body:text(10000,10),nextStep:text(1000,5)}).strict(),
  crm_prepare_activity:z.object({...base,organizationId:id,opportunityId:id.nullable().optional(),
    contactId:id.nullable().optional(),kind:z.enum(['call','visit','meeting','note']),
    summary:text(240),detail:z.string().max(4000).nullable().optional()}).strict(),
  crm_prepare_task:z.object({...base,organizationId:id,opportunityId:id.nullable().optional(),
    contactId:id.nullable().optional(),title:text(240),dueAt:z.iso.datetime().nullable().optional()}).strict(),
  proposal_prepare_draft:z.object({...base,opportunityId:id,title:text(180)}).strict(),
  gmail_prepare_draft:z.object({...base,organizationId:id,contactId:id,
    proposalId:id.nullable().optional(),subject:text(240),body:text(10000,5)}).strict(),
  content_prepare_idea:z.object({...base,brandId:text(80),channel:z.enum(['instagram','linkedin']),
    title:text(180,3),format:text(80),objective:z.string().max(500).optional(),
    brief:z.string().max(5000).optional()}).strict(),
  content_prepare_script:z.object({...base,pieceId:id,script:text(12000,10)}).strict(),
  content_prepare_review:z.object({...base,pieceId:id,stage:z.enum(['script','visuals','final'])}).strict(),
} as const;
export type ActionToolName=keyof typeof actionSchemas;
export const actionToolNames=Object.keys(actionSchemas) as ActionToolName[];
type Fields=Record<string,unknown>;
const digest=(json:string)=>createHash('sha256').update(json).digest('hex');
const now=()=>new Date().toISOString();
const event=(requestId:string,action:string,actorId:string|null,at:string,code:string|null=null)=>({
  sql:`INSERT INTO os_mcp_action_events(id,request_id,action,actor_user_id,occurred_at,result_code)
    VALUES(?,?,?,?,?,?)`,args:[randomUUID(),requestId,action,actorId,at,code],
});
const audit=(p:AdminPrincipal,action:string,targetId:string,at:string,outcome='success')=>({
  sql:`INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES(?,?,?,?,?,'mcp_request',?,?,'{}')`,
  args:[randomUUID(),at,p.id,p.sessionHash,action,targetId,outcome],
});
function parseAction(name:ActionToolName,input:unknown):Fields {
  const parsed=actionSchemas[name].safeParse(input);
  if(!parsed.success)throw new McpError('invalid_input');
  return parsed.data;
}
export function canPrepareTool(name:ActionToolName,p:AdminPrincipal){
  return name.startsWith('content_')
    ?p.roles.includes('owner')||Boolean(p.contentGrants?.some(g=>g.edit))
    :hasAdminPermission(p,'crm:write');
}
async function resourceSnapshot(name:ActionToolName,p:AdminPrincipal,a:Fields,
  db:Connection):Promise<{type:string;id:string;version:string}>{
  if(!canPrepareTool(name,p))throw new McpError('forbidden',403);
  if(name==='sales_prepare_candidate')return {type:'sales_library',id:'sales_library',version:'1'};
  if(name==='content_prepare_idea'){
    requireBrand(p,String(a.brandId),'edit');
    const row=await db.get(`SELECT b.status,b.updated_at,c.status AS channel_status
      FROM content_brands b JOIN content_brand_channels c ON c.brand_id=b.id
      WHERE b.id=? AND c.channel=?`,[String(a.brandId),String(a.channel)]);
    if(row?.status!=='active'||row.channel_status!=='active')throw new McpError('not_found',404);
    return {type:'content_brand',id:String(a.brandId),version:String(row.updated_at)};
  }
  if(name==='content_prepare_script'||name==='content_prepare_review'){
    const detail=await getPiece(p,String(a.pieceId),db);
    requireBrand(p,String(detail.piece.brand_id),'edit');
    return {type:'content_piece',id:String(a.pieceId),
      version:`${detail.piece.current_version}:${detail.piece.revision}`};
  }
  if(name==='proposal_prepare_draft'){
    const row=await db.get(`SELECT q.version,o.responsible_user_id,o.status,q.stage
      FROM crm_opportunities q JOIN crm_organizations o ON o.id=q.organization_id
      WHERE q.id=?`,[String(a.opportunityId)]);
    if(!row||row.status!=='active'||!canWriteOrganization(p,String(row.responsible_user_id))
      ||['won','lost'].includes(String(row.stage)))throw new McpError('forbidden',403);
    return {type:'crm_opportunity',id:String(a.opportunityId),version:String(row.version)};
  }
  const orgId=String(a.organizationId);
  const row=await db.get(`SELECT responsible_user_id,status,updated_at FROM crm_organizations
    WHERE id=?`,[orgId]);
  if(!row||row.status!=='active'||!canWriteOrganization(p,String(row.responsible_user_id)))
    throw new McpError('forbidden',403);
  if(a.opportunityId){
    const linked=await db.get('SELECT id FROM crm_opportunities WHERE id=? AND organization_id=?',
      [String(a.opportunityId),orgId]);
    if(!linked)throw new McpError('resource_mismatch');
  }
  if(a.contactId){
    const linked=await db.get('SELECT id FROM crm_contacts WHERE id=? AND organization_id=?',
      [String(a.contactId),orgId]);
    if(!linked)throw new McpError('resource_mismatch');
  }
  return {type:'crm_organization',id:orgId,version:String(row.updated_at)};
}

export async function prepareMcpAction(name:ActionToolName,p:AdminPrincipal,input:unknown,
  db:Connection=getDatabase()){
  await assertCardsTest(db);
  const a=parseAction(name,input),at=now();
  const expires=typeof a.expiresAt==='string'?new Date(a.expiresAt).toISOString():
    new Date(Date.now()+24*60*60_000).toISOString();
  if(Date.parse(expires)<=Date.now()+60_000||Date.parse(expires)>Date.now()+7*24*60*60_000)
    throw new McpError('invalid_expiry');
  const resource=await resourceSnapshot(name,p,a,db);
  const requestJson=JSON.stringify({tool:name,parameters:a,resource});
  if(requestJson.length>16_000)throw new McpError('request_too_large',413);
  const sha=digest(requestJson),id=randomUUID();
  try{
    await db.batch([{sql:`INSERT INTO os_mcp_action_requests
      (id,requester_user_id,tool_key,idempotency_key,request_json,request_sha256,
       resource_type,resource_id,resource_version,requested_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,args:[id,p.id,name,String(a.idempotencyKey),requestJson,
        sha,resource.type,resource.id,resource.version,at,expires]},
      event(id,'requested',p.id,at),audit(p,'mcp.action.request',id,at)],'immediate');
    return {id,status:'pending',expiresAt:expires,reviewUrl:'/admin/configuracion/mcp'};
  }catch(error){
    const existing=await db.get(`SELECT id,request_sha256,status,expires_at
      FROM os_mcp_action_requests WHERE requester_user_id=? AND tool_key=? AND idempotency_key=?`,
      [p.id,name,String(a.idempotencyKey)]);
    if(existing){
      if(existing.request_sha256!==sha)throw new McpError('idempotency_conflict',409);
      return {id:String(existing.id),status:String(existing.status),
        expiresAt:String(existing.expires_at),reviewUrl:'/admin/configuracion/mcp'};
    }
    throw error;
  }
}

export async function listMcpActions(owner:AdminPrincipal,db:Connection=getDatabase()){
  if(!owner.roles.includes('owner'))throw new McpError('forbidden',403);
  await assertCardsTest(db);
  return db.all(`SELECT r.id,r.tool_key,r.request_json,r.request_sha256,r.requester_user_id,
    r.resource_type,r.resource_id,r.resource_version,r.requested_at,r.expires_at,r.status,
    r.result_json,u.display_name AS requester_name FROM os_mcp_action_requests r
    JOIN altaria_admin_users u ON u.id=r.requester_user_id
    ORDER BY r.requested_at DESC LIMIT 50`);
}
export async function listMcpGrants(owner:AdminPrincipal,db:Connection=getDatabase()){
  if(!owner.roles.includes('owner'))throw new McpError('forbidden',403);
  await assertCardsTest(db);
  return db.all(`SELECT u.id,u.display_name,u.email,u.status,g.can_read,g.can_prepare,
    g.grant_version,g.revoked_at FROM altaria_admin_users u
    LEFT JOIN os_mcp_access_grants g ON g.user_id=u.id
    WHERE u.status='active' AND u.workos_user_id IS NOT NULL ORDER BY u.display_name LIMIT 100`);
}
export async function setMcpGrant(owner:AdminPrincipal,userId:string,read:boolean,prepare:boolean,
  db:Connection=getDatabase()){
  if(!owner.roles.includes('owner'))throw new McpError('forbidden',403);
  if(!uuid.test(userId)||prepare&&!read)throw new McpError('invalid_input');
  await assertCardsTest(db);
  const user=await db.get(`SELECT id FROM altaria_admin_users WHERE id=?
    AND status='active' AND workos_user_id IS NOT NULL`,[userId]);
  if(!user)throw new McpError('not_found',404);
  const at=now();
  await db.batch([{sql:`INSERT INTO os_mcp_access_grants
    (user_id,can_read,can_prepare,granted_by,granted_at,revoked_by,revoked_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET can_read=excluded.can_read,
      can_prepare=excluded.can_prepare,grant_version=grant_version+1,
      granted_by=excluded.granted_by,granted_at=excluded.granted_at,
      revoked_by=excluded.revoked_by,revoked_at=excluded.revoked_at`,
    args:[userId,read?1:0,prepare?1:0,owner.id,at,read?null:owner.id,read?null:at]},
    audit(owner,read?'mcp.grant.set':'mcp.grant.revoke',userId,at)],'immediate');
}

export async function reviewMcpAction(owner:AdminPrincipal,id:string,
  decision:'approved'|'rejected',db:Connection=getDatabase()){
  if(!owner.roles.includes('owner'))throw new McpError('forbidden',403);
  if(!uuid.test(id)||!['approved','rejected'].includes(decision))throw new McpError('invalid_input');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT status,expires_at FROM os_mcp_action_requests WHERE id=?',[id]);
    if(!row)throw new McpError('not_found',404);
    if(row.status!=='pending')throw new McpError('approval_closed',409);
    const at=now();
    const status=String(row.expires_at)<=at?'expired':decision;
    const changed=await tx.run(`UPDATE os_mcp_action_requests SET status=?,reviewed_by=?,reviewed_at=?
      WHERE id=? AND status='pending'`,[status,owner.id,at,id]);
    if(Number(changed.changes)!==1)throw new McpError('approval_conflict',409);
    await tx.batch([event(id,status,owner.id,at),audit(owner,`mcp.action.${status}`,id,at)]);
    return status;
  }).immediate();
}

async function executeExistingService(name:ActionToolName,p:AdminPrincipal,a:Fields,
  db:Connection):Promise<string|number>{
  switch(name){
    case 'sales_prepare_candidate':return createSalesEntry(p,a as unknown as Parameters<typeof createSalesEntry>[1],db);
    case 'crm_prepare_activity':return createActivity(p,{organizationId:String(a.organizationId),
      opportunityId:String(a.opportunityId??'')||null,contactId:String(a.contactId??'')||null,
      kind:a.kind as 'call'|'visit'|'meeting'|'note',summary:String(a.summary),
      detail:a.detail?String(a.detail):null,happenedAt:now(),followupTitle:null,followupDueAt:null},db);
    case 'crm_prepare_task':return createTask(p,{organizationId:String(a.organizationId),
      opportunityId:String(a.opportunityId??'')||null,contactId:String(a.contactId??'')||null,
      title:String(a.title),dueAt:a.dueAt?String(a.dueAt):null,responsibleUserId:null},db);
    case 'proposal_prepare_draft':return createProposal(p,String(a.opportunityId),String(a.title),db);
    case 'gmail_prepare_draft':return createLocalDraft(p,{organizationId:String(a.organizationId),
      contactId:String(a.contactId),proposalId:a.proposalId?String(a.proposalId):null,
      threadId:null,subject:String(a.subject),body:String(a.body)},db);
    case 'content_prepare_idea':return createPiece(p,{brandId:String(a.brandId),channel:String(a.channel),
      title:String(a.title),format:String(a.format),objective:String(a.objective??''),
      brief:String(a.brief??'')},db);
    case 'content_prepare_script':{
      const current=await getPiece(p,String(a.pieceId),db);
      const c=current.current,q=current.piece;
      return revisePiece(p,String(a.pieceId),{brandId:String(q.brand_id),channel:String(q.channel),
        projectId:q.project_id?String(q.project_id):null,title:String(c.title),
        format:String(c.format_snapshot),objective:String(c.objective),brief:String(c.brief),
        hook:String(c.hook),script:String(a.script),copy:String(c.copy),cta:String(c.cta),
        referencesText:String(c.references_text),dueAt:q.due_at?String(q.due_at):null,
        assignedUserId:q.assigned_user_id?String(q.assigned_user_id):null},
      Number(q.current_version),db);
    }
    case 'content_prepare_review':return requestReview(p,String(a.pieceId),
      a.stage as 'script'|'visuals'|'final',null,db);
  }
}

export async function executeMcpAction(owner:AdminPrincipal,id:string,db:Connection=getDatabase()){
  if(!owner.roles.includes('owner'))throw new McpError('forbidden',403);
  if(!uuid.test(id))throw new McpError('invalid_input');
  await assertCardsTest(db);
  const request=await db.get('SELECT * FROM os_mcp_action_requests WHERE id=?',[id]);
  if(!request)throw new McpError('not_found',404);
  if(request.status!=='approved')throw new McpError('approval_not_approved',409);
  const at=now();
  if(String(request.expires_at)<=at){
    await db.batch([{sql:`UPDATE os_mcp_action_requests SET status='expired'
      WHERE id=? AND status='approved'`,args:[id]},event(id,'expired',owner.id,at),
      audit(owner,'mcp.action.expired',id,at)],'immediate');
    return 'expired';
  }
  let name:ActionToolName,a:Fields,requestResource:{type:string;id:string;version:string};
  try{
    const parsed=JSON.parse(String(request.request_json));
    name=parsed.tool;a=parseAction(name,parsed.parameters);
    requestResource=parsed.resource;
    if(!actionToolNames.includes(name)||digest(String(request.request_json))!==request.request_sha256
      ||name!==request.tool_key||String(a.idempotencyKey)!==request.idempotency_key
      ||requestResource.type!==request.resource_type
      ||requestResource.id!==request.resource_id
      ||requestResource.version!==request.resource_version)
      throw new Error('request_changed');
  }catch {throw new McpError('request_changed',409);}
  const user=await db.get('SELECT workos_user_id FROM altaria_admin_users WHERE id=?',
    [String(request.requester_user_id)]);
  if(!user?.workos_user_id)throw new McpError('requester_missing',409);
  const actor=await principalForSubject(String(user.workos_user_id),`approval:${id}`,db);
  if(!actor.canPrepare)throw new McpError('grant_revoked',403);
  const current=await resourceSnapshot(name,actor.principal,a,db);
  if(JSON.stringify(current)!==JSON.stringify(requestResource)){
    await db.batch([{sql:`UPDATE os_mcp_action_requests SET status='failed',result_json=?
      WHERE id=? AND status='approved'`,args:[JSON.stringify({code:'resource_changed'}),id]},
      event(id,'failed',owner.id,at,'resource_changed'),
      audit(owner,'mcp.action.execute',id,at,'failure')],'immediate');
    return 'resource_changed';
  }
  const claim=await db.run(`UPDATE os_mcp_action_requests SET status='executing',execution_key=?
    WHERE id=? AND status='approved' AND execution_key IS NULL`,[`mcp:${id}`,id]);
  if(Number(claim.changes)!==1)throw new McpError('approval_conflict',409);
  let result:string|number;
  try{result=await executeExistingService(name,actor.principal,a,db);}
  catch(error){
    const failed=now();
    const code=error instanceof Error&&/^[a-z_]{3,50}$/.test(error.message)
      ?error.message:'service_error';
    await db.batch([{sql:`UPDATE os_mcp_action_requests SET status='failed',result_json=?
      WHERE id=? AND status='executing'`,args:[JSON.stringify({code}),id]},
      event(id,'failed',owner.id,failed,code),
      audit(owner,'mcp.action.execute',id,failed,'failure')],'immediate');
    return 'failed';
  }
  const completed=now();
  try{
    await db.batch([{sql:`UPDATE os_mcp_action_requests SET status='executed',executed_at=?,
      result_json=? WHERE id=? AND status='executing'`,
    args:[completed,JSON.stringify({resourceId:result,origin:'chatgpt_mcp_test',
      authorUserId:actor.principal.id,approvedBy:owner.id,createdAt:completed,status:'created'}),id]},
      event(id,'executed',owner.id,completed),audit(owner,'mcp.action.execute',id,completed),
      {sql:`INSERT INTO altaria_admin_audit_events
        (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
        VALUES(?,?,?,?,?,?,?,'success',?)`,args:[randomUUID(),completed,actor.principal.id,
        actor.principal.sessionHash,'mcp.generated.create',name,String(result),
        JSON.stringify({requestId:id,origin:'chatgpt_mcp_test',approvedBy:owner.id})]}],
    'immediate');
    return 'executed';
  }catch{return 'reconciliation_required';}
}
