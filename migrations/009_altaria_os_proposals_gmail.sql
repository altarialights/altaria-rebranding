-- Phase 3: proposals and a deliberately disconnected Gmail staging model.
-- Existing business rows and prior migrations are not rewritten.
CREATE TABLE crm_proposal_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 120),
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE crm_proposal_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
  description TEXT NOT NULL DEFAULT '',
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents BETWEEN 0 AND 9999999999),
  tax_bps INTEGER NOT NULL DEFAULT 2100 CHECK (tax_bps BETWEEN 0 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE crm_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  opportunity_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 180),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  duplicate_of_id TEXT REFERENCES crm_proposals(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  decided_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (opportunity_id, organization_id) REFERENCES crm_opportunities(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK (status != 'sent' OR sent_at IS NOT NULL),
  CHECK (status NOT IN ('accepted', 'rejected') OR decided_at IS NOT NULL)
);
CREATE INDEX idx_crm_proposals_org ON crm_proposals(organization_id, updated_at DESC);
CREATE INDEX idx_crm_proposals_opp ON crm_proposals(opportunity_id, updated_at DESC);

CREATE TABLE crm_proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES crm_proposals(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents BETWEEN 0 AND 9999999999),
  discount_cents INTEGER NOT NULL CHECK (discount_cents BETWEEN 0 AND 9999999999),
  tax_cents INTEGER NOT NULL CHECK (tax_cents BETWEEN 0 AND 9999999999),
  total_cents INTEGER NOT NULL CHECK (total_cents BETWEEN 0 AND 9999999999),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, version_number)
);
CREATE INDEX idx_crm_proposal_versions ON crm_proposal_versions(proposal_id, version_number DESC);

CREATE TABLE crm_proposal_version_items (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES crm_proposal_versions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  catalog_item_id TEXT REFERENCES crm_proposal_catalog(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'service', 'custom')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  description TEXT NOT NULL DEFAULT '',
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 999999999),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents BETWEEN 0 AND 9999999999),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  tax_bps INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents BETWEEN 0 AND 9999999999),
  discount_cents INTEGER NOT NULL CHECK (discount_cents BETWEEN 0 AND 9999999999),
  tax_cents INTEGER NOT NULL CHECK (tax_cents BETWEEN 0 AND 9999999999),
  total_cents INTEGER NOT NULL CHECK (total_cents BETWEEN 0 AND 9999999999),
  UNIQUE (version_id, position)
);

CREATE TABLE crm_proposal_events (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES crm_proposals(id) ON DELETE RESTRICT,
  version_id TEXT REFERENCES crm_proposal_versions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'versioned', 'duplicated', 'marked_sent', 'accepted', 'rejected', 'expired', 'changes_requested')),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_crm_proposal_events ON crm_proposal_events(proposal_id, occurred_at DESC);

ALTER TABLE crm_tasks ADD COLUMN cancelled_at TEXT;
ALTER TABLE crm_tasks ADD COLUMN cancelled_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT;
ALTER TABLE crm_tasks ADD COLUMN cancel_reason TEXT;
CREATE TABLE crm_proposal_followups (
  version_id TEXT PRIMARY KEY REFERENCES crm_proposal_versions(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL UNIQUE REFERENCES crm_tasks(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE crm_gmail_connections (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  scope TEXT NOT NULL,
  label_id TEXT NOT NULL,
  history_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE crm_gmail_threads (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES crm_gmail_connections(id) ON DELETE RESTRICT,
  gmail_thread_id TEXT NOT NULL,
  organization_id TEXT REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  contact_id TEXT,
  proposal_id TEXT REFERENCES crm_proposals(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL DEFAULT '',
  association_status TEXT NOT NULL CHECK (association_status IN ('unmatched', 'matched', 'ambiguous')),
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (connection_id, gmail_thread_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_gmail_threads_org ON crm_gmail_threads(organization_id, last_message_at DESC);
CREATE TABLE crm_gmail_messages (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES crm_gmail_connections(id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL REFERENCES crm_gmail_threads(id) ON DELETE RESTRICT,
  gmail_message_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_emails TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  snippet TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (connection_id, gmail_message_id)
);
CREATE INDEX idx_crm_gmail_messages_thread ON crm_gmail_messages(thread_id, received_at DESC);
CREATE TABLE crm_gmail_drafts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  thread_id TEXT REFERENCES crm_gmail_threads(id) ON DELETE RESTRICT,
  proposal_id TEXT REFERENCES crm_proposals(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'approved', 'archived')),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_crm_gmail_drafts_org ON crm_gmail_drafts(organization_id, updated_at DESC);
CREATE TABLE crm_gmail_sync_incidents (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES crm_gmail_connections(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  occurred_at TEXT NOT NULL,
  resolved_at TEXT
);
