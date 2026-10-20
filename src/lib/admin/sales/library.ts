import { createHash, randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { canReadOrganization, canWriteOrganization } from '../crm/model';
import { createActivity, createTask } from '../crm/service';
import { createLocalDraft } from '../gmail/service';

export const salesCategories = ['prospecting','email','call','in_person','diagnosis','demo','objection','followup','closing','upsell','aftersales'] as const;
export type SalesCategory = typeof salesCategories[number];
export const categoryLabels: Record<SalesCategory,string> = {
  prospecting:'Prospección',email:'Email',call:'Llamada',in_person:'Presencial',
  diagnosis:'Diagnóstico',demo:'Demostración',objection:'Objeciones',
  followup:'Seguimiento',closing:'Cierre',upsell:'Venta adicional',aftersales:'Posventa',
};
const channels = ['general','email','phone','in_person'] as const;
const stages = ['new','contacted','interested','proposal','negotiation','won','lost','general'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const at = () => new Date().toISOString();
type SqlArg = string | number | null;
type Statement = {sql:string;args:SqlArg[]};
export class SalesError extends Error { constructor(public code:string,public status=400){super(code);} }
export interface SalesInput {
  title:string; category:SalesCategory; product:string; sector:string; channel:typeof channels[number];
  stage:typeof stages[number]; body:string; nextStep:string;
}
export function validateSalesInput(input:SalesInput):SalesInput {
  const trim=(value:string,max:number,min=2)=>{
    const result=value?.trim(); if(!result||result.length<min||result.length>max) throw new SalesError('invalid_input');
    return result;
  };
  if(!salesCategories.includes(input.category)||!channels.includes(input.channel)
    ||!stages.includes(input.stage)) throw new SalesError('invalid_input');
  return {title:trim(input.title,180,3),category:input.category,product:trim(input.product,100),
    sector:trim(input.sector||'general',100),channel:input.channel,stage:input.stage,
    body:trim(input.body,10000,10),nextStep:trim(input.nextStep,1000,5)};
}
const digest=(data:SalesInput)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const digestRow=(row:Record<string,unknown>)=>digest({title:String(row.title),category:row.category as SalesCategory,
  product:String(row.product),sector:String(row.sector),channel:row.channel as SalesInput['channel'],
  stage:row.stage as SalesInput['stage'],body:String(row.body),nextStep:String(row.next_step)});
const audit=(principal:AdminPrincipal,action:string,id:string,date:string):Statement=>({
  sql:`INSERT INTO altaria_admin_audit_events(id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES(?,?,?,?,?,'sales_entry',?,'success','{}')`,
  args:[randomUUID(),date,principal.id,principal.sessionHash,action,id],
});
const event=(principal:AdminPrincipal,id:string,version:number,kind:string,date:string):Statement=>({
  sql:`INSERT INTO crm_sales_entry_events(id,entry_id,version,kind,actor_user_id,occurred_at)
    VALUES(?,?,?,?,?,?)`,args:[randomUUID(),id,version,kind,principal.id,date],
});
function requireRead(principal:AdminPrincipal){if(!hasAdminPermission(principal,'crm:read'))throw new SalesError('forbidden',403);}
function requireWrite(principal:AdminPrincipal){if(!hasAdminPermission(principal,'crm:write'))throw new SalesError('forbidden',403);}
function requireOwner(principal:AdminPrincipal){requireWrite(principal);if(!principal.roles.includes('owner'))throw new SalesError('forbidden',403);}

export async function listSalesEntries(principal:AdminPrincipal,filters:{q?:string;category?:string;sector?:string;product?:string;channel?:string;stage?:string}={},db:Connection=getDatabase()){
  requireRead(principal);
  const owner=principal.roles.includes('owner');
  const clauses=[`(e.approved_version IS NOT NULL OR ${owner?'1=1':'e.created_by=?'})`];
  if(!owner)clauses.push(`e.status!='retired'`);
  const args:SqlArg[]=owner?[]:[principal.id];
  for(const key of ['category','sector','product','channel','stage'] as const){
    if(filters[key]){clauses.push(`v.${key}=?`);args.push(String(filters[key]));}
  }
  const q=(filters.q??'').trim().toLowerCase().slice(0,100);
  if(q){clauses.push(`(lower(v.title) LIKE ? ESCAPE '\\' OR lower(v.body) LIKE ? ESCAPE '\\' OR lower(v.product) LIKE ? ESCAPE '\\')`);
    const term=`%${q.replace(/[\\%_]/g,'\\$&')}%`;args.push(term,term,term);}
  const rows=await db.all(`SELECT e.id,v.title,v.category,v.product,v.sector,v.channel,v.stage,e.status,
      e.latest_version,e.approved_version,e.created_by,e.updated_at,v.id AS version_id,v.version,
      v.body,v.next_step,v.provenance,v.source_ref,v.sha256
    FROM crm_sales_entries e JOIN crm_sales_entry_versions v ON v.entry_id=e.id
      AND v.version=CASE WHEN ?=1 OR e.approved_version IS NULL AND e.created_by=?
        THEN e.latest_version ELSE e.approved_version END
    WHERE ${clauses.join(' AND ')} ORDER BY e.updated_at DESC,e.id LIMIT 200`,
    [owner?1:0,principal.id,...args]);
  for(const row of rows)if(row.sha256!==digestRow(row))throw new SalesError('version_corrupt',503);
  return rows;
}

export async function getSalesEntry(principal:AdminPrincipal,id:string,db:Connection=getDatabase(),requestedVersion?:number){
  requireRead(principal);if(!uuid.test(id))throw new SalesError('invalid_input');
  const entry=await db.get('SELECT * FROM crm_sales_entries WHERE id=?',[id]);
  if(!entry)throw new SalesError('entry_missing',404);
  if(entry.status==='retired'&&!principal.roles.includes('owner'))throw new SalesError('forbidden',403);
  const canSeePending=principal.roles.includes('owner')
    ||entry.created_by===principal.id&&entry.approved_version===null;
  const version=requestedVersion??(canSeePending?Number(entry.latest_version):Number(entry.approved_version));
  if(!version)throw new SalesError('forbidden',403);
  if(!Number.isInteger(version)||version<1||version>Number(entry.latest_version)
    ||!canSeePending&&version!==Number(entry.approved_version))throw new SalesError('forbidden',403);
  const current=await db.get('SELECT * FROM crm_sales_entry_versions WHERE entry_id=? AND version=?',[id,version]);
  if(!current||current.sha256!==digestRow(current))throw new SalesError('version_corrupt',503);
  const history=canSeePending?await db.all(`SELECT v.id,v.version,v.provenance,v.source_ref,v.created_at,u.display_name
      FROM crm_sales_entry_versions v JOIN altaria_admin_users u ON u.id=v.created_by
      WHERE v.entry_id=? ORDER BY v.version DESC`,[id]):[];
  const events=canSeePending?await db.all(`SELECT e.kind,e.version,e.occurred_at,u.display_name
      FROM crm_sales_entry_events e JOIN altaria_admin_users u ON u.id=e.actor_user_id
      WHERE e.entry_id=? ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT 100`,[id]):[];
  return {entry,current,history,events,canEdit:hasAdminPermission(principal,'crm:write')&&canSeePending};
}

export async function createSalesEntry(principal:AdminPrincipal,input:SalesInput,
  db:Connection=getDatabase(),seedKey:string|null=null,initialStatus:'draft'|'review'='review'){
  requireWrite(principal);const data=validateSalesInput(input);const id=randomUUID(),versionId=randomUUID(),date=at();
  await db.batch([{sql:`INSERT INTO crm_sales_entries(id,seed_key,title,category,product,sector,channel,stage,status,latest_version,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)`,args:[id,seedKey,data.title,data.category,data.product,data.sector,data.channel,data.stage,initialStatus,principal.id,date,date]},
    {sql:`INSERT INTO crm_sales_entry_versions(id,entry_id,version,title,category,product,sector,channel,stage,body,next_step,sha256,provenance,source_ref,created_by,created_at)
      VALUES(?,?,1,?,?,?,?,?,?,?,?,?,'new_proposal',?,?,?)`,args:[versionId,id,data.title,data.category,data.product,data.sector,data.channel,data.stage,data.body,data.nextStep,digest(data),seedKey?`phase6.5b:initial:${seedKey}`:'local:editor',principal.id,date]},
    event(principal,id,1,'created',date),audit(principal,'sales.entry.create',id,date)],'immediate');
  return id;
}

export async function reviseSalesEntry(principal:AdminPrincipal,id:string,input:SalesInput,expectedVersion:number,db:Connection=getDatabase()){
  requireWrite(principal);const data=validateSalesInput(input);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT * FROM crm_sales_entries WHERE id=?',[id]);
    if(!row)throw new SalesError('entry_missing',404);
    if(!principal.roles.includes('owner')&&(row.created_by!==principal.id||row.approved_version!==null))
      throw new SalesError('forbidden',403);
    if(row.status==='retired')throw new SalesError('entry_retired',409);
    if(Number(row.latest_version)!==expectedVersion)throw new SalesError('version_conflict',409);
    const version=expectedVersion+1,date=at();
    const updated=await tx.run(`UPDATE crm_sales_entries SET title=?,category=?,product=?,sector=?,channel=?,stage=?,
      status='review',latest_version=?,updated_at=? WHERE id=? AND latest_version=?`,
      [data.title,data.category,data.product,data.sector,data.channel,data.stage,version,date,id,expectedVersion]);
    if(Number(updated.changes)!==1)throw new SalesError('version_conflict',409);
    await tx.batch([{sql:`INSERT INTO crm_sales_entry_versions(id,entry_id,version,title,category,product,sector,channel,stage,body,next_step,sha256,provenance,source_ref,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'new_proposal','local:editor',?,?)`,args:[randomUUID(),id,version,data.title,data.category,data.product,data.sector,data.channel,data.stage,data.body,data.nextStep,digest(data),principal.id,date]},
      event(principal,id,version,'revised',date),audit(principal,'sales.entry.revise',id,date)]);
    return version;
  }).immediate();
}

