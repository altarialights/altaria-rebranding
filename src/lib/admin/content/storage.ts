import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,unlink,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {getDatabase} from '../../db/client';
import type {Connection} from '@tursodatabase/serverless';
import type {AdminPrincipal} from '../access';
import {ContentError,requireBrand,requiredText,uuid} from './model';
import {assertContentTest,audit,now,pieceFor} from './service';

export interface ContentStorage {
  put(key:string,bytes:Uint8Array):Promise<void>;
  read(key:string):Promise<Uint8Array>;
  remove(key:string):Promise<void>;
}
const root=resolve(process.cwd(),'.altaria-content-test','objects');
const keyPattern=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|mp4|pdf)$/;
async function safePath(key:string){
  if(!keyPattern.test(key))throw new ContentError('invalid_storage_key',400);
  await mkdir(root,{recursive:true,mode:0o700});
  const actualRoot=await realpath(root);
  if(actualRoot!==root)throw new ContentError('storage_path_unsafe',503);
  const dir=join(root,key.split('/')[0]);
  await mkdir(dir,{recursive:true,mode:0o700});
  const actual=await realpath(dir);
  if(!actual.startsWith(actualRoot+sep))throw new ContentError('storage_path_unsafe',503);
  return join(actual,key.split('/')[1]);
}
export const mockLocalStorage:ContentStorage={
  async put(key,bytes){await writeFile(await safePath(key),bytes,{flag:'wx',mode:0o600});},
  async read(key){return readFile(await safePath(key));},
  async remove(key){try{await unlink(await safePath(key));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}},
};
const formats=[
  {mime:'image/png',ext:'png',check:(b:Uint8Array)=>b.length>8&&
    [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)},
  {mime:'image/jpeg',ext:'jpg',check:(b:Uint8Array)=>b.length>4&&b[0]===255&&b[1]===216&&b[2]===255},
  {mime:'image/webp',ext:'webp',check:(b:Uint8Array)=>b.length>12&&
    Buffer.from(b.subarray(0,4)).toString()==='RIFF'&&Buffer.from(b.subarray(8,12)).toString()==='WEBP'},
  {mime:'video/mp4',ext:'mp4',check:(b:Uint8Array)=>b.length>12&&
    Buffer.from(b.subarray(4,8)).toString()==='ftyp'},
  {mime:'application/pdf',ext:'pdf',check:(b:Uint8Array)=>b.length>5&&
    Buffer.from(b.subarray(0,5)).toString()==='%PDF-'},
] as const;
function classify(bytes:Uint8Array,declared:string){
  const detected=formats.find(x=>x.check(bytes));
  if(!detected||detected.mime!==declared)throw new ContentError('unsupported_media',400);
  return detected;
}
function maxBytes(){
  const configured=Number(process.env.ALTARIA_CONTENT_TEST_MAX_BYTES||20*1024*1024);
  return Number.isSafeInteger(configured)&&configured>0
    ?Math.min(configured,20*1024*1024):20*1024*1024;
}
export async function createAsset(p:AdminPrincipal,brandId:string,fileName:string,mime:string,
  bytes:Uint8Array,assetClass:'original'|'work'|'final'|'reference',
  sourceRef:string,rightsNote:string,db:Connection=getDatabase(),storage:ContentStorage=mockLocalStorage,
  requestKey?:string,pieceId?:string){
  requireBrand(p,brandId,'edit');await assertContentTest(db);
  if(!['original','work','final','reference'].includes(assetClass))throw new ContentError('invalid_asset_class');
  if(bytes.length<1||bytes.length>maxBytes())throw new ContentError('media_too_large',413);
  const detected=classify(bytes,mime);
  const brand=await db.get('SELECT status FROM content_brands WHERE id=?',[brandId]);
  if(brand?.status!=='active')throw new ContentError('brand_unavailable',409);
  if(requestKey!==undefined&&!uuid.test(requestKey))throw new ContentError('invalid_upload_request');
  const digest=requestKey?createHash('sha256').update(`${p.id}:${brandId}:${requestKey}`).digest('hex'):null;
  const id=digest?`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`:randomUUID();
  const key=`${randomUUID()}/${randomUUID()}.${detected.ext}`;
  const name=requiredText(fileName.replace(/[\\/\x00-\x1f]/g,'_'),180);
  const sha=createHash('sha256').update(bytes).digest('hex'),at=now();
  const source=requiredText(sourceRef,500,3),rights=requiredText(rightsNote,500,3);
  const piece=pieceId?await pieceFor(db,p,pieceId,'edit'):null;
  if(piece&&(piece.brand_id!==brandId||piece.publication_state!=='none'))
    throw new ContentError('piece_unavailable',409);
  if(piece&&await db.get(`SELECT id FROM content_review_requests WHERE piece_id=?
    AND version=? LIMIT 1`,[pieceId,Number(piece.current_version)]))
    throw new ContentError('version_reviewed_create_new',409);
  const matching=async()=>{
    const previous=await db.get('SELECT * FROM content_assets WHERE id=?',[id]);
    if(!previous)return false;
    if(previous.brand_id!==brandId||previous.created_by!==p.id||previous.status!=='verified'
      ||previous.file_name!==name||previous.mime_type!==detected.mime
      ||Number(previous.byte_size)!==bytes.length||previous.sha256!==sha
      ||previous.source_ref!==source||previous.rights_note!==rights||previous.asset_class!==assetClass)
      throw new ContentError('upload_request_conflict',409);
    if(piece){
      const linked=await db.get('SELECT piece_id,version FROM content_piece_assets WHERE asset_id=?',[id]);
      if(linked?.piece_id!==pieceId||Number(linked?.version)!==Number(piece.current_version))
        throw new ContentError('upload_request_conflict',409);
    }
    return true;
  };
  if(digest&&await matching())return id;
  await storage.put(key,bytes);
  try{
    await db.batch([{sql:`INSERT INTO content_assets
      (id,brand_id,asset_class,environment,provider,storage_key,file_name,mime_type,
      byte_size,sha256,source_ref,rights_note,status,created_by,created_at)
      VALUES(?,?,?,'test','mock_local',?,?,?,?,?,?,?,'verified',?,?)`,
      args:[id,brandId,assetClass,key,name,detected.mime,bytes.length,sha,
        source,rights,p.id,at]},
      ...(piece?[{sql:`INSERT INTO content_piece_assets
        (piece_id,version,brand_id,asset_id,purpose,added_by,added_at)
        VALUES(?,?,?,?,?,?,?)`,args:[pieceId!,Number(piece.current_version),brandId,id,
          assetClass,p.id,at]}]:[]),
      audit(p,'content.asset.create','content_asset',id,at),
      ...(piece?[audit(p,'content.asset.link','content_piece',pieceId!,at)]:[])],'immediate');
  }catch(error){await storage.remove(key);if(digest&&await matching())return id;throw error;}
  return id;
}
export async function listAssets(p:AdminPrincipal,brandId:string,db:Connection=getDatabase()){
  requireBrand(p,brandId,'read');await assertContentTest(db);
  return db.all(`SELECT id,asset_class,file_name,mime_type,byte_size,sha256,source_ref,
    rights_note,status,created_at FROM content_assets WHERE brand_id=? AND status<>'deleted'
    ORDER BY created_at DESC LIMIT 200`,[brandId]);
}
export async function readPrivateAsset(p:AdminPrincipal,id:string,db:Connection=getDatabase(),
  storage:ContentStorage=mockLocalStorage){
  await assertContentTest(db);
  if(!uuid.test(id))throw new ContentError('asset_missing',404);
  const asset=await db.get('SELECT * FROM content_assets WHERE id=?',[id]);
  if(!asset||asset.status!=='verified'||asset.environment!=='test'||asset.provider!=='mock_local')
    throw new ContentError('asset_missing',404);
  requireBrand(p,String(asset.brand_id),'read');
  const bytes=await storage.read(String(asset.storage_key));
  if(bytes.length!==Number(asset.byte_size)
    ||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)
    throw new ContentError('asset_integrity',503);
  return {bytes,mime:String(asset.mime_type),name:String(asset.file_name)};
}
export async function linkAsset(p:AdminPrincipal,pieceId:string,assetId:string,
  purpose:'original'|'work'|'final'|'reference',db:Connection=getDatabase()){
  await assertContentTest(db);
  if(!uuid.test(assetId)||!['original','work','final','reference'].includes(purpose))
    throw new ContentError('invalid_asset');
  const piece=await pieceFor(db,p,pieceId,'edit');
  if(piece.publication_state!=='none')throw new ContentError('publication_locked',409);
  const asset=await db.get(`SELECT id FROM content_assets
    WHERE id=? AND brand_id=? AND status='verified'`,[assetId,piece.brand_id]);
  if(!asset)throw new ContentError('asset_missing',404);
  const review=await db.get(`SELECT id FROM content_review_requests WHERE piece_id=?
    AND version=? LIMIT 1`,[pieceId,piece.current_version]);
  if(review)throw new ContentError('version_reviewed_create_new',409);
  const at=now();
  await db.batch([{sql:`INSERT INTO content_piece_assets
    (piece_id,version,brand_id,asset_id,purpose,added_by,added_at)
    VALUES(?,?,?,?,?,?,?)`,args:[pieceId,Number(piece.current_version),String(piece.brand_id),
      assetId,purpose,p.id,at]},
    audit(p,'content.asset.link','content_piece',pieceId,at)],'immediate');
}
export async function deleteAsset(p:AdminPrincipal,id:string,db:Connection=getDatabase(),
  storage:ContentStorage=mockLocalStorage){
  await assertContentTest(db);
  const asset=await db.get('SELECT * FROM content_assets WHERE id=?',[id]);
  if(!asset||asset.status==='deleted')throw new ContentError('asset_missing',404);
  requireBrand(p,String(asset.brand_id),'manageBrand');
  if(await db.get('SELECT asset_id FROM content_piece_assets WHERE asset_id=? LIMIT 1',[id]))
    throw new ContentError('asset_in_use',409);
  if(asset.retention_until&&String(asset.retention_until)>now())
    throw new ContentError('retention_active',409);
  const at=now();
  await db.batch([{sql:`UPDATE content_assets SET status='quarantined' WHERE id=?
    AND status<>'deleted'`,args:[id]},
    audit(p,'content.asset.delete.started','content_asset',id,at)],'immediate');
  await storage.remove(String(asset.storage_key));
  const finished=now();
  await db.batch([{sql:`UPDATE content_assets SET status='deleted',deleted_at=? WHERE id=?`,
    args:[finished,id]},audit(p,'content.asset.delete','content_asset',id,finished)],'immediate');
}
