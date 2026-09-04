import { z } from 'astro/zod';
import { CANTIDAD_MAXIMA, PAIS_ENVIO } from './config';

const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || undefined);
const httpUrl = z.string().trim().max(700).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}, 'La URL debe utilizar HTTP o HTTPS.');

export const crearPedidoSchema = z.object({
  claveIdempotencia: z.string().uuid(),
  negocio: z.object({
    googlePlaceId: text(3, 255),
    nombre: text(2, 180),
    direccion: text(3, 300),
    googleMapsUrl: httpUrl.optional().or(z.literal('')).transform((value) => value || undefined),
  }),
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA),
  cliente: z.object({
    nombre: text(2, 120),
    email: z.string().trim().toLowerCase().email().max(254),
    telefono: z.string().trim().min(7).max(32).regex(/^[+\d][\d\s().-]+$/u, 'El teléfono no es válido.'),
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
