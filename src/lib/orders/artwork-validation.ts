import sharp from 'sharp';
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_PIXELS, assessArtwork, type ArtworkLayout } from './artwork';
export async function validateArtwork(bytes: Uint8Array, layout: ArtworkLayout = {fit:'contain',x:50,y:50}) {
  if (!bytes.length || bytes.length > ARTWORK_MAX_BYTES) throw new Error('El archivo debe pesar como máximo 3 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: ARTWORK_MAX_PIXELS, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new Error();
    await image.stats();
    const rotate = [5,6,7,8].includes(meta.orientation ?? 1);
    const width = rotate ? meta.height : meta.width, height = rotate ? meta.width : meta.height;
    return { mime: `image/${meta.format}`, width, height, ...assessArtwork(width,height,layout), layout };
  } catch { throw new Error('Sube un PNG, JPG/JPEG o WebP estático válido (máximo 40 megapíxeles).'); }
}
