export const ARTWORK_WIDTH = 1012;
export const ARTWORK_HEIGHT = 638;
export const ARTWORK_MAX_BYTES = 3 * 1024 * 1024;
export const ARTWORK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const CR80_RATIO = 85.60 / 53.98;
export const ARTWORK_RATIO_TOLERANCE = .02;
export const ARTWORK_MAX_PIXELS = 40_000_000;
export type ArtworkLayout = { fit: 'contain' | 'cover'; x: number; y: number };
export interface CardArtwork { token: string; filename: string; width?: number; height?: number; status?: 'ready' | 'review'; warnings?: string[]; layout?: ArtworkLayout }
export function assessArtwork(width: number, height: number, layout?: ArtworkLayout) {
  const warnings: string[] = [];
  if (Math.abs(width / height / CR80_RATIO - 1) > ARTWORK_RATIO_TOLERANCE) warnings.push('El diseño no tiene la proporción de una tarjeta CR80 (85,60 × 53,98 mm). Puedes subir otro archivo o enviarlo igualmente para que lo revisemos.');
  if (width < ARTWORK_WIDTH || height < ARTWORK_HEIGHT) warnings.push('La resolución es baja para impresión (recomendado al menos 1012 × 638 px, aproximadamente 300 ppp). Puede perder calidad. No aumentaremos artificialmente el original.');
  if (layout?.fit === 'cover') warnings.push('Has elegido una vista recortada. Revisaremos el encuadre antes de producir; el original permanece intacto.');
  return { status: warnings.length ? 'review' as const : 'ready' as const, warnings };
}
export const artworkPath = (token: string) => `/api/tarjetas/diseno/${token}`;
