import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {connect,type Connection} from '@tursodatabase/serverless';
import {describe,expect,it} from 'vitest';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from '../scripts/lib/test-isolation.mjs';
import {hasAdminPermission,type AdminPrincipal} from '../src/lib/admin/access';
import {changeStage,createPiece,getPiece,linkCrm,listBrands,listPieces,revisePiece,
  reviewPolicy,saveGuide,setHold} from '../src/lib/admin/content/service';
import {createAsset,deleteAsset,readPrivateAsset,
  type ContentStorage} from '../src/lib/admin/content/storage';
import {archivePiece,confirmSyntheticPublication,decideReview,recordMetric,
  requestReview,schedulePiece} from '../src/lib/admin/content/workflow';
import {dispatchOutbox,processOneJob} from '../src/lib/admin/automation/engine';
import {completeWorkItem,listMyWork} from '../src/lib/admin/automation/work';

describe('Content OS aislado en Turso TEST',()=>{
  it('protege permisos, revisiones, publicación y archivos sintéticos con rollback',async()=>{
    expect(process.env.ALTARIA_PHASE65C_INTEGRATION_TEST).toBe('1');
    const t=readProjectEnv('.env.test'),prod=readProjectEnv('.env');
    if(!t?.TURSO_DATABASE_URL||!t.TURSO_AUTH_TOKEN)throw new Error('Falta TEST.');
    assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
      approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:prod as never});
    assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
      webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:prod as never});
    assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
      redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,
      productionEnv:prod as never});
    const token=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1]??'',
      'base64url').toString());
    expect(token.exp*1000).toBeGreaterThan(Date.now());
    const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
    await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
    for(const n of ['019_altaria_os_content_core.sql','020_altaria_os_content_workflow.sql',
      '021_altaria_os_content_version_format.sql']){
      const expected=createHash('sha256').update(readFileSync(`migrations/${n}`)).digest('hex');
      expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',[n]))?.sha256)
        .toBe(expected);
    }
    Object.assign(process.env,{ALTARIA_TEST_ISOLATED:'1',
      ALTARIA_TEST_DB_MARKER:t.ALTARIA_TEST_DB_MARKER,
      ALTARIA_TEST_TURSO_URL:t.ALTARIA_TEST_TURSO_URL,
      TURSO_DATABASE_URL:t.TURSO_DATABASE_URL,STRIPE_MODE:'test',
      STRIPE_SECRET_KEY:t.STRIPE_SECRET_KEY});
    const rollback=new Error('ROLLBACK_SYNTHETIC_CONTENT');
    const objects=new Map<string,Uint8Array>();
    const storage:ContentStorage={
      async put(key,bytes){objects.set(key,bytes);},
      async read(key){const bytes=objects.get(key);if(!bytes)throw new Error('missing');return bytes;},
      async remove(key){objects.delete(key);},
    };
    try{await db.transactionAsync(async tx=>{
      const wrapped={get:tx.get.bind(tx),all:tx.all.bind(tx),run:tx.run.bind(tx),
        batch:tx.batch.bind(tx),
        transactionAsync:(callback:(conn:typeof tx)=>Promise<unknown>)=>({immediate:()=>callback(tx)})
      } as unknown as Connection;
      const at=new Date().toISOString(),ownerId=randomUUID(),editorId=randomUUID(),strangerId=randomUUID();
      for(const [id,label] of [[ownerId,'owner'],[editorId,'editor'],[strangerId,'stranger']]){
        await tx.run(`INSERT INTO altaria_admin_users(id,email,workos_user_id,display_name,status,created_at,updated_at)
          VALUES (?,?,?,'Persona sintética','active',?,?)`,
          [id,`${label}.content@example.test`,`user_synthetic_${id}`,at,at]);
      }
      await tx.run('INSERT INTO altaria_admin_user_roles(user_id,role_key,granted_at) VALUES (?,?,?)',
        [ownerId,'owner',at]);
      await tx.run(`INSERT INTO content_brand_memberships(user_id,brand_id,can_read,can_edit,
        can_review,can_record_publication,can_manage_brand,granted_by,granted_at)
        VALUES (?,'altaria-cards',1,1,0,0,0,?,?)`,[editorId,ownerId,at]);
      const principal=(id:string,roles:AdminPrincipal['roles'],grant=false):AdminPrincipal=>({
        id,email:'synthetic@example.test',displayName:'Sintético',roles,
        sessionHash:`synthetic-${id}`,contentGrants:grant?[{brandId:'altaria-cards',read:true,
          edit:true,review:false,recordPublication:false,manageBrand:false}]:[]});
      const owner=principal(ownerId,['owner']),editor=principal(editorId,[],true),
        stranger=principal(strangerId,[]);
      const allBrandEditor={...editor,contentGrants:['martin-altaria','altaria-cards','de-zamorano']
        .map(brandId=>({brandId,read:true,edit:true,review:false,
          recordPublication:false,manageBrand:false}))};
      expect(new Set((await listBrands(allBrandEditor,wrapped)).map(b=>b.id)).size).toBe(3);
      for(const permission of ['crm:read','crm:write','cards:read','cards:write',
        'cards:artwork','settings:read','users:manage'] as const)
        expect(hasAdminPermission(allBrandEditor,permission)).toBe(false);
      expect(hasAdminPermission(allBrandEditor,'content:read')).toBe(true);
      expect((await listBrands(editor,wrapped)).length).toBe(1);
      expect(new Set((await listBrands(owner,wrapped)).map(b=>b.id)).size).toBe(3);
      const input={brandId:'altaria-cards',channel:'instagram',title:'Pieza sintética para TEST',
        format:'Post',brief:'Prueba editorial aislada'};
      await expect(createPiece(stranger,input,wrapped)).rejects.toMatchObject({code:'forbidden'});
      await expect(createPiece(editor,{...input,brandId:'de-zamorano'},wrapped))
        .rejects.toMatchObject({code:'forbidden'});
      const piece=await createPiece(editor,input,wrapped);
      expect((await getPiece(owner,piece,wrapped)).current.version).toBe(1);
      expect((await listPieces(editor,{q:'sintética'},wrapped)).some(x=>x.id===piece)).toBe(true);
      await expect(getPiece(stranger,piece,wrapped)).rejects.toMatchObject({code:'forbidden'});
      await expect(changeStage(editor,piece,'ready',1,wrapped)).rejects.toMatchObject({code:'invalid_transition'});
      await setHold(editor,piece,'En espera por revisión',wrapped);
      await expect(changeStage(editor,piece,'script',2,wrapped)).rejects.toMatchObject({code:'piece_on_hold'});
      await setHold(editor,piece,null,wrapped);
      const revised=await revisePiece(editor,piece,{...input,title:'Pieza sintética revisada',
        format:'Reel'},1,wrapped);
      expect(revised).toBe(2);
      expect((await getPiece(owner,piece,wrapped,1)).current.format_snapshot).toBe('Post');
      expect((await getPiece(owner,piece,wrapped,2)).current.format_snapshot).toBe('Reel');
      await expect(tx.run('UPDATE content_piece_versions SET title=? WHERE piece_id=? AND version=1',
        ['Manipulación',piece])).rejects.toThrow();
      const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);
      const uploadKey=randomUUID();
      const asset=await createAsset(editor,'altaria-cards','mock.png','image/png',png,
        'original','local:test','Licencia sintética TEST',wrapped,storage,uploadKey,piece);
      expect(await createAsset(editor,'altaria-cards','mock.png','image/png',png,
        'original','local:test','Licencia sintética TEST',wrapped,storage,uploadKey,piece)).toBe(asset);
      expect(objects.size).toBe(1);
      expect(Number((await tx.get('SELECT COUNT(*) AS n FROM content_piece_assets WHERE asset_id=?',
        [asset]))?.n)).toBe(1);
      await expect(createAsset(editor,'altaria-cards','different.png','image/png',png,
        'original','local:test','Licencia sintética TEST',wrapped,storage,uploadKey,piece))
        .rejects.toMatchObject({code:'upload_request_conflict'});
      const inheritedPiece=await createPiece(owner,{...input,title:'TEST herencia de recurso'},wrapped);
      const inheritedAsset=await createAsset(owner,'altaria-cards','inherit.png','image/png',png,
        'work','local:test','Licencia sintética TEST',wrapped,storage,randomUUID(),inheritedPiece);
      await revisePiece(owner,inheritedPiece,{...input,title:'TEST nueva versión heredada'},1,wrapped);
      expect((await getPiece(owner,inheritedPiece,wrapped)).assets
        .filter(a=>a.id===inheritedAsset).map(a=>Number(a.version)).sort()).toEqual([1,2]);
      expect((await readPrivateAsset(editor,asset,wrapped,storage)).bytes).toEqual(png);
      await expect(readPrivateAsset(stranger,asset,wrapped,storage))
        .rejects.toMatchObject({code:'forbidden'});
      await expect(deleteAsset(owner,asset,wrapped,storage))
        .rejects.toMatchObject({code:'asset_in_use'});
      const spare=await createAsset(editor,'altaria-cards','spare.png','image/png',png,
        'reference','local:test','Licencia sintética TEST',wrapped,storage);
      await deleteAsset(owner,spare,wrapped,storage);
      await expect(readPrivateAsset(owner,spare,wrapped,storage))
        .rejects.toMatchObject({code:'asset_missing'});
      for(const stage of ['script','visuals','editing','review'] as const){
        const current=await tx.get('SELECT revision FROM content_pieces WHERE id=?',[piece]);
        await changeStage(editor,piece,stage,Number(current?.revision),wrapped);
        if(stage==='script'){
          await dispatchOutbox(wrapped,100);
          for(let i=0;i<5;i++){
            if(await tx.get(`SELECT id FROM os_work_items WHERE source_type='content_piece'
              AND source_id=? AND status='open'`,[piece]))break;
            await processOneJob(wrapped);
          }
          const work=await tx.get(`SELECT id FROM os_work_items WHERE source_type='content_piece'
            AND source_id=? AND status='open'`,[piece]);
          expect(work?.id).toBeTruthy();
          expect((await listMyWork(editor,wrapped)).some(w=>w.href.endsWith(piece))).toBe(true);
          await expect(listMyWork(stranger,wrapped)).rejects.toMatchObject({code:'forbidden'});
          await expect(completeWorkItem(editor,String(work?.id),wrapped))
            .rejects.toMatchObject({code:'editorial_action_required'});
        }
      }
      const request=await requestReview(editor,piece,'final',null,wrapped);
      await expect(decideReview(editor,request,'approved','',wrapped))
        .rejects.toMatchObject({code:'forbidden'});
      await decideReview(owner,request,'approved','Revisión del propietario TEST',wrapped);
      const current=await tx.get('SELECT revision FROM content_pieces WHERE id=?',[piece]);
      await changeStage(editor,piece,'ready',Number(current?.revision),wrapped);
      await expect(schedulePiece(editor,piece,'2026-10-20T10:00:00Z',wrapped))
        .rejects.toMatchObject({code:'forbidden'});
      await schedulePiece(owner,piece,'2026-10-20T10:00:00Z',wrapped);
      await expect(confirmSyntheticPublication(owner,piece,'Publicado sin evidencia',wrapped))
        .rejects.toMatchObject({code:'synthetic_evidence_required'});
      await confirmSyntheticPublication(owner,piece,'TEST: publicación sintética confirmada',wrapped);
      await recordMetric(owner,piece,'views','123','count','Fuente de prueba sintética',wrapped);
      await archivePiece(owner,piece,wrapped);
      expect((await getPiece(owner,piece,wrapped)).piece.publication_state).toBe('archived');
      expect(Number((await tx.get('SELECT COUNT(*) AS n FROM altaria_admin_audit_events WHERE target_id=?',
        [piece]))?.n)).toBeGreaterThan(5);
      const orgId=randomUUID();
      await tx.run(`INSERT INTO crm_organizations(id,name,normalized_name,lead_origin,
        responsible_user_id,created_at,updated_at)
        VALUES (?,'Empresa editorial TEST','empresa editorial test','manual',?,?,?)`,
        [orgId,ownerId,at,at]);
      await expect(linkCrm(editor,piece,orgId,null,wrapped))
        .rejects.toMatchObject({code:'forbidden'});
      await linkCrm(owner,piece,orgId,null,wrapped);
      expect((await getPiece(owner,piece,wrapped)).crmLinks[0].organization_id).toBe(orgId);
      expect((await getPiece(editor,piece,wrapped)).crmLinks[0].organization_id).toBeUndefined();
      await reviewPolicy(owner,'altaria-cards',null,'staged',wrapped);
      await saveGuide(owner,'altaria-cards',{identity:'Identidad TEST'},false,wrapped);
      const staged=await createPiece(editor,{...input,title:'Revisión por etapas TEST'},wrapped);
      const advance=async(to:'script'|'visuals'|'editing'|'review'|'ready')=>{
        const row=await tx.get('SELECT revision FROM content_pieces WHERE id=?',[staged]);
        await changeStage(editor,staged,to,Number(row?.revision),wrapped);
      };
      await advance('script');
      await expect(advance('visuals')).rejects.toMatchObject({code:'review_required'});
      const scriptReview=await requestReview(editor,staged,'script',null,wrapped);
      await decideReview(owner,scriptReview,'approved','',wrapped);
      await advance('visuals');
      await expect(advance('editing')).rejects.toMatchObject({code:'review_required'});
      const visualReview=await requestReview(editor,staged,'visuals',null,wrapped);
      await decideReview(owner,visualReview,'approved','',wrapped);
      await advance('editing');await advance('review');
      const finalReview=await requestReview(editor,staged,'final',null,wrapped);
      await decideReview(owner,finalReview,'approved','',wrapped);
      await advance('ready');
      await revisePiece(editor,staged,{...input,title:'Nueva versión tras aprobación'},1,wrapped);
      expect((await tx.get('SELECT status FROM content_review_requests WHERE id=?',
        [finalReview]))?.status).toBe('superseded');
      await expect(advance('ready')).rejects.toMatchObject({code:'review_required'});
      throw rollback;
    }).immediate();}catch(error){if(error!==rollback)throw error;}
    expect((await db.get('SELECT id FROM altaria_admin_users WHERE email=?',
      ['editor.content@example.test']))).toBeUndefined();
  });
});
