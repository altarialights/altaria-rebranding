import { z } from 'astro/zod';
import type { AdminPrincipal } from '../access';

export const crmStages = ['new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type CrmStage = typeof crmStages[number];
export const stageLabels: Record<CrmStage, string> = {
  new: 'Nuevo', contacted: 'Contactado', interested: 'Interesado',
  proposal: 'Propuesta', negotiation: 'Negociación', won: 'Ganado', lost: 'Perdido',
};
export const stageSchema = z.enum(crmStages);
export const sourceKinds = ['digital_lead', 'cards_inquiry', 'cards_order'] as const;
export type SourceKind = typeof sourceKinds[number];

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const optionalId = z.union([z.literal(''), z.string().uuid()]).transform((value) => value || null);
const optionalDate = z.union([z.literal(''), z.string().datetime({ offset: true })]).transform((value) => value || null);
export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(180),
  sector: optionalText(100), city: optionalText(100), region: optionalText(100),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  websiteUrl: z.union([z.literal(''), z.string().url().max(500).refine((value) => /^https?:\/\//i.test(value))]).transform((value) => value || null),
  leadOrigin: z.enum(['manual', 'digital_lead', 'cards_inquiry', 'cards_order', 'other']),
  responsibleUserId: optionalId,
  identifierKind: z.union([z.literal(''), z.enum(['tax_id', 'domain', 'google_place_id', 'external_id'])]),
  identifierValue: z.string().trim().max(255),
  confirmPossibleDuplicate: z.boolean(),
}).superRefine((value, ctx) => {
  if (Boolean(value.identifierKind) !== Boolean(value.identifierValue)) {
    ctx.addIssue({ code: 'custom', path: ['identifierValue'], message: 'Completa tipo y valor del identificador.' });
  }
});
export const contactSchema = z.object({
  organizationId: z.string().uuid(), fullName: z.string().trim().min(2).max(160),
  email: z.union([z.literal(''), z.string().email().max(254)]).transform((value) => value ? value.toLowerCase() : null),
  phone: optionalText(30), jobTitle: optionalText(120), isPrimary: z.boolean(),
});
export const opportunitySchema = z.object({
  organizationId: z.string().uuid(), title: z.string().trim().min(2).max(180),
  amountEuros: z.union([z.literal(''), z.coerce.number().finite().min(0).max(99999999.99)]).transform((value) =>
    value === '' ? null : Math.round(value * 100)),
  responsibleUserId: optionalId,
});
export const stageChangeSchema = z.object({
  opportunityId: z.string().uuid(), toStage: stageSchema,
  lostReason: optionalText(500),
});
export const activitySchema = z.object({
  organizationId: z.string().uuid(), opportunityId: optionalId, contactId: optionalId,
  kind: z.enum(['call', 'visit', 'meeting', 'note']),
  summary: z.string().trim().min(2).max(240), detail: optionalText(4000),
  happenedAt: z.string().datetime({ offset: true }),
  followupTitle: optionalText(240), followupDueAt: optionalDate,
}).superRefine((value, ctx) => {
  if (value.followupDueAt && !value.followupTitle) {
    ctx.addIssue({ code: 'custom', path: ['followupTitle'], message: 'Indica el título del seguimiento.' });
  }
});
export const taskSchema = z.object({
  organizationId: z.string().uuid(), opportunityId: optionalId, contactId: optionalId,
  title: z.string().trim().min(2).max(240), dueAt: optionalDate, responsibleUserId: optionalId,
});
export const taskActionSchema = z.object({ taskId: z.string().uuid(), responsibleUserId: optionalId });
export const sourceLinkSchema = z.object({
  organizationId: z.string().uuid(), sourceKind: z.enum(sourceKinds), sourceId: z.string().uuid(),
});

export const normalizeCompanyName = (value: string): string => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
export const normalizeIdentifier = (kind: string, value: string): string => {
  if (kind === 'domain') {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  }
  if (kind === 'tax_id') return value.toLowerCase().replace(/[\s-]+/g, '').trim();
  return value.toLowerCase().trim();
};
export function canAdvanceStage(from: CrmStage, to: CrmStage): boolean {
  if (from === 'won' || from === 'lost' || from === to) return false;
  if (to === 'lost') return true;
  const open: CrmStage[] = ['new', 'contacted', 'interested', 'proposal', 'negotiation', 'won'];
  return open.indexOf(to) === open.indexOf(from) + 1;
}
export function canReadOrganization(principal: AdminPrincipal, responsibleUserId: string): boolean {
  return principal.roles.includes('owner') || principal.roles.includes('viewer')
    || (principal.roles.includes('sales') && principal.id === responsibleUserId);
}
export function canWriteOrganization(principal: AdminPrincipal, responsibleUserId: string): boolean {
  return principal.roles.includes('owner') || (principal.roles.includes('sales') && principal.id === responsibleUserId);
}