export async function submitSalesEntry(principal:AdminPrincipal,id:string,expectedVersion:number,db:Connection=getDatabase()){
  requireWrite(principal);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT latest_version,status,created_by FROM crm_sales_entries WHERE id=?',[id]);
    if(!row)throw new SalesError('entry_missing',404);
    if(!principal.roles.includes('owner')&&row.created_by!==principal.id)throw new SalesError('forbidden',403);
    if(row.status!=='draft'||Number(row.latest_version)!==expectedVersion)throw new SalesError('version_conflict',409);
    const date=at();
    const changed=await tx.run(`UPDATE crm_sales_entries SET status='review',updated_at=?
      WHERE id=? AND status='draft' AND latest_version=?`,[date,id,expectedVersion]);
    if(Number(changed.changes)!==1)throw new SalesError('version_conflict',409);
    await tx.batch([event(principal,id,expectedVersion,'submitted',date),
      audit(principal,'sales.entry.submit',id,date)]);
  }).immediate();
}

export async function reviewSalesEntry(principal:AdminPrincipal,id:string,decision:'approve'|'retire',expectedVersion:number,db:Connection=getDatabase()){
  requireOwner(principal);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT latest_version,status FROM crm_sales_entries WHERE id=?',[id]);
    if(!row)throw new SalesError('entry_missing',404);
    if(Number(row.latest_version)!==expectedVersion||row.status==='retired'
      ||decision==='approve'&&row.status!=='review')throw new SalesError('version_conflict',409);
    const date=at(),status=decision==='approve'?'approved':'retired';
    const change=await tx.run(`UPDATE crm_sales_entries SET status=?,approved_version=CASE WHEN ?='approved' THEN latest_version ELSE approved_version END,
      updated_at=? WHERE id=? AND latest_version=?`,[status,status,date,id,expectedVersion]);
    if(Number(change.changes)!==1)throw new SalesError('version_conflict',409);
    await tx.batch([event(principal,id,expectedVersion,decision==='approve'?'approved':'retired',date),
      audit(principal,`sales.entry.${decision}`,id,date)]);
  }).immediate();
}

