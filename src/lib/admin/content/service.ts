import {createHash,randomUUID} from 'node:crypto';
import type {Connection} from '@tursodatabase/serverless';
import {getDatabase} from '../../db/client';
import {assertCardsTest} from '../cards/service';
import {hasAdminPermission,type AdminPrincipal} from '../access';
import {ContentError,contentStages,requireBrand,requiredText,optionalText,optionalDate,uuid,
  type ContentStage} from './model';

type SqlValue=string|number|null;
type Statement={sql:string;args:SqlValue[]};
const now=()=>new Date().toISOString();
const hash=(parts:unknown)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const audit=(p:AdminPrincipal,action:string,type:string,id:string,at:string):Statement=>({
  sql:`INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES (?,?,?,?,?,?,?,'success','{}')`,
  args:[randomUUID(),at,p.id,p.sessionHash,action,type,id],
});
const event=(p:AdminPrincipal,id:string,version:number,kind:string,at:string,reason:string|null=null):Statement=>({
  sql:`INSERT INTO content_events(id,piece_id,event_type,version,actor_user_id,reason,occurred_at)
    VALUES (?,?,?,?,?,?,?)`,args:[randomUUID(),id,kind,version,p.id,reason,at],
});
export async function assertContentTest(db:Pick<Connection,'get'>){await assertCardsTest(db);}

export async function listBrands(p:AdminPrincipal,db:Connection=getDatabase()){
  await assertContentTest(db);
  if(!hasAdminPermission(p,'content:read'))throw new ContentError('forbidden',403);
  const ids=p.roles.includes('owner')?null:(p.contentGrants??[]).filter(x=>x.read).map(x=>x.brandId);
  if(ids?.length===0)return [];
  const brands=await db.all(`SELECT b.id,b.name,b.status,c.channel,c.status AS channel_status,
    (SELECT mode FROM content_review_policies r WHERE r.brand_id=b.id AND r.project_id IS NULL
      AND r.active=1 LIMIT 1) AS review_mode
    FROM content_brands b LEFT JOIN content_brand_channels c ON c.brand_id=b.id
    ORDER BY b.name,c.channel`);
  return brands.filter(b=>!ids||ids.includes(String(b.id)));
}

export interface PieceInput {brandId:string;channel:string;projectId?:string|null;title:string;
  format:string;objective?:string;brief?:string;hook?:string;script?:string;copy?:string;
  cta?:string;referencesText?:string;dueAt?:string|null;assignedUserId?:string|null;}
