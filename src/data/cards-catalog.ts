// Tarifa provisional para pedidos nuevos. Los pedidos guardados nunca se recalculan.
export const CARD_PRICING_VERSION = 'altaria-cards-2026-10-v1';
export const cardsPricing = {
  currency: 'eur',
  tiers: [
    { minimum: 50, unitAmount: 1000 },
    { minimum: 20, unitAmount: 1500 },
    { minimum: 10, unitAmount: 1500 },
    { minimum: 5, unitAmount: 1800 },
    { minimum: 1, unitAmount: 2000 },
  ],
  design: { own: 0, custom: 1000 },
  // Se mantiene la política de envío vigente.
  shippingAmount: 490,
  freeShippingFrom: 2,
  destination: { link: 0, help: 0, create: null },
} as const;

export interface CardPrice {
  currency: 'eur';
  tiers: readonly { minimum: number; unitAmount: number }[];
  shippingAmount: number;
  freeShippingFrom: number;
}

export interface CardProduct {
  id: string;
  name: string;
  orderName: string;
  description: string;
  image: string;
  example: string;
  scope: string;
  destination: { kind: 'google' | 'url' | 'whatsapp'; label: string; placeholder: string };
  personalization: string;
  saleMode: 'direct' | 'quote';
  price: CardPrice | null;
}

export const LEGACY_CARD_PRODUCT_ID = 'resenas';

// Única configuración de catálogo y venta. Un producto sin precio válido nunca
// puede abrir Checkout. Todos los tipos comparten la tarifa provisional de Altaria Cards.
const featuredCards: readonly CardProduct[] = [
  {
    id: 'resenas', name: 'Reseñas', orderName: 'Tarjeta NFC + QR para reseñas',
    description: 'Consigue más reseñas en Google y otras plataformas.',
    image: '/media/contacto/optimized/chat-180.webp',
    example: 'Un toque o un escaneo abre el enlace para dejar una reseña. Usa tu destino existente o solicita ayuda para localizarlo.',
    scope: 'Tarjeta programada para tu destino de reseñas existente. No incluye gestión de reseñas.',
    destination: { kind: 'google', label: 'Busca tu negocio en Google', placeholder: 'Nombre del negocio y localidad' },
    personalization: 'Diseño propio o diseño por Altaria',
    saleMode: 'direct',
    price: cardsPricing,
  },
  {
    id: 'redes-sociales', name: 'Redes sociales', orderName: 'Tarjeta NFC + QR para redes sociales',
    description: 'Reúne todos tus perfiles en un solo toque.',
    image: '/media/branding/optimized/solution-2-180.webp',
    example: 'Tu tarjeta abre tu perfil o una página que ya reúne tus redes. Si necesitas crear esa página, cuéntanoslo para incluirlo en la propuesta.',
    scope: 'Enlaza a un perfil o página existente. Crear una página con varios perfiles se presupuesta por separado.',
    destination: { kind: 'url', label: 'Enlace al perfil o página de redes', placeholder: 'https://…' },
    personalization: 'Diseño y alcance a definir en la propuesta', saleMode: 'direct', price: cardsPricing,
  },
  {
    id: 'whatsapp', name: 'WhatsApp', orderName: 'Tarjeta NFC + QR para WhatsApp',
    description: 'Que te contacten al instante.',
    image: '/media/contacto/optimized/whatsapp-grande-180.webp',
    example: 'Al acercar el móvil o escanear el QR, se abre una conversación con el WhatsApp de tu negocio.',
    scope: 'Acceso a tu número de WhatsApp. No incluye bots, automatizaciones ni gestión de conversaciones.',
    destination: { kind: 'whatsapp', label: 'WhatsApp con prefijo internacional', placeholder: '+34 600 000 000' },
    personalization: 'Diseño y alcance a definir en la propuesta', saleMode: 'direct', price: cardsPricing,
  },
  {
    id: 'reservas', name: 'Reservas', orderName: 'Tarjeta NFC + QR para reservas',
    description: 'Lleva a tu sistema de reservas o agenda online.',
    image: '/media/de-zamorano/optimized/calendario-480.webp',
    example: 'En recepción, la tarjeta lleva a la agenda online que ya utilizas para que tus clientes elijan una cita.',
    scope: 'Abre tu enlace de reservas existente. No incluye construir ni contratar un sistema de reservas.',
    destination: { kind: 'url', label: 'Enlace a tu sistema de reservas', placeholder: 'https://…' },
    personalization: 'Diseño y alcance a definir en la propuesta', saleMode: 'direct', price: cardsPricing,
  },
  {
    id: 'cartas-digitales', name: 'Cartas digitales', orderName: 'Tarjeta NFC + QR para cartas digitales',
    description: 'Ideal para restaurantes, hoteles y negocios turísticos.',
    image: '/media/de-zamorano/optimized/carta-480.webp',
    example: 'En la mesa o en recepción, un toque abre la carta digital de tu establecimiento.',
    scope: 'Acceso a una carta ya publicada. La creación de una carta digital o web requiere una propuesta aparte.',
    destination: { kind: 'url', label: 'Enlace a tu carta digital', placeholder: 'https://…' },
    personalization: 'Diseño y alcance a definir en la propuesta', saleMode: 'direct', price: cardsPricing,
  },
];

// Los nuevos usos aparecen en el configurador, sin ampliar la landing comercial.
export const cardsCatalog: readonly CardProduct[] = [...featuredCards,
  ...[
    ['mi-web', 'Mi web', 'Dirige a tu web o landing.'],
    ['contacto', 'Contacto / vCard', 'Comparte tus datos de contacto.'],
    ['acceso', 'Acceso o fichaje', 'Conecta con tu sistema de acceso.'],
    ['otra-idea', 'Otra idea', 'Cuéntanos qué tienes en mente.'],
  ].map(([id, name, description]): CardProduct => ({
    id, name, description, orderName: `Tarjeta NFC + QR · ${name}`,
    image: '/media/contacto/optimized/chat-180.webp', example: description,
    scope: 'Enlace a un destino existente. Crear un destino o integrar sistemas requiere una propuesta.',
    destination: { kind: 'url', label: 'Enlace de destino', placeholder: 'https://…' },
    personalization: 'Dise?o propio o dise?o por Altaria', saleMode: 'direct', price: cardsPricing,
  })),
];
export const featuredCardsCatalog = featuredCards;

export const customCardRequest = { id: 'a-medida', name: 'Una idea a medida', saleMode: 'quote', price: null } as const;
export const findCardProduct = (id: string): CardProduct | undefined => cardsCatalog.find((product) => product.id === id);

export const hasPurchasablePrice = (product: CardProduct): boolean => {
  const price = product.price;
  return product.saleMode === 'direct' && Boolean(price && price.currency === 'eur'
    && price.tiers.length && price.tiers.some((tier) => tier.minimum === 1)
    && price.tiers.every((tier) => Number.isSafeInteger(tier.minimum) && tier.minimum >= 1
      && Number.isSafeInteger(tier.unitAmount) && tier.unitAmount > 0)
    && Number.isSafeInteger(price.shippingAmount) && price.shippingAmount >= 0
    && Number.isSafeInteger(price.freeShippingFrom) && price.freeShippingFrom >= 1);
};
