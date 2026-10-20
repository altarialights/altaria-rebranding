import {createHash,randomUUID} from 'node:crypto';

// Provider contract only. The browser never receives provider credentials.
export interface MultipartStart {brandId:string;environment:'test';name:string;
  mime:string;size:number;sha256:string;requestKey:string;}
export interface MultipartPart {number:number;etag:string;}
export interface MultipartSession {uploadId:string;objectKey:string;partSize:number;}
export interface TemporaryAuthorization {url:string;headers:Record<string,string>;expiresAt:string;}
export interface StoredObject {objectKey:string;size:number;sha256:string;mime:string;}
export interface ContentMultipartAdapter {
  begin(input:MultipartStart):Promise<MultipartSession>;
  authorizePart(uploadId:string,number:number):Promise<TemporaryAuthorization>;
  complete(uploadId:string,parts:MultipartPart[]):Promise<StoredObject>;
  abort(uploadId:string):Promise<void>;
  head(objectKey:string):Promise<StoredObject|null>;
  authorizeRead(objectKey:string,ttlSeconds:number):Promise<TemporaryAuthorization>;
  deleteAuthorized(objectKey:string):Promise<void>;
}

type Pending={input:MultipartStart;session:MultipartSession;parts:Map<number,Uint8Array>;
  complete?:StoredObject;aborted:boolean;};
export class InMemoryMultipartAdapter implements ContentMultipartAdapter {
  private uploads=new Map<string,Pending>();
  private byRequest=new Map<string,string>();
  private objects=new Map<string,StoredObject>();
  async begin(input:MultipartStart):Promise<MultipartSession>{
    if(input.environment!=='test'||!input.brandId||!input.requestKey||input.size<1
      ||!/^[a-f0-9]{64}$/.test(input.sha256))throw new Error('invalid_upload');
    const request=`${input.brandId}:${input.requestKey}`;
    const existing=this.byRequest.get(request);
    if(existing){const pending=this.uploads.get(existing)!;
      if(JSON.stringify(pending.input)!==JSON.stringify(input))throw new Error('upload_conflict');
      if(pending.aborted)throw new Error('upload_aborted');
      return pending.session;
    }
    const session={uploadId:randomUUID(),objectKey:`test/${input.brandId}/${randomUUID()}`,
      partSize:5*1024*1024};
    this.uploads.set(session.uploadId,{input,session,parts:new Map(),aborted:false});
    this.byRequest.set(request,session.uploadId);
    return session;
  }
  async authorizePart(uploadId:string,number:number):Promise<TemporaryAuthorization>{
    const pending=this.requirePending(uploadId);
    if(!Number.isInteger(number)||number<1||number>10000||pending.complete)
      throw new Error('invalid_part');
    return {url:`mock://upload/${pending.session.uploadId}/${number}`,headers:{},
      expiresAt:new Date(Date.now()+5*60_000).toISOString()};
  }
  // Test-only stand-in for a browser PUT to an authorized part URL.
  acceptPart(uploadId:string,number:number,bytes:Uint8Array):MultipartPart{
    const pending=this.requirePending(uploadId);
    if(!Number.isInteger(number)||number<1||number>10000||pending.complete||bytes.length<1
      ||bytes.length>5*1024*1024)throw new Error('invalid_part');
    pending.parts.set(number,bytes);
    return {number,etag:createHash('md5').update(bytes).digest('hex')};
  }
  async complete(uploadId:string,parts:MultipartPart[]):Promise<StoredObject>{
    const pending=this.requirePending(uploadId);
    if(pending.complete)return pending.complete;
    if(!parts.length||parts.length!==pending.parts.size
      ||parts.some((part,index)=>part.number!==index+1
        ||part.etag!==createHash('md5').update(pending.parts.get(part.number)??new Uint8Array()).digest('hex')))
      throw new Error('parts_mismatch');
    const bytes=Buffer.concat(parts.map(part=>pending.parts.get(part.number)!));
    const sha256=createHash('sha256').update(bytes).digest('hex');
    if(bytes.length!==pending.input.size||sha256!==pending.input.sha256)
      throw new Error('integrity_mismatch');
    const stored={objectKey:pending.session.objectKey,size:bytes.length,sha256,mime:pending.input.mime};
    pending.complete=stored;this.objects.set(stored.objectKey,stored);return stored;
  }
  async abort(uploadId:string):Promise<void>{
    const pending=this.uploads.get(uploadId);if(!pending||pending.complete)return;
    pending.aborted=true;pending.parts.clear();
  }
  async head(objectKey:string):Promise<StoredObject|null>{return this.objects.get(objectKey)??null;}
  async authorizeRead(objectKey:string,ttlSeconds:number):Promise<TemporaryAuthorization>{
    if(!this.objects.has(objectKey)||!Number.isInteger(ttlSeconds)||ttlSeconds<1
      ||ttlSeconds>300)throw new Error('read_denied');
    return {url:`mock://read/${objectKey}`,headers:{'cache-control':'private, no-store'},
      expiresAt:new Date(Date.now()+ttlSeconds*1000).toISOString()};
  }
  async deleteAuthorized(objectKey:string):Promise<void>{this.objects.delete(objectKey);}
  private requirePending(uploadId:string):Pending{
    const pending=this.uploads.get(uploadId);
    if(!pending||pending.aborted)throw new Error('upload_unavailable');
    return pending;
  }
}
