import { describe, expect, it, vi } from 'vitest';
import { notifyNewAssessment } from './notification.service';
import { sendTelegramMessage } from './telegram.service';
import type { NewAssessmentNotificationInput } from './types';

const configuredEnvironment = { botToken: 'test-token', chatId: 'test-chat' };

describe('Telegram service', () => {
  it('informa configuración ausente sin llamar a fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const warn = vi.fn();
    const result = await sendTelegramMessage('mensaje', {
      environment: {},
      fetchImplementation,
      development: true,
      warn,
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'missing_configuration' });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('trata una respuesta HTTP no satisfactoria como fallo no lanzado', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    await expect(sendTelegramMessage('mensaje', {
      environment: configuredEnvironment,
      fetchImplementation,
    })).resolves.toMatchObject({ status: 'failed', reason: 'http_error' });
  });

  it('cancela una petición que supera el timeout sin lanzar', async () => {
    const fetchImplementation = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    await expect(sendTelegramMessage('mensaje', {
      environment: configuredEnvironment,
      fetchImplementation,
      timeoutMs: 1,
    })).resolves.toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('devuelve el identificador del mensaje en una entrega correcta', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ok: true, result: { message_id: 321 } }),
    );
    const result = await sendTelegramMessage('<b>mensaje</b>', {
      environment: configuredEnvironment,
      fetchImplementation,
    });

    expect(result).toMatchObject({ status: 'sent', providerMessageId: 321 });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      chat_id: 'test-chat',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  it('no propaga un fallo de red al flujo del assessment', async () => {
    const input = {
      lead: {
        fullName: 'Ana', email: 'ana@example.com', jobTitle: 'CEO', companyName: 'Acme',
        companyUrl: '', companySize: '1', reviewRequested: false,
        privacyConsent: true, marketingConsent: false,
      },
      result: {
        questionnaireVersion: 'v1', overallScore: 50,
        maturityLevel: 'FRAGMENTED_DIGITIZATION', maturityLabel: 'Digitalización fragmentada',
        maturityCopy: '', primaryOpportunity: 'operations', secondaryOpportunity: null,
        dimensionScores: [
          { dimension: 'presence', score: 50, status: 'valid', validAnswers: 5, totalQuestions: 5 },
          { dimension: 'acquisition', score: 50, status: 'valid', validAnswers: 5, totalQuestions: 5 },
          { dimension: 'brand', score: 50, status: 'valid', validAnswers: 5, totalQuestions: 5 },
          { dimension: 'operations', score: 40, status: 'valid', validAnswers: 5, totalQuestions: 5 },
          { dimension: 'technology', score: 50, status: 'valid', validAnswers: 5, totalQuestions: 5 },
        ],
      },
      commercialScore: 50,
      commercialPriority: 'MEDIUM',
      resultUrl: 'https://example.com/resultado/token',
    } satisfies NewAssessmentNotificationInput;
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'));

    await expect(notifyNewAssessment(input, {
      environment: configuredEnvironment,
      fetchImplementation,
    })).resolves.toMatchObject({ status: 'failed', reason: 'network_error' });
  });
});
