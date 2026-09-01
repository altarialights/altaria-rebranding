import { describe, expect, it } from 'vitest';
import type { NewAssessmentNotificationInput } from './types';
import {
  escapeTelegramHtml,
  formatNewAssessmentTelegramMessage,
  getDeterministicQuickRead,
  getNotificationHeader,
} from './templates';

const notificationInput: NewAssessmentNotificationInput = {
  lead: {
    fullName: 'Ana <Admin>',
    email: 'ana&ventas@example.com',
    jobTitle: 'CEO & Fundadora',
    companyName: 'Acme <Digital>',
    companyUrl: 'https://example.com',
    companySize: '11-50',
    reviewRequested: false,
    privacyConsent: true,
    marketingConsent: false,
  },
  result: {
    questionnaireVersion: 'v1',
    overallScore: 47,
    maturityLevel: 'FRAGMENTED_DIGITIZATION',
    maturityLabel: 'Digitalización fragmentada',
    maturityCopy: 'Texto de madurez',
    dimensionScores: [
      { dimension: 'presence', score: 64, status: 'valid', validAnswers: 5, totalQuestions: 5 },
      { dimension: 'acquisition', score: 48, status: 'valid', validAnswers: 5, totalQuestions: 5 },
      { dimension: 'brand', score: 56, status: 'valid', validAnswers: 5, totalQuestions: 5 },
      { dimension: 'operations', score: 32, status: 'valid', validAnswers: 5, totalQuestions: 5 },
      { dimension: 'technology', score: 36, status: 'valid', validAnswers: 5, totalQuestions: 5 },
    ],
    primaryOpportunity: 'operations',
    secondaryOpportunity: 'technology',
  },
  commercialScore: 86,
  commercialPriority: 'VERY_HIGH',
  resultUrl: 'https://preview.example.com/medir-nivel-digital/resultado/token?a=1&b=2',
};

describe('Telegram notification templates', () => {
  it.each([
    ['LOW', '⚪ NUEVO DIAGNÓSTICO'],
    ['MEDIUM', '🔵 NUEVO DIAGNÓSTICO'],
    ['HIGH', '🟠 NUEVO LEAD PRIORITARIO'],
    ['VERY_HIGH', '🔥 NUEVO LEAD MUY PRIORITARIO'],
  ] as const)('clasifica la prioridad %s', (priority, expected) => {
    expect(getNotificationHeader(priority, false)).toBe(expected);
  });

  it('prioriza siempre una revisión personal solicitada', () => {
    expect(getNotificationHeader('LOW', true)).toBe('🚨 REVISIÓN PERSONAL SOLICITADA');
    expect(getNotificationHeader('VERY_HIGH', true)).toBe('🚨 REVISIÓN PERSONAL SOLICITADA');
  });

  it('genera la lectura rápida determinista según la oportunidad principal', () => {
    expect(getDeterministicQuickRead('operations')).toBe(
      'La empresa tiene margen claro para automatizar procesos y reducir tareas manuales.',
    );
    expect(getDeterministicQuickRead('acquisition')).toContain('captación de clientes');
  });

  it('escapa contenido dinámico y forma el mensaje completo', () => {
    expect(escapeTelegramHtml('<b>"A&B"</b>')).toBe('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
    const message = formatNewAssessmentTelegramMessage(notificationInput);

    expect(message).toContain('Acme &lt;Digital&gt;');
    expect(message).toContain('Ana &lt;Admin&gt;');
    expect(message).toContain('ana&amp;ventas@example.com');
    expect(message).toContain('token?a=1&amp;b=2');
    expect(message).toContain('Operaciones: 32/100');
    expect(message).toContain('Lead Score:</b> 86/100 — MUY ALTO');
    expect(message).not.toContain('Acme <Digital>');
  });
});