export async function getSalesContext(principal:AdminPrincipal,organizationId:string,opportunityId:string|null=null,db:Connection=getDatabase()){
  requireRead(principal);if(!uuid.test(organizationId)||opportunityId&&!uuid.test(opportunityId))throw new SalesError('invalid_input');
  const org=await db.get(`SELECT id,name,sector,city,website_url,responsible_user_id FROM crm_organizations
    WHERE id=? AND status='active'`,[organizationId]);
  if(!org||!canReadOrganization(principal,String(org.responsible_user_id)))throw new SalesError('forbidden',403);
  const opportunities=await db.all(`SELECT id,title,stage FROM crm_opportunities WHERE organization_id=? ORDER BY updated_at DESC LIMIT 30`,[organizationId]);
  const opportunity=opportunityId?opportunities.find(o=>o.id===opportunityId):null;
  if(opportunityId&&!opportunity)throw new SalesError('resource_mismatch',409);
  const contacts=await db.all(`SELECT id,full_name,email FROM crm_contacts WHERE organization_id=? ORDER BY is_primary DESC,full_name LIMIT 30`,[organizationId]);
  const opposition=await db.all(`SELECT r.channel,r.decision,r.contact_id FROM crm_contact_channel_reviews r
    WHERE r.organization_id=? AND r.rowid=(SELECT x.rowid FROM crm_contact_channel_reviews x
      WHERE x.organization_id=r.organization_id AND x.channel=r.channel AND x.contact_id IS r.contact_id
      ORDER BY x.occurred_at DESC,x.rowid DESC LIMIT 1)`,[organizationId]);
  return {org,opportunities,opportunity,contacts,opposition};
}

