import type {
  AssessmentResult,
  CommercialPriority,
  CompanySize,
} from './types';

export const LEAD_SCORING_CONFIG = {
  need: { inverseOverallMax: 30, weakestDimensionMax: 10 },
  breadth: { threshold: 60, max: 20 },
  companyFit: {
    max: 20,
    points: { '1': 8, '2-10': 12, '11-50': 16, '51-200': 20, '201-500': 18, '501+': 16 },
  },
  intent: { completed: 8, reportUnlocked: 6, reviewRequested: 6 },
  priorities: { medium: 40, high: 70, veryHigh: 85 },
} as const;

interface LeadScoreInput {
  result: AssessmentResult;
  companySize: CompanySize;
  reportUnlocked: boolean;
  reviewRequested: boolean;
}

export const classifyCommercialPriority = (score: number): CommercialPriority => {
  if (score >= LEAD_SCORING_CONFIG.priorities.veryHigh) return 'VERY_HIGH';
  if (score >= LEAD_SCORING_CONFIG.priorities.high) return 'HIGH';
  if (score >= LEAD_SCORING_CONFIG.priorities.medium) return 'MEDIUM';
  return 'LOW';
};

export const calculateLeadScore = (input: LeadScoreInput): {
  score: number;
  priority: CommercialPriority;
  components: { need: number; breadth: number; companyFit: number; intent: number };
} => {
  const validScores = input.result.dimensionScores.flatMap((dimension) =>
    dimension.score === null ? [] : [dimension.score],
  );
  const weakest = Math.min(...validScores);
  const need = Math.round(
    ((100 - input.result.overallScore) / 100) * LEAD_SCORING_CONFIG.need.inverseOverallMax
      + ((100 - weakest) / 100) * LEAD_SCORING_CONFIG.need.weakestDimensionMax,
  );
  const dimensionsBelowThreshold = validScores.filter(
    (score) => score < LEAD_SCORING_CONFIG.breadth.threshold,
  ).length;
  const breadth = Math.round(
    (dimensionsBelowThreshold / validScores.length) * LEAD_SCORING_CONFIG.breadth.max,
  );
  const companyFit = LEAD_SCORING_CONFIG.companyFit.points[input.companySize];
  const intent = LEAD_SCORING_CONFIG.intent.completed
    + (input.reportUnlocked ? LEAD_SCORING_CONFIG.intent.reportUnlocked : 0)
    + (input.reviewRequested ? LEAD_SCORING_CONFIG.intent.reviewRequested : 0);
  const score = Math.min(100, need + breadth + companyFit + intent);

  return {
    score,
    priority: classifyCommercialPriority(score),
    components: { need, breadth, companyFit, intent },
  };
};
