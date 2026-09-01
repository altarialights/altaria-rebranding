import type { AssessmentResult, CommercialPriority, LeadInput } from '../assessment/types';

export interface AssessmentResultEmailInput {
  lead: LeadInput;
  result: AssessmentResult;
  resultUrl: string;
}

export interface HighValueLeadAlertInput {
  lead: LeadInput;
  result: AssessmentResult;
  commercialPriority: CommercialPriority;
}

export interface EmailService {
  sendAssessmentResultEmail(input: AssessmentResultEmailInput): Promise<void>;
  sendHighValueLeadAlert(input: HighValueLeadAlertInput): Promise<void>;
}

class NoOpEmailService implements EmailService {
  async sendAssessmentResultEmail(_input: AssessmentResultEmailInput): Promise<void> {}
  async sendHighValueLeadAlert(_input: HighValueLeadAlertInput): Promise<void> {}
}

export const emailService: EmailService = new NoOpEmailService();
