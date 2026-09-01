PRAGMA foreign_keys = ON;

CREATE TABLE digital_assessments (
  id TEXT PRIMARY KEY,
  questionnaire_version TEXT NOT NULL,
  result_token_hash TEXT NOT NULL UNIQUE,
  overall_score INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  maturity_level TEXT NOT NULL CHECK (maturity_level IN ('IMPORTANT_DIGITAL_DEBT', 'FRAGMENTED_DIGITIZATION', 'SOLID_DIGITAL_BASE', 'HIGH_DIGITAL_MATURITY')),
  primary_opportunity TEXT NOT NULL,
  secondary_opportunity TEXT,
  source_channel TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE digital_assessment_scores (
  assessment_id TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('presence', 'acquisition', 'brand', 'operations', 'technology')),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('valid', 'insufficient_data')),
  valid_answers INTEGER NOT NULL CHECK (valid_answers BETWEEN 0 AND 5),
  PRIMARY KEY (assessment_id, dimension),
  FOREIGN KEY (assessment_id) REFERENCES digital_assessments(id) ON DELETE CASCADE
);

CREATE TABLE digital_assessment_answers (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  question_version TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('presence', 'acquisition', 'brand', 'operations', 'technology')),
  raw_value INTEGER CHECK (raw_value BETWEEN 1 AND 5 OR raw_value IS NULL),
  normalized_score INTEGER CHECK (normalized_score IN (0, 25, 50, 75, 100) OR normalized_score IS NULL),
  created_at TEXT NOT NULL,
  UNIQUE (assessment_id, question_key),
  FOREIGN KEY (assessment_id) REFERENCES digital_assessments(id) ON DELETE CASCADE
);

CREATE TABLE digital_leads (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_url TEXT NOT NULL,
  company_size TEXT NOT NULL CHECK (company_size IN ('1', '2-10', '11-50', '51-200', '201-500', '501+')),
  review_requested INTEGER NOT NULL DEFAULT 0 CHECK (review_requested IN (0, 1)),
  privacy_consent_at TEXT NOT NULL,
  marketing_consent_at TEXT,
  commercial_score INTEGER NOT NULL CHECK (commercial_score BETWEEN 0 AND 100),
  commercial_priority TEXT NOT NULL CHECK (commercial_priority IN ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  crm_status TEXT NOT NULL DEFAULT 'NEW' CHECK (crm_status IN ('NEW', 'REVIEWED', 'CONTACTED', 'CONVERSATION', 'MEETING', 'PROPOSAL', 'WON', 'LOST', 'NURTURE')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (assessment_id) REFERENCES digital_assessments(id) ON DELETE CASCADE
);

CREATE TABLE digital_lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES digital_leads(id) ON DELETE CASCADE
);

CREATE INDEX idx_digital_assessments_created_at ON digital_assessments(created_at DESC);
CREATE INDEX idx_digital_assessments_campaign ON digital_assessments(utm_campaign, created_at DESC);
CREATE INDEX idx_digital_answers_assessment ON digital_assessment_answers(assessment_id);
CREATE INDEX idx_digital_leads_priority ON digital_leads(commercial_priority, created_at DESC);
CREATE INDEX idx_digital_leads_status ON digital_leads(crm_status, created_at DESC);
CREATE INDEX idx_digital_lead_events_lead_created ON digital_lead_events(lead_id, created_at DESC);
