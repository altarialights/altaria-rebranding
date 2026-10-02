import { cardConfigurationSchema } from './card-configuration-schema';
import { canCheckoutConfiguration } from './card-configuration';
import { z, type ZodError } from 'astro/zod';
import { CANTIDAD_MAXIMA, PAIS_ENVIO } from './config';
import { findCardProduct, LEGACY_CARD_PRODUCT_ID } from '../../data/cards-catalog';

const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || undefined);
const optionalHttpUrl = z.preprocess((input) => {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}, z.string().max(700).url().optional());

export const normalizeContactPhone = (input: unknown): unknown => {
  if (typeof input !== 'string') return input;
  let phone = input.trim().replace(/[\s().\-/]/gu, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^\d{9}$/u.test(phone)) phone = `+34${phone}`;
  return phone;
};

const businessSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const business = input as Record<string, unknown>;
  return {
    ...business,
    googleMapsUrl: business.googleMapsUrl ?? business.googleMapsURI,
  };
}, z.object({
  googlePlaceId: z.string().trim().max(255).default(''),
  nombre: text(1, 180),
  direccion: z.string().trim().max(300).optional().default(''),
  googleMapsUrl: optionalHttpUrl,
}));

export const crearPedidoSchema = z.object({
  productoId: text(1, 80).optional(),
  personalizacion: z.object({
    configuracion: cardConfigurationSchema.optional(),
    destino: z.string().trim().max(700).optional(),
    notas: z.string().trim().max(600).optional(),
  }).optional(),
  claveIdempotencia: z.string().uuid(),
  aceptaCondicionesCompra: z.literal(true),
  negocio: businessSchema,
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA),
  cliente: z.object({
    nombre: text(2, 120),
    email: z.string().trim().toLowerCase().email().max(254),
    telefono: z.preprocess(
      normalizeContactPhone,
      z.string().regex(/^\+[1-9]\d{7,14}$/u, 'El teléfono no es válido.'),
    ),
  }),
  envio: z.object({
    direccion: text(3, 220),
    direccionExtra: optionalText(120),
    codigoPostal: z.string().trim().regex(/^\d{5}$/u, 'El código postal debe tener 5 cifras.'),
    ciudad: text(2, 120),
    provincia: text(2, 120),
    pais: z.literal(PAIS_ENVIO),
    referencia: optionalText(220),
  }),
}).superRefine((input, context) => {
  const product = findCardProduct(input.productoId ?? LEGACY_CARD_PRODUCT_ID);
  if (!product) {
    context.addIssue({ code: 'custom', path: ['productoId'], message: 'Selecciona una opción válida.' });
    return;
  }
  if (input.personalizacion?.configuracion && !canCheckoutConfiguration(product.id, input.personalizacion.configuracion, input.negocio.googlePlaceId)) {
    context.addIssue({ code: 'custom', path: ['personalizacion', 'configuracion'], message: 'Esta configuración requiere una propuesta antes del pago.' });
  }
  if (input.personalizacion?.configuracion) return; // El destino canónico se deriva de la configuración validada en servidor.
  if (product.destination.kind === 'google') {
    if (!input.personalizacion?.configuracion && input.negocio.googlePlaceId.length < 3) {
      context.addIssue({ code: 'custom', path: ['negocio', 'googlePlaceId'], message: 'Selecciona un negocio de la lista de Google.' });
    }
  } else {
    try {
      const url = new URL(input.personalizacion?.destino ?? '');
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      if (product.destination.kind === 'whatsapp'
        && (url.protocol !== 'https:' || url.hostname !== 'wa.me' || !/^\/[1-9]\d{7,14}$/u.test(url.pathname))) throw new Error();
    } catch {
      context.addIssue({ code: 'custom', path: ['personalizacion', 'destino'], message: 'Introduce un destino válido para esta tarjeta.' });
    }
  }
});

export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>;

const validationMessages: Record<string, string> = {
  productoId: 'Selecciona una opción válida.',
  'personalizacion.destino': 'Introduce un destino válido para esta tarjeta.',
  'personalizacion.notas': 'Las indicaciones no pueden superar los 600 caracteres.',
  aceptaCondicionesCompra: 'Debes aceptar las Condiciones de compra para continuar.',
  'negocio.googlePlaceId': 'Selecciona un negocio de la lista de Google.',
  'negocio.nombre': 'Selecciona un negocio válido.',
  cantidad: `Elige una cantidad entre 1 y ${CANTIDAD_MAXIMA}.`,
  'cliente.nombre': 'Introduce tu nombre completo.',
  'cliente.email': 'Introduce un email válido.',
  'cliente.telefono': 'Introduce un teléfono válido.',
  'envio.direccion': 'Introduce la dirección de envío.',
  'envio.direccionExtra': 'La información adicional es demasiado larga.',
  'envio.codigoPostal': 'Introduce un código postal de 5 cifras.',
  'envio.ciudad': 'Introduce la localidad.',
  'envio.provincia': 'Introduce la provincia.',
  'envio.pais': 'El país de envío no es válido.',
  'envio.referencia': 'La referencia de entrega es demasiado larga.',
};

export const formatOrderValidationErrors = (error: ZodError): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    const message = validationMessages[path];
    if (message && !fields[path]) fields[path] = message;
  }
  return fields;
};
