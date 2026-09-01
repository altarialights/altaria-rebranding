import {
  getDimensionDefinition,
  type RecommendationBand,
} from './questionnaires/v1';
import type { AssessmentDimension, Recommendation } from './types';

export const recommendationBandForScore = (score: number): RecommendationBand => {
  if (score <= 39) return 'critical';
  if (score <= 59) return 'developing';
  if (score <= 79) return 'solid';
  return 'advanced';
};

export const recommendationForDimension = (
  dimension: AssessmentDimension,
  score: number,
): Recommendation => getDimensionDefinition(dimension).recommendations[recommendationBandForScore(score)];
