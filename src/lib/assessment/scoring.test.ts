import { describe, expect, it } from 'vitest';
import { questionnaireV1 } from './questionnaires/v1';
import { calculateLeadScore, classifyCommercialPriority } from './lead-scoring';
import { calculateAssessment, classifyMaturity } from './scoring';
import type { AnswerValue, AssessmentAnswers, CompanySize } from './types';

const answersWith = (value: AnswerValue): AssessmentAnswers => Object.fromEntries(
  questionnaireV1.dimensions.flatMap((dimension) => dimension.questions.map((question) => [question.key, value])),
);

describe('digital assessment scoring v1', () => {
  it('normaliza todas las respuestas 1 a 0', () => {
    expect(calculateAssessment(answersWith(1)).overallScore).toBe(0);
  });

  it('normaliza todas las respuestas 3 a 50', () => {
    expect(calculateAssessment(answersWith(3)).overallScore).toBe(50);
  });

  it('normaliza todas las respuestas 5 a 100', () => {
    expect(calculateAssessment(answersWith(5)).overallScore).toBe(100);
  });

  it('excluye N/A de la media cuando quedan al menos tres respuestas válidas', () => {
    const answers = answersWith(3);
    answers.P1 = null;
    answers.P2 = null;
    const result = calculateAssessment(answers);
    expect(result.dimensionScores[0]).toMatchObject({ score: 50, validAnswers: 3, status: 'valid' });
  });

  it('marca una dimensión con menos de tres respuestas como insufficient_data', () => {
    const answers = answersWith(3);
    answers.P1 = null; answers.P2 = null; answers.P3 = null;
    const result = calculateAssessment(answers);
    expect(result.dimensionScores[0]).toMatchObject({ score: null, validAnswers: 2, status: 'insufficient_data' });
    expect(result.overallScore).toBe(50);
  });

  it('calcula el overall ponderando solo dimensiones válidas', () => {
    const answers = answersWith(5);
    questionnaireV1.dimensions[0].questions.forEach((question) => { answers[question.key] = 1; });
    expect(calculateAssessment(answers).overallScore).toBe(80);
  });

  it('clasifica correctamente los límites de madurez', () => {
    expect(classifyMaturity(0).key).toBe('IMPORTANT_DIGITAL_DEBT');
    expect(classifyMaturity(39).key).toBe('IMPORTANT_DIGITAL_DEBT');
    expect(classifyMaturity(40).key).toBe('FRAGMENTED_DIGITIZATION');
    expect(classifyMaturity(59).key).toBe('FRAGMENTED_DIGITIZATION');
    expect(classifyMaturity(60).key).toBe('SOLID_DIGITAL_BASE');
    expect(classifyMaturity(79).key).toBe('SOLID_DIGITAL_BASE');
    expect(classifyMaturity(80).key).toBe('HIGH_DIGITAL_MATURITY');
    expect(classifyMaturity(100).key).toBe('HIGH_DIGITAL_MATURITY');
  });

  it('selecciona como oportunidades las dimensiones con menor puntuación', () => {
    const answers = answersWith(5);
    questionnaireV1.dimensions[3].questions.forEach((question) => { answers[question.key] = 1; });
    questionnaireV1.dimensions[4].questions.forEach((question) => { answers[question.key] = 2; });
    const result = calculateAssessment(answers);
    expect(result.primaryOpportunity).toBe('operations');
    expect(result.secondaryOpportunity).toBe('technology');
  });
});

describe('commercial lead score', () => {
  it('mantiene exactos los límites de prioridad', () => {
    expect(classifyCommercialPriority(0)).toBe('LOW');
    expect(classifyCommercialPriority(39)).toBe('LOW');
    expect(classifyCommercialPriority(40)).toBe('MEDIUM');
    expect(classifyCommercialPriority(69)).toBe('MEDIUM');
    expect(classifyCommercialPriority(70)).toBe('HIGH');
    expect(classifyCommercialPriority(84)).toBe('HIGH');
    expect(classifyCommercialPriority(85)).toBe('VERY_HIGH');
    expect(classifyCommercialPriority(100)).toBe('VERY_HIGH');
  });

  it.each<CompanySize>(['1', '2-10', '11-50', '51-200', '201-500', '501+'])('produce un score 0-100 para tamaño %s', (companySize) => {
    const result = calculateAssessment(answersWith(3));
    const leadScore = calculateLeadScore({ result, companySize, reportUnlocked: true, reviewRequested: false });
    expect(leadScore.score).toBeGreaterThanOrEqual(0);
    expect(leadScore.score).toBeLessThanOrEqual(100);
  });
});
