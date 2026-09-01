import { describe, expect, it } from 'vitest';
import { questionnaireV1 } from './questionnaires/v1';
import { assessmentSubmissionSchema } from './validation';

const validInput = () => ({
  questionnaireVersion: 'v1',
  answers: Object.fromEntries(questionnaireV1.dimensions.flatMap((dimension) => dimension.questions.map((question) => [question.key, 3]))),
  lead: {
    fullName: 'Ana García', email: 'ana@empresa.es', jobTitle: 'Directora', companyName: 'Empresa Norte',
    companyUrl: 'https://empresa.es', companySize: '11-50', reviewRequested: false,
    privacyConsent: true, marketingConsent: false,
  },
  attribution: {}, startedAt: Date.now() - 300_000, honeypot: '',
});

describe('assessment submission validation', () => {
  it('acepta un formulario completo y normaliza email y URL', () => {
    const parsed = assessmentSubmissionSchema.parse(validInput());
    expect(parsed.lead.email).toBe('ana@empresa.es');
    expect(parsed.lead.companyUrl).toBe('https://empresa.es/');
  });

  it('rechaza una respuesta ausente', () => {
    const input = validInput();
    delete input.answers.P1;
    expect(assessmentSubmissionSchema.safeParse(input).success).toBe(false);
  });

  it('rechaza privacidad no aceptada y honeypot relleno', () => {
    const input = validInput();
    input.lead.privacyConsent = false;
    input.honeypot = 'bot';
    expect(assessmentSubmissionSchema.safeParse(input).success).toBe(false);
  });
});
