import { z, type ZodError } from 'astro/zod';
import { CANTIDAD_MAXIMA, PAIS_ENVIO } from './config';

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
  googlePlaceId: text(3, 255),
  nombre: text(1, 180),
  direccion: z.string().trim().max(300).optional().default(''),
  googleMapsUrl: optionalHttpUrl,
}));

export const crearPedidoSchema = z.object({
  claveIdempotencia: z.string().uuid(),
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
});

export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>;

const validationMessages: Record<string, string> = {
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