export async function recordChannelReview(principal:AdminPrincipal,input:{organizationId:string;contactId:string|null;channel:'email'|'phone'|'in_person';decision:'unknown'|'eligible'|'blocked'|'opposed';reason:string},db:Connection=getDatabase()){
  requireWrite(principal);const ctx=await getSalesContext(principal,input.organizationId,null,db);
  if(!canWriteOrganization(principal,String(ctx.org.responsible_user_id)))throw new SalesError('forbidden',403);
  if(!['email','phone','in_person'].includes(input.channel)||!['unknown','eligible','blocked','opposed'].includes(input.decision)
    ||input.reason.trim().length<3||input.reason.length>500||input.contactId&&!ctx.contacts.some(c=>c.id===input.contactId))throw new SalesError('invalid_input');
  if(!principal.roles.includes('owner')&&['unknown','eligible'].includes(input.decision)
    &&ctx.opposition.some(r=>r.channel===input.channel&&r.contact_id===input.contactId
      &&['opposed','blocked'].includes(String(r.decision))))throw new SalesError('forbidden',403);
  const date=at(),id=randomUUID();
  await db.batch([{sql:`INSERT INTO crm_contact_channel_reviews(id,organization_id,contact_id,channel,decision,reason,actor_user_id,occurred_at)
    VALUES(?,?,?,?,?,?,?,?)`,args:[id,input.organizationId,input.contactId,input.channel,input.decision,input.reason.trim(),principal.id,date]},
    audit(principal,'sales.channel.review',id,date)],'immediate');
  return id;
}

export async function prepareSalesDraft(principal:AdminPrincipal,input:{entryId:string;organizationId:string;opportunityId:string|null;contactId:string;subject:string;body:string},db:Connection=getDatabase()){
  requireWrite(principal);const ctx=await getSalesContext(principal,input.organizationId,input.opportunityId,db);
  if(!canWriteOrganization(principal,String(ctx.org.responsible_user_id)))throw new SalesError('forbidden',403);
  const contact=ctx.contacts.find(c=>c.id===input.contactId);
  if(!contact?.email)throw new SalesError('contact_email_missing');
  const blocked=ctx.opposition.some(r=>r.channel==='email'&&['blocked','opposed'].includes(String(r.decision))
    &&(r.contact_id===null||r.contact_id===input.contactId));
  if(blocked)throw new SalesError('channel_blocked',403);
  const {entry,current}=await getSalesEntry(principal,input.entryId,db);
  if(entry.status==='retired'||!entry.approved_version&&!principal.roles.includes('owner'))throw new SalesError('forbidden',403);
  if(!principal.roles.includes('owner')&&Number(current.version)!==Number(entry.approved_version))
    throw new SalesError('forbidden',403);
  return createLocalDraft(principal,{organizationId:input.organizationId,contactId:input.contactId,
    proposalId:null,threadId:null,subject:input.subject,body:input.body,
    salesSource:{entryId:input.entryId,versionId:String(current.id),opportunityId:input.opportunityId}},db);
}

export async function registerSalesActivity(principal:AdminPrincipal,input:{organizationId:string;opportunityId:string|null;summary:string;detail:string|null;followupTitle:string|null;followupDueAt:string|null},db:Connection=getDatabase()){
  const ctx=await getSalesContext(principal,input.organizationId,input.opportunityId,db);
  if(!canWriteOrganization(principal,String(ctx.org.responsible_user_id)))throw new SalesError('forbidden',403);
  return createActivity(principal,{...input,contactId:null,kind:'call',happenedAt:at()},db);
}
export async function createSalesFollowup(principal:AdminPrincipal,input:{organizationId:string;opportunityId:string|null;title:string;dueAt:string|null},db:Connection=getDatabase()){
  const ctx=await getSalesContext(principal,input.organizationId,input.opportunityId,db);
  if(!canWriteOrganization(principal,String(ctx.org.responsible_user_id)))throw new SalesError('forbidden',403);
  return createTask(principal,{...input,contactId:null,responsibleUserId:null},db);
}
