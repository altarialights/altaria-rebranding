import { describe,it,expect,vi,beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
const state=vi.hoisted(()=>({get:vi.fn(),run:vi.fn()}));
vi.mock('../db/client',()=>({getDatabase:()=>({get:state.get,run:state.run,transactionAsync:(fn:(tx:unknown)=>Promise<unknown>)=>({immediate:()=>fn(state)})})}));
import { findCardArtwork,removeCardArtwork,assertUnboundArtwork } from '../db/card-artwork.repository';
import { artworkOwner } from './artwork-session';
import { GET } from '../../pages/api/tarjetas/diseno/[token]';
const token='a'.repeat(64), cookieA='b'.repeat(64),cookieB='c'.repeat(64);
const ownerA=createHash('sha256').update(cookieA).digest('hex');
const row={token,filename:'private.png',mime_type:'image/png',content_base64:Buffer.from('private bytes').toString('base64'),width:1012,height:638,validation_status:'review',warnings_json:'[]',layout_json:'{}',order_id:null,inquiry_id:null};
describe('Artwork session ownership and binding',()=>{
 beforeEach(()=>{vi.clearAllMocks();state.get.mockImplementation(async(sql:string,...args:string[])=>{expect(sql).toContain('owner_hash = ?');return args[0]===token&&args[1]===ownerA?row:undefined;});});
 it('does not treat an ID or URL as authorization',async()=>{
  expect(await findCardArtwork(token)).toBeNull();expect(state.get).not.toHaveBeenCalled();
  expect(await findCardArtwork(token,'other-owner')).toBeNull();expect(await findCardArtwork('d'.repeat(64),ownerA)).toBeNull();
  expect((await findCardArtwork(token,ownerA))?.filename).toBe('private.png');
 });
 it('rejects download from another session even with the correct file ID',async()=>{
  for(const secret of ['',cookieB]){
   const response=await GET!({params:{token},cookies:{get:()=>({value:secret})},url:new URL('https://example.com/file')} as unknown as Parameters<NonNullable<typeof GET>>[0]);
   expect(response.status).toBe(404);
  }
 });
 it('deletes only unbound artwork owned by the session',async()=>{
  expect(await removeCardArtwork(token,'other-owner')).toBe(false);expect(state.run).not.toHaveBeenCalled();
  expect(await removeCardArtwork(token,ownerA)).toBe(true);expect(state.get.mock.calls.at(-1)?.[0]).toContain('order_id IS NULL AND inquiry_id IS NULL');
 });
 it('requires an unbound owned file inside the order transaction',async()=>{
  await expect(assertUnboundArtwork(state as never,token,'other-owner')).rejects.toThrow();
  await assertUnboundArtwork(state as never,token,ownerA);
  expect(state.get.mock.calls.at(-1)?.[0]).toContain('order_id IS NULL AND inquiry_id IS NULL');
 });
 it('sets a random HTTP-only strict cookie and stores only its hash',()=>{
  const set=vi.fn();const owner=artworkOwner({get:()=>undefined,set} as never,true,true);
  expect(set).toHaveBeenCalledWith('altaria_artwork_session',expect.stringMatching(/^[a-f0-9]{64}$/),expect.objectContaining({httpOnly:true,secure:true,sameSite:'strict'}));
  expect(owner).not.toBe(set.mock.calls[0][1]);
 });
});
