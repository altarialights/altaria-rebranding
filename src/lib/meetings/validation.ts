import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
const clean = (max: number) => z.string().trim().min(2).max(max).refine(v => !/[\u0000-\u001f\u007f]/u.test(v));
export function normalizePhone(value: string): string | null {
  const raw = value.trim().replace(/^00/, '+');
  if (!raw.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(raw);
  return parsed?.isValid() && !parsed.ext ? parsed.number : null;
}
export const accessSchema = z.object({
  key: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const bookingSchema = accessSchema.extend({
  start: z.iso.datetime(), name: clean(100), business: clean(120),
  email: z.email().max(254).transform(v => v.toLowerCase()),
  phone: z.string().max(40).transform(normalizePhone).refine((v): v is string => v !== null, 'Incluye un teléfono válido con prefijo internacional.'),
  comment: z.string().trim().max(600).default(''), privacy: z.literal(true),
  website: z.literal(''), startedAt: z.number().int().positive(),
});
export type BookingInput = z.infer<typeof bookingSchema>;
