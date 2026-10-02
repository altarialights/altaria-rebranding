import { findCardProduct, hasPurchasablePrice } from '../../data/cards-catalog';

export const designLabels = { own: 'Tengo mi diseño', custom: 'Diseño por Altaria', existing: 'Modelo Altaria existente' } as const;
export const destinationLabels = { link: 'Tengo el enlace', help: 'Necesito ayuda', create: 'Quiero que lo creéis' } as const;
export interface CardConfiguration {
  version: 2;
  design: keyof typeof designLabels;
  destination: keyof typeof destinationLabels;
  details: Partial<Record<'url' | 'business' | 'locality' | 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'linkedin' | 'other' | 'phone' | 'message' | 'name' | 'company' | 'email' | 'web' | 'project' | 'colors' | 'text' | 'style' | 'instructions', string>>;
  artwork: 'requested-later' | 'not-required' | 'uploaded';
  artworkFile?: import('./artwork').CardArtwork;
  contactPhone?: string;
}

export function validWebUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname.includes('.')) && !url.username && !url.password; }
  catch { return false; }
}

export function isGoogleReviewUrl(value: string): boolean {
  if (!validWebUrl(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && (
    (url.hostname === 'search.google.com' && url.pathname === '/local/writereview' && Boolean(url.searchParams.get('placeid')))
    || (url.hostname === 'g.page' && url.pathname.endsWith('/review') && url.pathname.length > 8)
  );
}

export function cardDestinationUrl(config: CardConfiguration, productId: string, placeId = ''): string {
  if (config.destination === 'create') return '';
  if (config.details.url && validWebUrl(config.details.url)) return config.details.url;
  if (productId === 'whatsapp' && config.details.phone) {
    let phone = config.details.phone.replace(/[\s().\-/+]/gu, '');
    if (phone.startsWith('00')) phone = phone.slice(2);
    if (/^\d{9}$/u.test(phone)) phone = `34${phone}`;
    if (/^[1-9]\d{7,14}$/u.test(phone)) return `https://wa.me/${phone}${config.details.message ? `?text=${encodeURIComponent(config.details.message)}` : ''}`;
  }
  if (config.destination === 'help' && productId === 'resenas' && placeId.length >= 3) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  return '';
}

// La compatibilidad histórica no autoriza pedidos nuevos sin configuración.
// Checkout comprueba además que los reintentos antiguos ya estén persistidos.
export function canCheckoutConfiguration(productId: string, config?: CardConfiguration, placeId = ''): boolean {
  const product = findCardProduct(productId);
  if (!product || !hasPurchasablePrice(product)) return false;
  if (!config) return productId === 'resenas' && placeId.length >= 3;
  if (config.destination === 'create') return false;
  if (config.design === 'existing') return productId === 'resenas'
    && !['colors', 'text', 'style', 'instructions', 'project'].some(key => config.details[key as keyof CardConfiguration['details']]?.trim())
    && (config.destination === 'help' ? placeId.length >= 3 : isGoogleReviewUrl(config.details.url ?? ''));
  if (!['own', 'custom'].includes(config.design)) return false;
  if (config.destination === 'help') return !['acceso', 'otra-idea'].includes(productId)
    && Boolean(config.details.business?.trim() && config.details.locality?.trim());
  return config.destination === 'link' && Boolean(cardDestinationUrl(config, productId));
}
