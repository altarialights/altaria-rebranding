import type { BatchStatement } from '@tursodatabase/serverless';
import { classifyCommercialPriority, LEAD_SCORING_CONFIG } from '../assessment/lead-scoring';
import type { CommercialPriority, LeadInput } from '../assessment/types';
import { getDatabase } from './client';

interface LeadWrite {
  leadId: string;
  assessmentId: string;
  lead: LeadInput;
  commercialScore: number;
  commercialPriority: CommercialPriority;
  createdAt: string;
}

export const createLeadStatements = (input: LeadWrite): BatchStatement[] => {
  const statements: BatchStatement[] = [{
    sql: `INSERT INTO digital_leads (
      id, assessment_id, full_name, email, job_title, company_name, company_url,
      company_size, review_requested, privacy_consent_at, marketing_consent_at,
      commercial_score, commercial_priority, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.leadId, input.assessmentId, input.lead.fullName, input.lead.email,
      input.lead.jobTitle, input.lead.companyName, input.lead.companyUrl,
      input.lead.companySize, input.lead.reviewRequested ? 1 : 0, input.createdAt,
      input.lead.marketingConsent ? input.createdAt : null,
      input.commercialScore, input.commercialPriority, input.createdAt,
    ],
  }, {
    sql: `INSERT INTO digital_lead_events (id, lead_id, event_type, metadata_json, created_at)
          VALUES (?, ?, 'report_unlocked', '{}', ?)`,
    args: [crypto.randomUUID(), input.leadId, input.createdAt],
  }];

  if (input.lead.reviewRequested) {
    statements.push({
      sql: `INSERT INTO digital_lead_events (id, lead_id, event_type, metadata_json, created_at)
            VALUES (?, ?, 'review_requested', '{}', ?)`,
      args: [crypto.randomUUID(), input.leadId, input.createdAt],
    });
  }
  return statements;
};

export const addLeadEvent = async (
  leadId: string,
  eventType: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> => {
  const createdAt = new Date().toISOString();
  await getDatabase().run(
    `INSERT INTO digital_lead_events (id, lead_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    crypto.randomUUID(), leadId, eventType, JSON.stringify(metadata), createdAt,
  );
};

export const requestReviewByTokenHash = async (tokenHash: string): Promise<boolean> => {
  const database = getDatabase();
  const lead: unknown = await database.get(
    `SELECT l.id, l.review_requested, l.commercial_score FROM digital_leads l
     JOIN digital_assessments a ON a.id = l.assessment_id
     WHERE a.result_token_hash = ? LIMIT 1`,
    tokenHash,
  );
  if (!lead || typeof lead !== 'object') return false;
  const row = lead as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.commercial_score !== 'number') return false;
  if (row.review_requested === 1) return true;
  const nextScore = Math.min(100, row.commercial_score + LEAD_SCORING_CONFIG.intent.reviewRequested);
  await database.batch([
    {
      sql: `UPDATE digital_leads
            SET review_requested = 1, commercial_score = ?, commercial_priority = ?
            WHERE id = ? AND review_requested = 0`,
      args: [nextScore, classifyCommercialPriority(nextScore), row.id],
    },
    {
      sql: `INSERT INTO digital_lead_events (id, lead_id, event_type, metadata_json, created_at)
            SELECT ?, ?, 'review_requested', '{}', ? WHERE NOT EXISTS (
              SELECT 1 FROM digital_lead_events e WHERE e.lead_id = ? AND e.event_type = 'review_requested'
            )`,
      args: [crypto.randomUUID(), row.id, new Date().toISOString(), row.id],
    },
  ], 'immediate');
  return true;
};
