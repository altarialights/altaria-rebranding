import { WHATSAPP_BASE_URL } from './service-interests';
import { designLabels, destinationLabels, type CardConfiguration } from '../orders/card-configuration';

export const CARDS_WHATSAPP_URL = `${WHATSAPP_BASE_URL}?text=${encodeURIComponent('Hola, quiero contaros una idea para una tarjeta NFC de Altaria Cards.')}`;
export function cardWhatsAppMessage(input: { product: string; quantity: number; configuration: CardConfiguration; business?: string; name?: string; email?: string; destinationUrl?: string }): string {
  const labels: Record<string, string> = { url: 'Enlace', business: 'Negocio a localizar', locality: 'Localidad', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', other: 'Otro perfil', phone: 'Teléfono de destino', message: 'Mensaje inicial', name: 'Nombre de la tarjeta', company: 'Empresa', email: 'Email de destino', web: 'Web', project: 'Mi idea', colors: 'Colores', text: 'Texto de la tarjeta', style: 'Estilo / ejemplo', instructions: 'Instrucciones' };
  const config = input.configuration;
  const message = [
    'Hola, quiero una tarjeta de Altaria Cards.',
    `Tipo: ${input.product}`, `Cantidad: ${input.quantity}`, `Diseño: ${designLabels[config.design]}`,
    `Destino: ${destinationLabels[config.destination]}`,
    input.business && `Negocio: ${input.business}`, input.name && `Contacto: ${input.name}`,
    input.email && `Email: ${input.email}`, config.contactPhone && `Teléfono: ${config.contactPhone}`,
    ...Object.entries(config.details).filter(([, value]) => value).map(([key, value]) => `${labels[key] ?? key}: ${value}`),
    input.destinationUrl && !config.details.url && `Enlace preparado: ${input.destinationUrl}`,
    config.artwork === 'requested-later' && 'Tengo diseño o materiales y los compartiré por aquí.',
    config.artwork === 'uploaded' && config.artworkFile && `Diseño adjunto: ${config.artworkFile.filename}${config.artworkFile.status === 'review' ? ' · requiere revisión' : ''}.`,
    '¿Podemos concretar el diseño y el presupuesto?',
  ].filter(Boolean).join('\n');
  return message.length > 6000 ? `${message.slice(0, 5800)}\n[El resumen continúa: os compartiré los detalles restantes por aquí.]` : message;
}
export const cardsWhatsAppUrl = (message: string) => `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`;
