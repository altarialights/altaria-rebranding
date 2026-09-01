import { questionnaireV1 } from './questionnaires/v1';
import type {
  AnswerValue,
  AssessmentAnswers,
  AssessmentResult,
  DimensionScore,
  MaturityLevel,
} from './types';

const NORMALIZED_SCORE: Readonly<Record<Exclude<AnswerValue, null>, number>> = {
  1: 0,
  2: 25,
  3: 50,
  4: 75,
  5: 100,
};

export const normalizeAnswer = (answer: AnswerValue): number | null =>
  answer === null ? null : NORMALIZED_SCORE[answer];

export const classifyMaturity = (score: number): {
  key: MaturityLevel;
  label: string;
  copy: string;
} => {
  const level = questionnaireV1.maturityLevels.find(
    (candidate) => score >= candidate.min && score <= candidate.max,
  );
  if (!level) throw new RangeError(`Maturity score outside 0-100: ${score}`);
  return { key: level.key, label: level.label, copy: level.copy };
};

export const calculateAssessment = (answers: AssessmentAnswers): AssessmentResult => {
  const dimensionScores: DimensionScore[] = questionnaireV1.dimensions.map((dimension) => {
    const validScores = dimension.questions
      .map((question) => answers[question.key])
      .filter((answer): answer is Exclude<AnswerValue, null> => typeof answer === 'number')
      .map((answer) => NORMALIZED_SCORE[answer]);

    if (validScores.length < questionnaireV1.minimumValidAnswersPerDimension) {
      return {
        dimension: dimension.key,
        score: null,
        status: 'insufficient_data',
        validAnswers: validScores.length,
        totalQuestions: dimension.questions.length,
      };
    }

    return {
      dimension: dimension.key,
      score: Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length),
      status: 'valid',
      validAnswers: validScores.length,
      totalQuestions: dimension.questions.length,
    };
  });

  const weighted = dimensionScores.flatMap((score) => {
    if (score.score === null) return [];
    const definition = questionnaireV1.dimensions.find((item) => item.key === score.dimension);
    return definition ? [{ value: score.score * definition.weight, weight: definition.weight }] : [];
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) throw new Error('No hay datos suficientes para calcular el índice.');

  const overallScore = Math.round(
    weighted.reduce((sum, item) => sum + item.value, 0) / totalWeight,
  );
  const maturity = classifyMaturity(overallScore);
  const opportunities = dimensionScores
    .filter((item): item is DimensionScore & { score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score);

  const primaryOpportunity = opportunities[0]?.dimension;
  if (!primaryOpportunity) throw new Error('No hay dimensiones válidas para generar oportunidades.');

  return {
    questionnaireVersion: questionnaireV1.version,
    overallScore,
    maturityLevel: maturity.key,
    maturityLabel: maturity.label,
    maturityCopy: maturity.copy,
    dimensionScores,
    primaryOpportunity,
    secondaryOpportunity: opportunities[1]?.dimension ?? null,
  };
};
