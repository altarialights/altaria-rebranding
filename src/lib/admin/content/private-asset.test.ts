import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {APIContext} from 'astro';

const {readPrivateAsset}=vi.hoisted(()=>({readPrivateAsset:vi.fn()}));
vi.mock('./storage',()=>({readPrivateAsset}));

const {GET}=await import('../../../pages/api/admin/content/assets/[id]');
const principal={id:'synthetic-owner'};
function context(range?:string,authenticated=true){
  const headers=new Headers();
  if(range)headers.set('Range',range);
  return {
    locals:authenticated?{admin:principal}:{},
    params:{id:'synthetic-asset'},
    request:new Request('http://127.0.0.1:4321/api/admin/content/assets/synthetic-asset?preview=1',{headers}),
  } as unknown as APIContext;
}

describe('private content previews',()=>{
  beforeEach(()=>{
    readPrivateAsset.mockReset();
    readPrivateAsset.mockResolvedValue({bytes:new Uint8Array([1,2,3,4,5]),mime:'application/pdf'});
  });
  it('denies unauthenticated access before reading the asset',async()=>{
    const response=await GET(context(undefined,false));
    expect(response.status).toBe(403);
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });
  it('serves a private PDF preview through authorization',async()=>{
    const response=await GET(context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('inline');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(readPrivateAsset).toHaveBeenCalledWith(principal,'synthetic-asset');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3,4,5]);
  });
  it('serves bounded video ranges and rejects invalid ranges',async()=>{
    readPrivateAsset.mockResolvedValue({bytes:new Uint8Array([1,2,3,4,5]),mime:'video/mp4'});
    const partial=await GET(context('bytes=1-3'));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Range')).toBe('bytes 1-3/5');
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2,3,4]);
    const invalid=await GET(context('bytes=5-9'));
    expect(invalid.status).toBe(416);
  });
});
