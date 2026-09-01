import { ActionError, defineAction } from 'astro:actions';
import { calculateLeadScore } from '../lib/assessment/lead-scoring';
import { allowAssessmentRequest } from '../lib/assessment/rate-limit';
import { calculateAssessment } from '../lib/assessment/scoring';
import { createDemoResultToken, createResultToken, hashResultToken } from '../lib/assessment/token';
import type { AssessmentAnswers, LeadInput } from '../lib/assessment/types';
import { assessmentSubmissionSchema, reviewRequestSchema } from '../lib/assessment/validation';
import { hasTursoConfiguration, isAssessmentDemoMode } from '../lib/db/client';
import { persistAssessment } from '../lib/db/persistence.service';
import { addLeadEvent, requestReviewByTokenHash } from '../lib/db/leads.repository';
import { emailService } from '../lib/email/email.service';
import { notifyNewAssessment } from '../lib/notifications/notification.service';

const MINIMUM_COMPLETION_TIME_MS = 45_000;
const MAXIMUM_COMPLETION_AGE_MS = 24 * 60 * 60 * 1000;

const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new ActionError({ code: 'FORBIDDEN', message: 'El origen de la solicitud no es válido.' });
  }
};

export const server = {
  submitDigitalAssessment: defineAction({
    input: assessmentSubmissionSchema,
    handler: async (input, context) => {
      assertSameOrigin(context.request);
      if (!await allowAssessmentRequest({ request: context.request, action: 'submit' })) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Espera unos minutos antes de volver a intentarlo.' });
      }

      const elapsed = Date.now() - input.startedAt;
      if (elapsed < MINIMUM_COMPLETION_TIME_MS || elapsed > MAXIMUM_COMPLETION_AGE_MS) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'La sesión ha caducado o se ha completado demasiado rápido.' });
      }

      const answers = input.answers as AssessmentAnswers;
      const result = calculateAssessment(answers);
      const lead = input.lead as LeadInput;
      const commercial = calculateLeadScore({
        result,
        companySize: lead.companySize,
        reportUnlocked: true,
        reviewRequested: lead.reviewRequested,
      });

      if (isAssessmentDemoMode()) {
        const token = createDemoResultToken(answers);
        return { token, resultUrl: `/medir-nivel-digital/resultado/${token}`, demo: true };
      }

      if (!hasTursoConfiguration()) {
        throw new ActionError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'El diagnóstico no puede guardarse ahora mismo. Inténtalo de nuevo más tarde.',
        });
      }

      const token = createResultToken();
      const tokenHash = await hashResultToken(token);
      const createdAt = new Date().toISOString();
      const leadId = crypto.randomUUID();
      await persistAssessment({
        assessmentId: crypto.randomUUID(),
        leadId,
        tokenHash,
        result,
        answers,
        attribution: input.attribution,
        lead,
        commercialScore: commercial.score,
        commercialPriority: commercial.priority,
        createdAt,
      });

      const resultUrl = `/medir-nivel-digital/resultado/${token}`;
      const notification = await notifyNewAssessment({
        lead,
        result,
        commercialScore: commercial.score,
        commercialPriority: commercial.priority,
        resultUrl: new URL(resultUrl, context.request.url).href,
      });
      try {
        await addLeadEvent(
          leadId,
          notification.status === 'sent'
            ? 'telegram_notification_sent'
            : 'telegram_notification_failed',
          {
            timestamp: notification.timestamp,
            provider: notification.provider,
            notification_type: notification.notificationType,
            ...(notification.status === 'sent'
              ? { provider_message_id: notification.providerMessageId }
              : { failure_reason: notification.reason }),
          },
        );
      } catch {
        console.warn('[notifications] No se pudo registrar el evento de entrega de Telegram.');
      }
      if (notification.status === 'failed') {
        console.warn(`[notifications] La notificación de Telegram falló (${notification.reason}).`);
      }
      await emailService.sendAssessmentResultEmail({ lead, result, resultUrl });
      if (commercial.priority === 'HIGH' || commercial.priority === 'VERY_HIGH') {
        await emailService.sendHighValueLeadAlert({ lead, result, commercialPriority: commercial.priority });
      }
      return { token, resultUrl, demo: false };
    },
  }),

  requestAssessmentReview: defineAction({
    input: reviewRequestSchema,
    handler: async (input, context) => {
      assertSameOrigin(context.request);
      if (!await allowAssessmentRequest({ request: context.request, action: 'request_review' })) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Espera unos minutos antes de volver a intentarlo.' });
      }
      if (isAssessmentDemoMode() && input.token.startsWith('demo_')) return { requested: true };
      if (!hasTursoConfiguration()) {
        throw new ActionError({ code: 'SERVICE_UNAVAILABLE', message: 'No se ha podido registrar la solicitud.' });
      }
      const updated = await requestReviewByTokenHash(await hashResultToken(input.token));
      if (!updated) throw new ActionError({ code: 'NOT_FOUND', message: 'No encontramos este resultado.' });
      return { requested: true };
    },
  }),
};
