import { z } from 'astro/zod';
import { validWebUrl } from './card-configuration';

const optional = (max = 700) => z.string().trim().max(max).optional();
export const cardConfigurationSchema = z.object({
  version: z.literal(2), design: z.enum(['own', 'custom', 'existing']),
  destination: z.enum(['link', 'help', 'create']),
  details: z.object({
    url: optional(), business: optional(180), locality: optional(180), instagram: optional(), tiktok: optional(),
    facebook: optional(), youtube: optional(), linkedin: optional(), other: optional(),
    phone: optional(32), message: optional(600), name: optional(120), company: optional(180),
    email: optional(254), web: optional(), project: optional(1500), colors: optional(180),
    text: optional(600), style: optional(600), instructions: optional(600),
  }),
  artwork: z.enum(['requested-later', 'not-required', 'uploaded']), contactPhone: optional(32),
  artworkFile: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), filename: z.string().min(1).max(255) }).optional(),
}).superRefine((config, context) => {
  for (const key of ['url', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'other', 'web'] as const) {
    if (config.details[key] && !validWebUrl(config.details[key]!)) context.addIssue({ code: 'custom', path: ['details', key], message: 'Introduce una URL http o https válida.' });
  }
  if (config.details.email && !z.string().email().safeParse(config.details.email).success) context.addIssue({ code: 'custom', path: ['details', 'email'], message: 'Introduce un email válido.' });
  if (config.destination === 'create' && (config.details.project?.length ?? 0) < 10) context.addIssue({ code: 'custom', path: ['details', 'project'], message: 'Cuéntanos qué necesitas crear.' });
});
