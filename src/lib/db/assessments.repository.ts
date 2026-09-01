import type { BatchStatement } from '@tursodatabase/serverless';
import { classifyMaturity, normalizeAnswer } from '../assessment/scoring';
import type {
  AssessmentAnswers,
  AssessmentDimension,
  AssessmentResult,
  AttributionInput,
  DimensionScore,
  MaturityLevel,
} from '../assessment/types';
import { questionnaireV1 } from '../assessment/questionnaires/v1';
import { getDatabase } from './client';

interface AssessmentWrite {
  assessmentId: string;
  tokenHash: string;
  result: AssessmentResult;
  answers: AssessmentAnswers;
  attribution: AttributionInput;
  createdAt: string;
}

export interface StoredAssessmentResult extends AssessmentResult {
  companyName: string;
  reviewRequested: boolean;
  leadId: string;
}

const optional = (value: string | undefined): string | null => value || null;

export const createAssessmentStatements = (input: AssessmentWrite): BatchStatement[] => {
  const statements: BatchStatement[] = [{
    sql: `INSERT INTO digital_assessments (
      id, questionnaire_version, result_token_hash, overall_score, maturity_level,
      primary_opportunity, secondary_opportunity, source_channel, utm_source, utm_medium,
      utm_campaign, utm_content, referrer, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.assessmentId, input.result.questionnaireVersion, input.tokenHash,
      input.result.overallScore, input.result.maturityLevel, input.result.primaryOpportunity,
      input.result.secondaryOpportunity, optional(input.attribution.sourceChannel),
      optional(input.attribution.utmSource), optional(input.attribution.utmMedium),
      optional(input.attribution.utmCampaign), optional(input.attribution.utmContent),
      optional(input.attribution.referrer), input.createdAt,
    ],
  }];

  input.result.dimensionScores.forEach((dimensionScore) => {
    statements.push({
      sql: `INSERT INTO digital_assessment_scores
        (assessment_id, dimension, score, status, valid_answers) VALUES (?, ?, ?, ?, ?)`,
      args: [input.assessmentId, dimensionScore.dimension, dimensionScore.score, dimensionScore.status, dimensionScore.validAnswers],
    });
  });

  questionnaireV1.dimensions.forEach((dimension) => {
    dimension.questions.forEach((question) => {
      const rawValue = input.answers[question.key] ?? null;
      statements.push({
        sql: `INSERT INTO digital_assessment_answers
          (id, assessment_id, question_key, question_version, dimension, raw_value, normalized_score, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), input.assessmentId, question.key, questionnaireV1.version, dimension.key, rawValue, normalizeAnswer(rawValue), input.createdAt],
      });
    });
  });

  return statements;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isDimension = (value: unknown): value is AssessmentDimension =>
  typeof value === 'string' && questionnaireV1.dimensions.some((dimension) => dimension.key === value);

const isMaturity = (value: unknown): value is MaturityLevel =>
  typeof value === 'string' && questionnaireV1.maturityLevels.some((level) => level.key === value);

const toNumber = (value: unknown): number | null => typeof value === 'number' ? value : null;

export const findAssessmentByTokenHash = async (tokenHash: string): Promise<StoredAssessmentResult | null> => {
  const database = getDatabase();
  const row: unknown = await database.get(
    `SELECT a.questionnaire_version, a.overall_score, a.maturity_level,
      a.primary_opportunity, a.secondary_opportunity,
      l.company_name, l.review_requested, l.id AS lead_id
    FROM digital_assessments a
    JOIN digital_leads l ON l.assessment_id = a.id
    WHERE a.result_token_hash = ? LIMIT 1`,
    tokenHash,
  );
  if (!isRecord(row)) return null;

  const overallScore = toNumber(row.overall_score);
  if (
    row.questionnaire_version !== 'v1' || overallScore === null ||
    !isMaturity(row.maturity_level) || !isDimension(row.primary_opportunity) ||
    (row.secondary_opportunity !== null && !isDimension(row.secondary_opportunity)) ||
    typeof row.company_name !== 'string' || typeof row.lead_id !== 'string'
  ) return null;

  const scoreRows: unknown = await database.all(
    `SELECT dimension, score, status, valid_answers
     FROM digital_assessment_scores
     WHERE assessment_id = (SELECT id FROM digital_assessments WHERE result_token_hash = ?)
     ORDER BY CASE dimension WHEN 'presence' THEN 1 WHEN 'acquisition' THEN 2 WHEN 'brand' THEN 3 WHEN 'operations' THEN 4 ELSE 5 END`,
    tokenHash,
  );
  if (!Array.isArray(scoreRows)) return null;

  const dimensionScores: DimensionScore[] = scoreRows.flatMap((scoreRow) => {
    if (!isRecord(scoreRow) || !isDimension(scoreRow.dimension)) return [];
    const score = scoreRow.score === null ? null : toNumber(scoreRow.score);
    const validAnswers = toNumber(scoreRow.valid_answers);
    if ((scoreRow.status !== 'valid' && scoreRow.status !== 'insufficient_data') || validAnswers === null) return [];
    return [{ dimension: scoreRow.dimension, score, status: scoreRow.status, validAnswers, totalQuestions: 5 }];
  });
  if (dimensionScores.length !== questionnaireV1.dimensions.length) return null;

  const maturity = classifyMaturity(overallScore);
  return {
    questionnaireVersion: 'v1', overallScore, maturityLevel: row.maturity_level,
    maturityLabel: maturity.label, maturityCopy: maturity.copy, dimensionScores,
    primaryOpportunity: row.primary_opportunity,
    secondaryOpportunity: isDimension(row.secondary_opportunity) ? row.secondary_opportunity : null,
    companyName: row.company_name,
    reviewRequested: row.review_requested === 1,
    leadId: row.lead_id,
  };
};
