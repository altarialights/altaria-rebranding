import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { validateArtwork } from './artwork-validation';
import { ARTWORK_MAX_BYTES } from './artwork';
const mocks = vi.hoisted(() => ({ save: vi.fn(), find: vi.fn() }));
vi.mock('../db/card-artwork.repository', () => ({ saveCardArtwork: mocks.save, findCardArtwork: mocks.find }));
import { POST } from '../../pages/api/tarjetas/diseno/index';
import { GET } from '../../pages/api/tarjetas/diseno/[token]';
import { prepareCardOrderCheckout } from './checkout.service';
import type { CrearPedidoInput } from './validation';
const cookies = {get:()=>({value:'c'.repeat(64)}),set:vi.fn()};
const png = (width = 1016, height = 638) => sharp({ create: { width, height, channels: 3, background: '#016ffc' } }).png().toBuffer();
async function upload(bytes: Uint8Array, origin = 'https://altarialights.com') {
  const body = new FormData(); body.append('file', new File([new Uint8Array(bytes)], 'card.png', { type: 'image/png' }));
  const request = new Request('https://altarialights.com/api/tarjetas/diseno', { method: 'POST', headers: { origin }, body });
  return POST!({ request, cookies } as unknown as Parameters<NonNullable<typeof POST>>[0]);
}
describe('Print artwork validation and delivery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ token: 'a'.repeat(64), filename: 'card.png' }); });
  it.each(['png','jpeg','webp'] as const)('accepts real %s pixels at exactly 1016x638', async format => {
    const bytes = await sharp(await png()).toFormat(format).toBuffer();
    expect(await validateArtwork(bytes)).toMatchObject({mime:`image/${format}`,status:'ready'});
  });
  it.each([[1012,638],[1016,638],[2032,1276],[5060,3190]])('accepts %ix%i without changing pixels', async (w,h) => {
    expect(await validateArtwork(await png(w,h))).toMatchObject({width:w,height:h,status:'ready'});
  });
  it.each([[638,1016],[400,250],[1016,637],[1000,1000]])('flags %ix%i for review without rejecting the original', async(w,h)=>{
    expect(await validateArtwork(await png(w,h))).toMatchObject({width:w,height:h,status:'review'});
  });
  it('accepts an original above 2 MB and up to 3 MB', async () => {
    const image = await png();
    const original = Buffer.concat([image, Buffer.alloc(3 * 1024 * 1024 - image.length)]);
    expect((await upload(original)).status).toBe(201);
    expect(Buffer.from(mocks.save.mock.calls[0][0]).equals(original)).toBe(true);
    expect((await upload(Buffer.concat([original, Buffer.from([0])]))).status).not.toBe(201);
  });
  it('rejects false images, truncation, SVG and oversized files', async () => {
    for (const bytes of [Buffer.from('<svg width="1016" height="638"></svg>'), (await png()).subarray(0,40), Buffer.alloc(ARTWORK_MAX_BYTES+1)]) {
      await expect(validateArtwork(bytes)).rejects.toThrow();
    }
  });
  it('persists the original bytes only after server validation', async () => {
    const bytes = await png();
    expect((await upload(bytes)).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(new Uint8Array(bytes), expect.objectContaining({mime:'image/png',status:'ready'}), 'card.png',expect.stringMatching(/^[a-f0-9]{64}$/));
    expect((await upload(await png(100,100))).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect((await upload(bytes,'https://evil.example')).status).toBe(403);
  });
  it('reports storage failure instead of claiming upload succeeded', async () => {
    mocks.save.mockRejectedValue(new Error('database unavailable'));
    expect((await upload(await png())).status).toBe(503);
  });
  it('delivers the original as a noncached attachment', async () => {
    const bytes=await png();mocks.find.mockResolvedValue({filename:'card.png',mime:'image/png',bytes});
    const res=await GET!({params:{token:'a'.repeat(64)},cookies,url:new URL('https://altarialights.com/file')} as unknown as Parameters<NonNullable<typeof GET>>[0]);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('cache-control')).toContain('no-store');
    mocks.find.mockResolvedValue(null);
    expect((await GET!({params:{token:'b'.repeat(64)}} as unknown as Parameters<NonNullable<typeof GET>>[0])).status).toBe(404);
  });
  it('blocks a new own-design purchase without a persisted file', async () => {
    const create = vi.fn();
    const input = { productoId:'resenas',cantidad:1,claveIdempotencia:'qa',negocio:{googlePlaceId:''},personalizacion:{configuracion:{version:2,design:'own',destination:'link',details:{url:'https://example.com'},artwork:'uploaded',artworkFile:{token:'a'.repeat(64),filename:'forged.png'}}} } as CrearPedidoInput;
    await expect(prepareCardOrderCheckout(input,'https://example.com',{gateway:{mode:'test',create,retrieve:vi.fn()},findByIdempotencyKey:async()=>null,findArtwork:async()=>null})).rejects.toThrow('Adjunta');
    expect(create).not.toHaveBeenCalled();
  });
});

