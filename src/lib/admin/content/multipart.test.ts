import {createHash,randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {InMemoryMultipartAdapter} from './multipart';

const bytes=new Uint8Array([1,2,3,4,5]);
const input=()=>({brandId:'altaria-cards',environment:'test' as const,
  name:'synthetic.bin',mime:'application/octet-stream',size:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex'),requestKey:randomUUID()});

describe('contrato multipart simulado, sin Cloudflare',()=>{
  it('inicia, autoriza, finaliza, verifica y permite borrar sin duplicar reintentos',async()=>{
    const adapter=new InMemoryMultipartAdapter(),data=input();
    const session=await adapter.begin(data);
    expect(await adapter.begin(data)).toEqual(session);
    await expect(adapter.begin({...data,size:6})).rejects.toThrow('upload_conflict');
    const temporary=await adapter.authorizePart(session.uploadId,1);
    expect(temporary.url).toMatch(/^mock:\/\//);
    const part=adapter.acceptPart(session.uploadId,1,bytes);
    const stored=await adapter.complete(session.uploadId,[part]);
    expect(await adapter.complete(session.uploadId,[part])).toEqual(stored);
    expect(await adapter.head(session.objectKey)).toEqual(stored);
    expect((await adapter.authorizeRead(session.objectKey,60)).url).toMatch(/^mock:\/\//);
    await adapter.deleteAuthorized(session.objectKey);
    expect(await adapter.head(session.objectKey)).toBeNull();
  });
  it('rechaza manifiesto corrupto y permite cancelar una sesión incompleta',async()=>{
    const adapter=new InMemoryMultipartAdapter(),data=input(),session=await adapter.begin(data);
    const part=adapter.acceptPart(session.uploadId,1,bytes);
    await expect(adapter.complete(session.uploadId,[{...part,etag:'wrong'}]))
      .rejects.toThrow('parts_mismatch');
    await adapter.abort(session.uploadId);
    await expect(adapter.authorizePart(session.uploadId,1)).rejects.toThrow('upload_unavailable');
    expect(await adapter.head(session.objectKey)).toBeNull();
  });
});
