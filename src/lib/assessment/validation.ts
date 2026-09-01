import { z } from 'astro/zod';
import { QUESTION_KEYS } from './questionnaires/v1';

const answerValueSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null(),
]);

const trimOptional = (max: number) => z.string().trim().max(max).optional();

export const assessmentSubmissionSchema = z.object({
  questionnaireVersion: z.literal('v1'),
  answers: z.record(answerValueSchema).superRefine((answers, context) => {
    const receivedKeys = Object.keys(answers);
    const unknownKeys = receivedKeys.filter((key) => !QUESTION_KEYS.includes(key as (typeof QUESTION_KEYS)[number]));
    const missingKeys = QUESTION_KEYS.filter((key) => !(key in answers));
    if (unknownKeys.length > 0 || missingKeys.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'El cuestionario está incompleto o no coincide con su versión.' });
    }
  }),
  lead: z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    jobTitle: z.string().trim().min(2).max(120),
    companyName: z.string().trim().min(2).max(140),
    companyUrl: z.string().trim().url().max(500)
      .refine((url) => ['http:', 'https:'].includes(new URL(url).protocol), 'La web debe usar http o https.')
      .transform((url) => new URL(url).href),
    companySize: z.enum(['1', '2-10', '11-50', '51-200', '201-500', '501+']),
    reviewRequested: z.boolean(),
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean(),
  }),
  attribution: z.object({
    sourceChannel: trimOptional(80),
    utmSource: trimOptional(120),
    utmMedium: trimOptional(120),
    utmCampaign: trimOptional(180),
    utmContent: trimOptional(180),
    referrer: trimOptional(500),
  }),
  startedAt: z.number().int().positive(),
  honeypot: z.string().max(0),
});

export const reviewRequestSchema = z.object({
  token: z.string().min(20).max(1024),
});
