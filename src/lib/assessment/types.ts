export const ASSESSMENT_DIMENSIONS = [
  'presence',
  'acquisition',
  'brand',
  'operations',
  'technology',
] as const;

export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];
export type QuestionnaireVersion = 'v1';
export type AnswerValue = 1 | 2 | 3 | 4 | 5 | null;
export type QuestionKey = `${'P' | 'C' | 'M' | 'O' | 'T'}${1 | 2 | 3 | 4 | 5}`;
export type AssessmentAnswers = Partial<Record<QuestionKey, AnswerValue>>;

export type MaturityLevel =
  | 'IMPORTANT_DIGITAL_DEBT'
  | 'FRAGMENTED_DIGITIZATION'
  | 'SOLID_DIGITAL_BASE'
  | 'HIGH_DIGITAL_MATURITY';

export interface DimensionScore {
  dimension: AssessmentDimension;
  score: number | null;
  status: 'valid' | 'insufficient_data';
  validAnswers: number;
  totalQuestions: number;
}

export interface AssessmentResult {
  questionnaireVersion: QuestionnaireVersion;
  overallScore: number;
  maturityLevel: MaturityLevel;
  maturityLabel: string;
  maturityCopy: string;
  dimensionScores: DimensionScore[];
  primaryOpportunity: AssessmentDimension;
  secondaryOpportunity: AssessmentDimension | null;
}

export type CompanySize = '1' | '2-10' | '11-50' | '51-200' | '201-500' | '501+';
export type CommercialPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface LeadInput {
  fullName: string;
  email: string;
  jobTitle: string;
  companyName: string;
  companyUrl: string;
  companySize: CompanySize;
  reviewRequested: boolean;
  privacyConsent: true;
  marketingConsent: boolean;
}

export interface AttributionInput {
  sourceChannel?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrer?: string;
}

export interface Recommendation {
  title: string;
  detected: string;
  whyItMatters: string;
  reviewFirst: readonly string[];
}