const textFields=(input:PieceInput)=>({
  title:requiredText(input.title,180,3),objective:optionalText(input.objective,500),
  brief:optionalText(input.brief,5000),hook:optionalText(input.hook,1000),
  script:optionalText(input.script,12000),copy:optionalText(input.copy,8000),
  cta:optionalText(input.cta,1000),referencesText:optionalText(input.referencesText,4000),
});
async function validTarget(db:Pick<Connection,'get'>,brandId:string,channel:string,projectId:string|null){
  const row=await db.get(`SELECT b.status AS brand_status,c.status AS channel_status
    FROM content_brands b JOIN content_brand_channels c ON c.brand_id=b.id
    WHERE b.id=? AND c.channel=?`,[brandId,channel]);
  if(!row||row.brand_status!=='active'||row.channel_status!=='active')
    throw new ContentError('brand_unavailable',409);
  if(projectId){
    if(!uuid.test(projectId))throw new ContentError('invalid_project');
    const project=await db.get(`SELECT id FROM content_projects WHERE id=? AND brand_id=? AND status='active'`,
      [projectId,brandId]);
    if(!project)throw new ContentError('invalid_project',404);
  }
}
async function validAssignee(db:Pick<Connection,'get'>,userId:string|null,brandId:string){
  if(!userId)return;
  if(!uuid.test(userId))throw new ContentError('invalid_assignee');
  const row=await db.get(`SELECT u.id FROM altaria_admin_users u
    LEFT JOIN altaria_admin_user_roles r ON r.user_id=u.id AND r.role_key='owner'
    LEFT JOIN content_brand_memberships m ON m.user_id=u.id AND m.brand_id=?
      AND m.revoked_at IS NULL AND m.can_read=1
    WHERE u.id=? AND u.status='active' AND (r.user_id IS NOT NULL OR m.user_id IS NOT NULL)`,
    [brandId,userId]);
  if(!row)throw new ContentError('invalid_assignee',403);
}
async function pieceFor(db:Pick<Connection,'get'>,p:AdminPrincipal,id:string,cap:'read'|'edit'|'review'|'recordPublication'){
  if(!uuid.test(id))throw new ContentError('piece_missing',404);
  const piece=await db.get('SELECT * FROM content_pieces WHERE id=?',[id]);
  if(!piece)throw new ContentError('piece_missing',404);
  requireBrand(p,String(piece.brand_id),cap);
  return piece;
}
export async function listPieces(p:AdminPrincipal,filters:{brandId?:string;channel?:string;
  assignedUserId?:string;stage?:string;q?:string}={},db:Connection=getDatabase()){
  await assertContentTest(db);
  if(!hasAdminPermission(p,'content:read'))throw new ContentError('forbidden',403);
  const ids=p.roles.includes('owner')?null:(p.contentGrants??[]).filter(x=>x.read).map(x=>x.brandId);
  if(ids?.length===0)return [];
  const clauses=['1=1'];const args:SqlValue[]=[];
  if(ids){clauses.push(`p.brand_id IN (${ids.map(()=>'?').join(',')})`);args.push(...ids);}
  if(filters.brandId){clauses.push('p.brand_id=?');args.push(filters.brandId);}
  if(filters.channel){clauses.push('p.channel=?');args.push(filters.channel);}
  if(filters.assignedUserId&&uuid.test(filters.assignedUserId)){
    clauses.push('p.assigned_user_id=?');args.push(filters.assignedUserId);}
  if(filters.stage&&contentStages.includes(filters.stage as ContentStage)){
    clauses.push('p.stage=?');args.push(filters.stage);}
  if(filters.q){clauses.push('instr(lower(p.title),lower(?))>0');
    args.push(filters.q.slice(0,80));}
  return db.all(`SELECT p.*,b.name AS brand_name,u.display_name AS assignee_name,
    (SELECT scheduled_at FROM content_publication_records r WHERE r.piece_id=p.id
      AND r.status IN ('scheduled','confirmed') ORDER BY r.created_at DESC LIMIT 1) AS scheduled_at,
    (SELECT COUNT(*) FROM content_review_requests r WHERE r.piece_id=p.id
      AND r.status='pending') AS pending_reviews
    FROM content_pieces p JOIN content_brands b ON b.id=p.brand_id
    LEFT JOIN altaria_admin_users u ON u.id=p.assigned_user_id
    WHERE ${clauses.join(' AND ')} ORDER BY p.due_at IS NULL,p.due_at,p.updated_at DESC LIMIT 250`,args);
}
export async function getPiece(p:AdminPrincipal,id:string,db:Connection=getDatabase(),version?:number){
  await assertContentTest(db);
  const piece=await pieceFor(db,p,id,'read');
  const requested=version??Number(piece.current_version);
  if(!Number.isInteger(requested)||requested<1||requested>Number(piece.current_version))
    throw new ContentError('version_missing',404);
  const current=await db.get('SELECT * FROM content_piece_versions WHERE piece_id=? AND version=?',
    [id,requested]);
  if(!current||current.sha256!==hash([current.title,current.format_snapshot,current.objective,current.brief,current.hook,
    current.script,current.copy,current.cta,current.references_text]))throw new ContentError('version_corrupt',503);
  const [versions,events,comments,reviews,assets,publication,metrics,crmLinks]=await Promise.all([
    db.all('SELECT version,created_at,created_by FROM content_piece_versions WHERE piece_id=? ORDER BY version DESC',[id]),
    db.all('SELECT event_type,version,reason,occurred_at,actor_user_id FROM content_events WHERE piece_id=? ORDER BY occurred_at DESC LIMIT 100',[id]),
    db.all('SELECT body,version,created_at,actor_user_id FROM content_comments WHERE piece_id=? ORDER BY created_at DESC LIMIT 100',[id]),
    db.all('SELECT * FROM content_review_requests WHERE piece_id=? ORDER BY requested_at DESC',[id]),
    db.all(`SELECT a.id,a.file_name,a.mime_type,a.byte_size,a.asset_class,a.status,l.version,l.purpose
      FROM content_piece_assets l JOIN content_assets a ON a.id=l.asset_id
      WHERE l.piece_id=? ORDER BY l.added_at DESC`,[id]),
    db.all('SELECT * FROM content_publication_records WHERE piece_id=? ORDER BY created_at DESC',[id]),
    db.all(`SELECT m.* FROM content_metrics m JOIN content_publication_records r ON r.id=m.publication_id
      WHERE r.piece_id=? ORDER BY m.observed_at DESC`,[id]),
    db.all('SELECT id,organization_id,opportunity_id,link_type FROM content_crm_links WHERE piece_id=?',[id]),
  ]);
  return {piece,current,versions,events,comments,reviews,assets,publication,metrics,
    crmLinks:hasAdminPermission(p,'crm:read')?crmLinks:crmLinks.map(x=>({id:x.id,link_type:x.link_type}))};
}
export async function createPiece(p:AdminPrincipal,input:PieceInput,db:Connection=getDatabase()){
  requireBrand(p,input.brandId,'edit');await assertContentTest(db);
  const content=textFields(input),title=content.title,format=requiredText(input.format,80,2);
  const projectId=input.projectId||null,dueAt=optionalDate(input.dueAt);
  const assignee=input.assignedUserId||p.id;
  await validTarget(db,input.brandId,input.channel,projectId);
  await validAssignee(db,assignee,input.brandId);
  const id=randomUUID(),vid=randomUUID(),at=now();
  await db.batch([
    {sql:`INSERT INTO content_pieces(id,brand_id,channel,project_id,title,format,due_at,
      assigned_user_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      args:[id,input.brandId,input.channel,projectId,title,format,dueAt,assignee,p.id,at,at]},
    {sql:`INSERT INTO content_piece_versions(id,piece_id,version,title,format_snapshot,objective,brief,hook,
      script,copy,cta,references_text,sha256,created_by,created_at)
      VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[vid,id,title,format,content.objective,content.brief,
        content.hook,content.script,content.copy,content.cta,content.referencesText,
        hash([title,format,content.objective,content.brief,content.hook,content.script,content.copy,
          content.cta,content.referencesText]),p.id,at]},
    event(p,id,1,'content.created',at),audit(p,'content.piece.create','content_piece',id,at),
  ],'immediate');
  return id;
}
export async function revisePiece(p:AdminPrincipal,id:string,input:PieceInput,expected:number,
  db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const row=await pieceFor(tx,p,id,'edit');
    if(Number(row.current_version)!==expected)throw new ContentError('version_conflict',409);
    if(['published','analyzed','archived'].includes(String(row.publication_state)))
      throw new ContentError('publication_locked',409);
    if(input.brandId!==row.brand_id||input.channel!==row.channel||input.projectId!==undefined
      &&(input.projectId||null)!==row.project_id)throw new ContentError('immutable_context',409);
    const c=textFields(input),at=now(),version=expected+1;
    const format=requiredText(input.format,80,2);
    const changed=await tx.run(`UPDATE content_pieces SET title=?,format=?,due_at=?,
      assigned_user_id=?,current_version=?,revision=revision+1,
      stage=CASE WHEN stage='ready' THEN 'review' ELSE stage END,publication_state='none',
      updated_at=? WHERE id=? AND current_version=?`,[c.title,requiredText(input.format,80,2),
      optionalDate(input.dueAt),input.assignedUserId||row.assigned_user_id,version,at,id,expected]);
    if(Number(changed.changes)!==1)throw new ContentError('version_conflict',409);
    await tx.batch([
      {sql:`INSERT INTO content_piece_versions(id,piece_id,version,title,format_snapshot,objective,brief,hook,
        script,copy,cta,references_text,sha256,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,args:[randomUUID(),id,version,c.title,format,c.objective,
        c.brief,c.hook,c.script,c.copy,c.cta,c.referencesText,hash([c.title,format,c.objective,c.brief,
          c.hook,c.script,c.copy,c.cta,c.referencesText]),p.id,at]},
      {sql:`INSERT INTO content_piece_assets(piece_id,version,brand_id,asset_id,purpose,added_by,added_at)
        SELECT piece_id,?,brand_id,asset_id,purpose,?,? FROM content_piece_assets
        WHERE piece_id=? AND version=?`,args:[version,p.id,at,id,expected]},
      {sql:`UPDATE content_review_requests SET status='superseded',decided_at=?
        WHERE piece_id=? AND status IN ('pending','approved')`,args:[at,id]},
      {sql:`UPDATE content_publication_records SET status='cancelled'
        WHERE piece_id=? AND status='scheduled'`,args:[id]},
      {sql:`UPDATE os_work_items SET status='cancelled',cancel_reason='content_version_changed'
        WHERE source_type='content_piece' AND source_id=? AND status='open'`,args:[id]},
      event(p,id,version,'content.revised',at),audit(p,'content.piece.revise','content_piece',id,at),
    ]);
    return version;
  }).immediate();
}
export async function addComment(p:AdminPrincipal,id:string,body:string,db:Connection=getDatabase()){
  await assertContentTest(db);
  const row=await pieceFor(db,p,id,'read');const at=now();
  await db.batch([{sql:`INSERT INTO content_comments(id,piece_id,version,body,actor_user_id,created_at)
    VALUES(?,?,?,?,?,?)`,args:[randomUUID(),id,Number(row.current_version),requiredText(body,4000,2),p.id,at]},
    audit(p,'content.comment.create','content_piece',id,at)],'immediate');
}
export async function changeStage(p:AdminPrincipal,id:string,to:ContentStage,expected:number,
  db:Connection=getDatabase()){
  await assertContentTest(db);
  if(!contentStages.includes(to))throw new ContentError('invalid_stage');
  return db.transactionAsync(async tx=>{
    const row=await pieceFor(tx,p,id,'edit');
    if(row.on_hold)throw new ContentError('piece_on_hold',409);
    if(Number(row.revision)!==expected)throw new ContentError('version_conflict',409);
    if(row.publication_state!=='none')throw new ContentError('publication_locked',409);
    const from=contentStages.indexOf(String(row.stage) as ContentStage),target=contentStages.indexOf(to);
    if(target!==from+1&&target!==from-1)throw new ContentError('invalid_transition',409);
    const policy=await activePolicy(tx,String(row.brand_id),row.project_id?String(row.project_id):null);
    const required=policy.mode==='staged'&&to==='visuals'?'script'
      :policy.mode==='staged'&&to==='editing'?'visuals':to==='ready'?'final':null;
    if(required&&!(await validApproval(tx,id,Number(row.current_version),required)))
      throw new ContentError('review_required',409);
    const at=now();
    await tx.batch([{sql:'UPDATE content_pieces SET stage=?,revision=revision+1,updated_at=? WHERE id=?',
      args:[to,at,id]},event(p,id,Number(row.current_version),
      to==='script'?'content.script_pending':to==='ready'?'content.ready':'content.stage',at,
      `${row.stage}->${to}`),audit(p,'content.piece.stage','content_piece',id,at)]);
  }).immediate();
}
export async function setHold(p:AdminPrincipal,id:string,reason:string|null,db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const row=await pieceFor(tx,p,id,'edit'),at=now(),hold=reason!==null;
    if(Boolean(row.on_hold)===hold)throw new ContentError('invalid_transition',409);
    const note=hold?requiredText(reason,500,3):null;
    await tx.batch([{sql:`UPDATE content_pieces SET on_hold=?,hold_reason=?,revision=revision+1,
      updated_at=? WHERE id=?`,args:[hold?1:0,note,at,id]},
    event(p,id,Number(row.current_version),hold?'content.hold':'content.resumed',at,note),
    audit(p,hold?'content.piece.hold':'content.piece.resume','content_piece',id,at)]);
  }).immediate();
}
async function activePolicy(db:Pick<Connection,'get'>,brandId:string,projectId:string|null){
  const row=await db.get(`SELECT id,mode FROM content_review_policies WHERE brand_id=?
    AND active=1 AND (project_id=? OR project_id IS NULL)
    ORDER BY project_id IS NOT NULL DESC LIMIT 1`,[brandId,projectId]);
  if(!row)throw new ContentError('policy_missing',503);
  return {id:String(row.id),mode:String(row.mode) as 'simple'|'staged'};
}
async function validApproval(db:Pick<Connection,'get'>,id:string,version:number,stage:string){
  return db.get(`SELECT id FROM content_review_requests WHERE piece_id=? AND version=?
    AND review_stage=? AND status='approved' LIMIT 1`,[id,version,stage]);
}
export async function reviewPolicy(p:AdminPrincipal,brandId:string,projectId:string|null,
  mode:'simple'|'staged',db:Connection=getDatabase()){
  requireBrand(p,brandId,'manageBrand');await assertContentTest(db);
  if(!['simple','staged'].includes(mode))throw new ContentError('invalid_policy');
  if(projectId)await validTarget(db,brandId,
    String((await db.get('SELECT channel FROM content_brand_channels WHERE brand_id=? LIMIT 1',[brandId]))?.channel),
    projectId);
  return db.transactionAsync(async tx=>{
    const old=await tx.get(`SELECT MAX(version) AS version FROM content_review_policies
      WHERE brand_id=? AND project_id IS ?`,[brandId,projectId]);
    const at=now(),id=randomUUID(),version=Number(old?.version??0)+1;
    await tx.batch([{sql:`UPDATE content_review_policies SET active=0
      WHERE brand_id=? AND project_id IS ? AND active=1`,args:[brandId,projectId]},
      {sql:`INSERT INTO content_review_policies(id,brand_id,project_id,version,mode,active,created_by,created_at)
        VALUES(?,?,?,?,?,1,?,?)`,args:[id,brandId,projectId,version,mode,p.id,at]},
      audit(p,'content.policy.change','content_brand',brandId,at)]);
    return id;
  }).immediate();
}
export async function createProject(p:AdminPrincipal,brandId:string,name:string,
  reviewMode:'simple'|'staged'|null,db:Connection=getDatabase()){
  requireBrand(p,brandId,'manageBrand');await assertContentTest(db);
  if(reviewMode&&!['simple','staged'].includes(reviewMode))throw new ContentError('invalid_policy');
  const id=randomUUID(),at=now();
  await db.batch([{sql:`INSERT INTO content_projects
    (id,brand_id,name,review_mode,created_by,created_at) VALUES(?,?,?,?,?,?)`,
    args:[id,brandId,requiredText(name,160,2),reviewMode,p.id,at]},
    audit(p,'content.project.create','content_project',id,at)],'immediate');
  if(reviewMode)await reviewPolicy(p,brandId,id,reviewMode,db);
  return id;
}
export async function setMembership(p:AdminPrincipal,brandId:string,userId:string,
  capabilities:{read:boolean;edit:boolean;review:boolean;recordPublication:boolean;manageBrand:boolean},
  revoke:boolean,db:Connection=getDatabase()){
  if(!p.roles.includes('owner'))throw new ContentError('forbidden',403);
  await assertContentTest(db);
  if(!uuid.test(userId)||userId===p.id&&revoke)throw new ContentError('invalid_user');
  if(!revoke&&!capabilities.read&&
    (capabilities.edit||capabilities.review||capabilities.recordPublication||capabilities.manageBrand))
    throw new ContentError('read_permission_required');
  const user=await db.get('SELECT id,status,workos_user_id FROM altaria_admin_users WHERE id=?',[userId]);
  if(!user||user.status!=='active'||!user.workos_user_id)throw new ContentError('unverified_user',403);
  const brand=await db.get('SELECT id FROM content_brands WHERE id=?',[brandId]);
  if(!brand)throw new ContentError('brand_missing',404);
  const at=now();
  await db.batch([{sql:`INSERT INTO content_brand_memberships
    (user_id,brand_id,can_read,can_edit,can_review,can_record_publication,can_manage_brand,
    granted_by,granted_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,brand_id) DO UPDATE SET can_read=excluded.can_read,
    can_edit=excluded.can_edit,can_review=excluded.can_review,
    can_record_publication=excluded.can_record_publication,
    can_manage_brand=excluded.can_manage_brand,granted_by=excluded.granted_by,
    granted_at=excluded.granted_at,revoked_at=excluded.revoked_at`,
    args:[userId,brandId,revoke?0:capabilities.read?1:0,revoke?0:capabilities.edit?1:0,
      revoke?0:capabilities.review?1:0,revoke?0:capabilities.recordPublication?1:0,
      revoke?0:capabilities.manageBrand?1:0,p.id,at,revoke?at:null]},
    audit(p,revoke?'content.membership.revoke':'content.membership.set',
      'content_brand',brandId,at)],'immediate');
}
export async function listBrandDetails(p:AdminPrincipal,brandId:string,db:Connection=getDatabase()){
  requireBrand(p,brandId,'read');await assertContentTest(db);
  const [brand,channels,projects,policies,guides,members,users,targets]=await Promise.all([
    db.get('SELECT * FROM content_brands WHERE id=?',[brandId]),
    db.all('SELECT * FROM content_brand_channels WHERE brand_id=?',[brandId]),
    db.all('SELECT * FROM content_projects WHERE brand_id=? ORDER BY created_at DESC',[brandId]),
    db.all('SELECT * FROM content_review_policies WHERE brand_id=? ORDER BY created_at DESC',[brandId]),
    db.all('SELECT * FROM content_brand_guide_versions WHERE brand_id=? ORDER BY version DESC',[brandId]),
    db.all(`SELECT m.*,u.display_name,u.email FROM content_brand_memberships m
      JOIN altaria_admin_users u ON u.id=m.user_id WHERE m.brand_id=? ORDER BY u.display_name`,[brandId]),
    p.roles.includes('owner')?db.all(`SELECT id,display_name,email FROM altaria_admin_users
      WHERE status='active' AND workos_user_id IS NOT NULL ORDER BY display_name`):Promise.resolve([]),
    db.all('SELECT * FROM content_frequency_targets WHERE brand_id=?',[brandId]),
  ]);
  if(!brand)throw new ContentError('brand_missing',404);
  return {brand,channels,projects,policies,guides,members: p.roles.includes('owner')?members:[],
    users,targets};
}
export async function saveGuide(p:AdminPrincipal,brandId:string,fields:Record<string,string>,
  approve:boolean,db:Connection=getDatabase()){
  requireBrand(p,brandId,'manageBrand');await assertContentTest(db);
  if(approve&&!p.roles.includes('owner'))throw new ContentError('forbidden',403);
  const keys=['identity','objectives','audience','tone','colors','typography','visualRules',
    'formats','approvedExamples','restrictions'] as const;
  const values=keys.map(k=>optionalText(fields[k],4000));
  if(values.every(v=>!v))throw new ContentError('empty_guide');
  const prev=await db.get('SELECT MAX(version) AS v FROM content_brand_guide_versions WHERE brand_id=?',
    [brandId]);
  const version=Number(prev?.v??0)+1,at=now(),id=randomUUID();
  await db.batch([{sql:`INSERT INTO content_brand_guide_versions
    (id,brand_id,version,identity_text,objectives_text,audience_text,tone_text,colors_text,
    typography_text,visual_rules_text,formats_text,approved_examples_text,restrictions_text,
    source_ref,sha256,status,created_by,approved_by,created_at,approved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'local:editorial',?,?,?,?,?,?)`,
    args:[id,brandId,version,...values,hash(values),approve?'approved':'draft',p.id,
      approve?p.id:null,at,approve?at:null]},
    audit(p,'content.guide.version','content_brand',brandId,at)],'immediate');
  return id;
}
export async function linkCrm(p:AdminPrincipal,pieceId:string,organizationId:string,
  opportunityId:string|null,db:Connection=getDatabase()){
  if(!hasAdminPermission(p,'crm:read'))throw new ContentError('forbidden',403);
  await assertContentTest(db);const piece=await pieceFor(db,p,pieceId,'edit');
  if(!uuid.test(organizationId)||opportunityId&&!uuid.test(opportunityId))
    throw new ContentError('invalid_context');
  const org=await db.get('SELECT id,responsible_user_id,status FROM crm_organizations WHERE id=?',
    [organizationId]);
  if(!org||org.status!=='active'||!p.roles.includes('owner')&&org.responsible_user_id!==p.id)
    throw new ContentError('forbidden',403);
  if(opportunityId&&!await db.get(`SELECT id FROM crm_opportunities
    WHERE id=? AND organization_id=?`,[opportunityId,organizationId]))throw new ContentError('invalid_context');
  const id=randomUUID(),at=now();
  await db.batch([{sql:`INSERT INTO content_crm_links
    (id,piece_id,organization_id,opportunity_id,link_type,linked_by,linked_at)
    VALUES(?,?,?,?,'context',?,?)`,args:[id,pieceId,organizationId,opportunityId,p.id,at]},
    audit(p,'content.crm.link','content_piece',String(piece.id),at)],'immediate');
}
export async function setFrequency(p:AdminPrincipal,brandId:string,channel:string,
  period:'week'|'month',target:number,db:Connection=getDatabase()){
  requireBrand(p,brandId,'manageBrand');await assertContentTest(db);
  if(!['week','month'].includes(period)||!Number.isInteger(target)||target<0||target>100)
    throw new ContentError('invalid_target');
  const at=now();
  await db.batch([{sql:`INSERT INTO content_frequency_targets
    (brand_id,channel,period,target_count,updated_by,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(brand_id,channel) DO UPDATE SET period=excluded.period,
    target_count=excluded.target_count,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    args:[brandId,channel,period,target,p.id,at]},
    audit(p,'content.frequency.set','content_brand',brandId,at)],'immediate');
}
export async function activateBrand(p:AdminPrincipal,brandId:string,evidence:string,
  db:Connection=getDatabase()){
  if(!p.roles.includes('owner'))throw new ContentError('forbidden',403);
  await assertContentTest(db);const note=requiredText(evidence,500,10),at=now();
  const row=await db.get('SELECT status FROM content_brands WHERE id=?',[brandId]);
  if(row?.status!=='planned')throw new ContentError('invalid_transition',409);
  await db.batch([{sql:`UPDATE content_brands SET status='active',updated_at=? WHERE id=?`,
    args:[at,brandId]},
    {sql:`UPDATE content_brand_channels SET status='active'
      WHERE brand_id=? AND status='planned'`,args:[brandId]},
    {sql:`INSERT INTO altaria_admin_audit_events
      (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
      VALUES (?,?,?,?,?,'content_brand',?,'success',?)`,
      args:[randomUUID(),at,p.id,p.sessionHash,'content.brand.activate',brandId,
        JSON.stringify({rightsEvidenceSha256:hash(note)})]}],'immediate');
}
export {pieceFor,activePolicy,validApproval,hash,audit,event,now};
