import { cardConfigurationSchema } from '../orders/card-configuration-schema';
import { z } from 'astro/zod';
import { customCardRequest, findCardProduct } from '../../data/cards-catalog';
import { normalizeContactPhone } from '../orders/validation';

export const cardInquirySchema = z.object({
  claveIdempotencia: z.string().uuid(),
  productoId: z.string().refine((id) => id === customCardRequest.id || Boolean(findCardProduct(id))),
  nombre: z.string().trim().min(2).max(120),
  contacto: z.string().trim().max(254).refine((value) =>
    z.string().email().safeParse(value).success || /^\+[1-9]\d{7,14}$/u.test(String(normalizeContactPhone(value)))),
  negocio: z.string().trim().max(180).optional(),
  cantidad: z.number().int().min(1).max(500).optional(),
  idea: z.string().trim().min(10).max(3000),
  configuracion: z.object({
    tarjeta: cardConfigurationSchema.optional(),
    destino: z.string().trim().max(700).optional(),
    notas: z.string().trim().max(600).optional(),
  }).optional(),
  privacidad: z.literal(true),
  website: z.string().max(0),
  startedAt: z.number().int(),
}).superRefine((input, context) => {
  const config = input.configuracion?.tarjeta;
  if (!config) return; // Contrato del formulario general de consultas.
  const add = (message: string) => context.addIssue({ code: 'custom', path: ['configuracion', 'tarjeta'], message });
  const validPhone = (value: string | undefined) => /^\+[1-9]\d{7,14}$/u.test(String(normalizeContactPhone(value)));
  if (!input.negocio || !input.cantidad || !validPhone(config.contactPhone) || !z.string().email().safeParse(input.contacto).success) add('Completa los datos de contacto, negocio y cantidad.');
  if (config.details.phone && !validPhone(config.details.phone)) add('Introduce un teléfono de destino válido.');
  if (config.destination === 'help' && (!config.details.business || !config.details.locality)) add('Indica el negocio y la localidad para localizar el destino.');
  if (config.destination === 'link') {
    if (['resenas', 'reservas', 'cartas-digitales', 'mi-web'].includes(input.productoId) && !config.details.url) add('Indica el enlace de destino.');
    if (input.productoId === 'whatsapp' && !validPhone(config.details.phone)) add('Indica el teléfono de WhatsApp.');
    if (input.productoId === 'contacto' && !config.details.name) add('Indica el nombre para la tarjeta de contacto.');
    if (input.productoId === 'redes-sociales' && !['url', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'other'].some(key => config.details[key as keyof typeof config.details])) add('Indica al menos un enlace.');
  }
  if (['acceso', 'otra-idea'].includes(input.productoId) && (config.details.project?.length ?? 0) < 10) add('Cuéntanos qué necesitas.');
});

export type CardInquiry = z.infer<typeof cardInquirySchema>;
