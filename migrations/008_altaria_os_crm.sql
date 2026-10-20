-- Altaria OS Phase 2. Append-only CRM schema; historical source rows are never altered.
CREATE TABLE crm_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 180 AND name = trim(name)),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 2 AND 180 AND normalized_name = lower(trim(normalized_name))),
  sector TEXT CHECK (sector IS NULL OR length(sector) BETWEEN 2 AND 100),
  city TEXT CHECK (city IS NULL OR length(city) BETWEEN 2 AND 100),
  region TEXT CHECK (region IS NULL OR length(region) BETWEEN 2 AND 100),
  country_code TEXT NOT NULL DEFAULT 'ES' CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  website_url TEXT CHECK (website_url IS NULL OR length(website_url) BETWEEN 8 AND 500),
  lead_origin TEXT NOT NULL DEFAULT 'manual' CHECK (lead_origin IN ('manual', 'digital_lead', 'cards_inquiry', 'cards_order', 'other')),
  responsible_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
  merged_into_id TEXT REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  UNIQUE (id, responsible_user_id)
);
CREATE INDEX idx_crm_organizations_search ON crm_organizations(normalized_name, city);
CREATE INDEX idx_crm_organizations_owner ON crm_organizations(responsible_user_id, updated_at DESC);

CREATE TABLE crm_organization_identifiers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('tax_id', 'domain', 'google_place_id', 'external_id')),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 3 AND 255 AND normalized_value = lower(trim(normalized_value))),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'verified')),
  verified_at TEXT,
  verified_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((verification_status = 'verified') = (verified_at IS NOT NULL)),
  CHECK ((verification_status = 'verified') = (verified_by IS NOT NULL))
);
CREATE INDEX idx_crm_identifiers_org ON crm_organization_identifiers(organization_id, kind);
CREATE INDEX idx_crm_identifiers_lookup ON crm_organization_identifiers(kind, normalized_value);
CREATE UNIQUE INDEX idx_crm_identifiers_verified_unique ON crm_organization_identifiers(kind, normalized_value) WHERE verification_status = 'verified';

CREATE TABLE crm_contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160 AND full_name = trim(full_name)),
  email TEXT CHECK (email IS NULL OR (length(email) BETWEEN 5 AND 254 AND email = lower(trim(email)))),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 7 AND 30),
  job_title TEXT CHECK (job_title IS NULL OR length(job_title) BETWEEN 2 AND 120),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX idx_crm_contacts_org_email ON crm_contacts(organization_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_crm_contacts_primary ON crm_contacts(organization_id) WHERE is_primary = 1;
CREATE INDEX idx_crm_contacts_org ON crm_contacts(organization_id, full_name);

CREATE TABLE crm_opportunities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 180 AND title = trim(title)),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost')),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 9999999999),
  currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
  responsible_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  closed_at TEXT,
  lost_reason TEXT CHECK (lost_reason IS NULL OR length(lost_reason) BETWEEN 3 AND 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((stage IN ('won', 'lost')) = (closed_at IS NOT NULL)),
  CHECK (stage = 'lost' OR lost_reason IS NULL),
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_crm_opportunities_org ON crm_opportunities(organization_id, stage, updated_at DESC);
CREATE INDEX idx_crm_opportunities_pipeline ON crm_opportunities(stage, responsible_user_id, updated_at DESC);

CREATE TABLE crm_opportunity_stage_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id) ON DELETE RESTRICT,
  from_stage TEXT CHECK (from_stage IS NULL OR from_stage IN ('new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost')),
  to_stage TEXT NOT NULL CHECK (to_stage IN ('new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost')),
  opportunity_version INTEGER NOT NULL CHECK (opportunity_version >= 1),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  UNIQUE (opportunity_id, opportunity_version),
  CHECK (from_stage IS NULL OR from_stage <> to_stage)
);
CREATE INDEX idx_crm_stage_events_timeline ON crm_opportunity_stage_events(opportunity_id, occurred_at DESC);

CREATE TABLE crm_activities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  opportunity_id TEXT,
  contact_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('call', 'visit', 'meeting', 'note')),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 2 AND 240 AND summary = trim(summary)),
  detail TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 2 AND 4000),
  happened_at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (opportunity_id, organization_id) REFERENCES crm_opportunities(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_activities_org_time ON crm_activities(organization_id, happened_at DESC);
CREATE INDEX idx_crm_activities_opp_time ON crm_activities(opportunity_id, happened_at DESC);

CREATE TABLE crm_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  opportunity_id TEXT,
  contact_id TEXT,
  origin_activity_id TEXT UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 240 AND title = trim(title)),
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  responsible_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  completed_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CHECK ((status = 'done') = (completed_by IS NOT NULL)),
  FOREIGN KEY (opportunity_id, organization_id) REFERENCES crm_opportunities(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (origin_activity_id, organization_id) REFERENCES crm_activities(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_tasks_org_status ON crm_tasks(organization_id, status, due_at);
CREATE INDEX idx_crm_tasks_assignee ON crm_tasks(responsible_user_id, status, due_at);

CREATE TABLE crm_source_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  digital_lead_id TEXT UNIQUE REFERENCES digital_leads(id) ON DELETE RESTRICT,
  card_inquiry_id TEXT UNIQUE REFERENCES consultas_tarjetas(id) ON DELETE RESTRICT,
  card_order_id TEXT UNIQUE REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  linked_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  linked_at TEXT NOT NULL,
  CHECK ((digital_lead_id IS NOT NULL) + (card_inquiry_id IS NOT NULL) + (card_order_id IS NOT NULL) = 1)
);
CREATE INDEX idx_crm_source_links_org ON crm_source_links(organization_id, linked_at DESC);

CREATE TABLE crm_timeline_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('organization.created', 'organization.updated', 'contact.created', 'opportunity.created', 'opportunity.stage', 'activity.created', 'task.created', 'task.completed', 'task.reassigned', 'source.linked', 'organization.merged')),
  entity_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json))
);
CREATE INDEX idx_crm_timeline_org_time ON crm_timeline_events(organization_id, occurred_at DESC);

CREATE TABLE crm_organization_merges (
  source_organization_id TEXT PRIMARY KEY REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  target_organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  merged_at TEXT NOT NULL,
  CHECK (source_organization_id <> target_organization_id)
);
CREATE INDEX idx_crm_merges_target ON crm_organization_merges(target_organization_id, merged_at DESC);
