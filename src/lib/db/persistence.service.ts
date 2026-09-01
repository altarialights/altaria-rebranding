import type { AssessmentAnswers, AssessmentResult, AttributionInput, LeadInput } from '../assessment/types';
import { getDatabase } from './client';
import { createAssessmentStatements } from './assessments.repository';
import { createLeadStatements } from './leads.repository';

interface PersistAssessmentInput {
  assessmentId: string;
  leadId: string;
  tokenHash: string;
  result: AssessmentResult;
  answers: AssessmentAnswers;
  attribution: AttributionInput;
  lead: LeadInput;
  commercialScore: number;
  commercialPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  createdAt: string;
}

export const persistAssessment = async (input: PersistAssessmentInput): Promise<void> => {
  const database = getDatabase();
  await database.pragma('foreign_keys = ON');
  const statements = [
    ...createAssessmentStatements(input),
    ...createLeadStatements(input),
  ];
  await database.batch(statements, 'immediate');
};
