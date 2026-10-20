import {randomUUID} from 'node:crypto';
import type {Connection} from '@tursodatabase/serverless';
import {getDatabase} from '../../db/client';
import type {AdminPrincipal} from '../access';
import {ContentError,requireBrand,requiredText,optionalText,optionalDate} from './model';
import {activePolicy,assertContentTest,audit,event,hash,now,pieceFor,validApproval} from './service';

async function assetDigest(db:Pick<Connection,'all'>,pieceId:string,version:number){
  const assets=await db.all(`SELECT a.id,a.sha256,a.status,l.purpose FROM content_piece_assets l
    JOIN content_assets a ON a.id=l.asset_id WHERE l.piece_id=? AND l.version=?
    ORDER BY a.id`,[pieceId,version]);
  if(assets.some(a=>a.status!=='verified'))throw new ContentError('asset_not_verified',409);
  return hash(assets.map(a=>[a.id,a.sha256,a.purpose]));
}
export async function listPendingContentReviews(p:AdminPrincipal,db:Connection=getDatabase()){
  await assertContentTest(db);
  const rows=await db.all(`SELECT r.id,r.piece_id,r.version,r.review_stage,r.requested_at,
    r.requested_by,r.reviewer_user_id,q.brand_id,q.title,b.name AS brand_name
    FROM content_review_requests r JOIN content_pieces q ON q.id=r.piece_id
    JOIN content_brands b ON b.id=q.brand_id
    WHERE r.status='pending' AND r.version=q.current_version AND b.status='active'
    ORDER BY r.requested_at DESC LIMIT 100`);
  return rows.filter(row=>{
    try{requireBrand(p,String(row.brand_id),'review');return !row.reviewer_user_id
      ||row.reviewer_user_id===p.id||p.roles.includes('owner');}catch{return false;}
  });
}
export async function requestReview(p:AdminPrincipal,id:string,stage:'script'|'visuals'|'final',
  reviewerUserId:string|null,db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const piece=await pieceFor(tx,p,id,'edit'),policy=await activePolicy(tx,String(piece.brand_id),
      piece.project_id?String(piece.project_id):null);
    const expected=piece.stage==='script'?'script':piece.stage==='visuals'?'visuals':
      piece.stage==='review'?'final':null;
    if(piece.on_hold||!expected||stage!==expected||policy.mode==='simple'&&stage!=='final')
      throw new ContentError('invalid_review_stage',409);
    if(stage==='visuals'&&!(await validApproval(tx,id,Number(piece.current_version),'script')))
      throw new ContentError('review_required',409);
    if(stage==='final'&&policy.mode==='staged'&&
      (!(await validApproval(tx,id,Number(piece.current_version),'script'))
        ||!(await validApproval(tx,id,Number(piece.current_version),'visuals'))))
      throw new ContentError('review_required',409);
    if(reviewerUserId){
      const reviewer=await tx.get(`SELECT u.id FROM altaria_admin_users u
        LEFT JOIN altaria_admin_user_roles r ON r.user_id=u.id AND r.role_key='owner'
        LEFT JOIN content_brand_memberships m ON m.user_id=u.id AND m.brand_id=?
          AND m.can_review=1 AND m.revoked_at IS NULL
        WHERE u.id=? AND u.status='active' AND (r.user_id IS NOT NULL OR m.user_id IS NOT NULL)`,
        [piece.brand_id,reviewerUserId]);
      if(!reviewer)throw new ContentError('invalid_reviewer',403);
    }
    const version=Number(piece.current_version);
    const v=await tx.get('SELECT sha256 FROM content_piece_versions WHERE piece_id=? AND version=?',
      [id,version]);
    if(!v)throw new ContentError('version_missing',404);
    const manifest=await assetDigest(tx,id,version),at=now(),rid=randomUUID();
    await tx.batch([{sql:`INSERT INTO content_review_requests
      (id,piece_id,version,review_stage,policy_id,policy_mode,snapshot_sha256,
      asset_manifest_sha256,requested_by,reviewer_user_id,requested_at,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,args:[rid,id,version,stage,policy.id,policy.mode,
        String(v.sha256),manifest,p.id,reviewerUserId,at,`content.review:${id}:${version}:${stage}`]},
      event(p,id,version,'content.review_requested',at,stage),
      audit(p,'content.review.request','content_piece',id,at)],'immediate');
    return rid;
  }).immediate();
}
export async function decideReview(p:AdminPrincipal,requestId:string,
  decision:'approved'|'rejected',reason:string,db:Connection=getDatabase()){
  await assertContentTest(db);
  if(!['approved','rejected'].includes(decision))throw new ContentError('invalid_decision');
  return db.transactionAsync(async tx=>{
    const request=await tx.get(`SELECT r.*,q.brand_id,q.current_version,q.stage,q.on_hold
      FROM content_review_requests r JOIN content_pieces q ON q.id=r.piece_id WHERE r.id=?`,
      [requestId]);
    if(!request)throw new ContentError('review_missing',404);
    requireBrand(p,String(request.brand_id),'review');
    if(request.status!=='pending'||Number(request.version)!==Number(request.current_version))
      throw new ContentError('review_stale',409);
    if(request.reviewer_user_id&&request.reviewer_user_id!==p.id&&!p.roles.includes('owner'))
      throw new ContentError('forbidden',403);
    const self=request.requested_by===p.id;
    const note=optionalText(reason,1000);
    if(self&&(!p.roles.includes('owner')||note.length<10))
      throw new ContentError('self_review_requires_owner_reason',403);
    if(decision==='rejected'&&note.length<3)throw new ContentError('reason_required');
    const version=await tx.get('SELECT sha256 FROM content_piece_versions WHERE piece_id=? AND version=?',
      [request.piece_id,request.version]);
    if(!version||version.sha256!==request.snapshot_sha256
      ||await assetDigest(tx,String(request.piece_id),Number(request.version))
        !==request.asset_manifest_sha256)throw new ContentError('review_stale',409);
    const at=now();
    await tx.batch([{sql:`UPDATE content_review_requests SET status=?,decided_at=?
      WHERE id=? AND status='pending'`,args:[decision,at,requestId]},
      {sql:`INSERT INTO content_review_decisions
        (id,request_id,decision,reason,owner_self_override,actor_user_id,decided_at)
        VALUES(?,?,?,?,?,?,?)`,args:[randomUUID(),requestId,decision,note||null,self?1:0,p.id,at]},
      event(p,String(request.piece_id),Number(request.version),
        decision==='approved'?'content.review.approved':'content.review.rejected',at,
        String(request.review_stage)),
      audit(p,`content.review.${decision}`,'content_piece',String(request.piece_id),at)],'immediate');
    return decision;
  }).immediate();
}
export async function schedulePiece(p:AdminPrincipal,id:string,scheduledAt:string,
  db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const piece=await pieceFor(tx,p,id,'recordPublication');
    if(piece.stage!=='ready'||piece.publication_state!=='none'||piece.on_hold)
      throw new ContentError('not_ready',409);
    if(!await validApproval(tx,id,Number(piece.current_version),'final'))
      throw new ContentError('review_required',409);
    const date=optionalDate(scheduledAt);
    if(!date)throw new ContentError('invalid_date');
    const at=now(),rid=randomUUID();
    await tx.batch([{sql:`INSERT INTO content_publication_records
      (id,piece_id,version,brand_id,channel,scheduled_at,scheduled_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`,args:[rid,id,Number(piece.current_version),String(piece.brand_id),
        String(piece.channel),date,p.id,at]},
      {sql:`UPDATE content_pieces SET publication_state='scheduled',
        revision=revision+1,updated_at=? WHERE id=?`,args:[at,id]},
      event(p,id,Number(piece.current_version),'content.scheduled',at),
      audit(p,'content.publication.schedule','content_piece',id,at)],'immediate');
    return rid;
  }).immediate();
}
export async function confirmSyntheticPublication(p:AdminPrincipal,id:string,
  evidence:string,db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const piece=await pieceFor(tx,p,id,'recordPublication');
    if(piece.publication_state!=='scheduled')throw new ContentError('not_scheduled',409);
    const record=await tx.get(`SELECT * FROM content_publication_records
      WHERE piece_id=? AND status='scheduled'`,[id]);
    if(!record||Number(record.version)!==Number(piece.current_version))
      throw new ContentError('publication_stale',409);
    const note=requiredText(evidence,500,10);
    if(!note.startsWith('TEST:'))throw new ContentError('synthetic_evidence_required',409);
    const at=now();
    await tx.batch([{sql:`UPDATE content_publication_records SET status='confirmed',
      evidence_method='synthetic_test',evidence_note=?,verified_by=?,confirmed_at=?
      WHERE id=? AND status='scheduled'`,args:[note,p.id,at,record.id]},
      {sql:`UPDATE content_pieces SET publication_state='published',revision=revision+1,
        updated_at=? WHERE id=?`,args:[at,id]},
      event(p,id,Number(piece.current_version),'content.published.synthetic',at),
      audit(p,'content.publication.synthetic','content_piece',id,at)],'immediate');
  }).immediate();
}
export async function recordMetric(p:AdminPrincipal,id:string,metricKey:string,
  value:string,unit:string,sourceNote:string,db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const piece=await pieceFor(tx,p,id,'recordPublication');
    if(!['published','analyzed'].includes(String(piece.publication_state)))
      throw new ContentError('not_published',409);
    const record=await tx.get(`SELECT id FROM content_publication_records
      WHERE piece_id=? AND status='confirmed' ORDER BY confirmed_at DESC LIMIT 1`,[id]);
    if(!record)throw new ContentError('publication_missing',409);
    const unavailable=value.trim()==='',parsed=unavailable?null:Number(value);
    if(parsed!==null&&(!Number.isSafeInteger(parsed)||parsed<0))throw new ContentError('invalid_metric');
    const at=now();
    await tx.batch([{sql:`INSERT INTO content_metrics
      (id,publication_id,metric_key,metric_value,unit,source,source_note,observed_at,actor_user_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,args:[randomUUID(),record.id,requiredText(metricKey,80,2),
        parsed,requiredText(unit,40,2),unavailable?'unavailable':'manual',
        requiredText(sourceNote,500,3),at,p.id]},
      {sql:`UPDATE content_pieces SET publication_state='analyzed',
        revision=revision+1,updated_at=? WHERE id=?`,args:[at,id]},
      event(p,id,Number(piece.current_version),'content.analyzed',at),
      audit(p,'content.metric.record','content_piece',id,at)],'immediate');
  }).immediate();
}
export async function archivePiece(p:AdminPrincipal,id:string,db:Connection=getDatabase()){
  await assertContentTest(db);
  return db.transactionAsync(async tx=>{
    const piece=await pieceFor(tx,p,id,'recordPublication');
    if(piece.publication_state!=='analyzed')throw new ContentError('invalid_transition',409);
    const at=now();
    await tx.batch([{sql:`UPDATE content_pieces SET publication_state='archived',
      revision=revision+1,updated_at=? WHERE id=?`,args:[at,id]},
      event(p,id,Number(piece.current_version),'content.archived',at),
      audit(p,'content.piece.archive','content_piece',id,at)],'immediate');
  }).immediate();
}
