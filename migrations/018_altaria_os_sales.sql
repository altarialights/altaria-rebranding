-- Sales OS is an extension of the existing CRM. No message transport is added.
CREATE TABLE crm_sales_entries (
  id TEXT PRIMARY KEY,
  seed_key TEXT UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  category TEXT NOT NULL CHECK(category IN ('prospecting','email','call','in_person','diagnosis','demo','objection','followup','closing','upsell','aftersales')),
  product TEXT NOT NULL CHECK(length(product) BETWEEN 2 AND 100),
  sector TEXT NOT NULL DEFAULT 'general' CHECK(length(sector) BETWEEN 2 AND 100),
  channel TEXT NOT NULL CHECK(channel IN ('general','email','phone','in_person')),
  stage TEXT NOT NULL CHECK(stage IN ('new','contacted','interested','proposal','negotiation','won','lost','general')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','retired')),
  latest_version INTEGER NOT NULL DEFAULT 1 CHECK(latest_version >= 1),
  approved_version INTEGER CHECK(approved_version IS NULL OR approved_version BETWEEN 1 AND latest_version),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_crm_sales_filter ON crm_sales_entries(status,category,sector,product,channel,stage);

CREATE TABLE crm_sales_entry_versions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES crm_sales_entries(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version >= 1),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  category TEXT NOT NULL CHECK(category IN ('prospecting','email','call','in_person','diagnosis','demo','objection','followup','closing','upsell','aftersales')),
  product TEXT NOT NULL CHECK(length(product) BETWEEN 2 AND 100),
  sector TEXT NOT NULL CHECK(length(sector) BETWEEN 2 AND 100),
  channel TEXT NOT NULL CHECK(channel IN ('general','email','phone','in_person')),
  stage TEXT NOT NULL CHECK(stage IN ('new','contacted','interested','proposal','negotiation','won','lost','general')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 10 AND 10000),
  next_step TEXT NOT NULL CHECK(length(next_step) BETWEEN 5 AND 1000),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  provenance TEXT NOT NULL CHECK(provenance IN ('new_proposal','supplied_original','site_reference')),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 3 AND 500),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(entry_id,version), UNIQUE(id,entry_id)
);
CREATE INDEX idx_crm_sales_versions ON crm_sales_entry_versions(entry_id,version DESC);
CREATE TRIGGER crm_sales_versions_no_update BEFORE UPDATE ON crm_sales_entry_versions
BEGIN SELECT RAISE(ABORT,'sales_version_immutable'); END;
CREATE TRIGGER crm_sales_versions_no_delete BEFORE DELETE ON crm_sales_entry_versions
BEGIN SELECT RAISE(ABORT,'sales_version_immutable'); END;

CREATE TABLE crm_sales_entry_events (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES crm_sales_entries(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('created','revised','submitted','approved','retired')),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(entry_id,version) REFERENCES crm_sales_entry_versions(entry_id,version) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_sales_events ON crm_sales_entry_events(entry_id,occurred_at DESC);
CREATE TRIGGER crm_sales_events_no_update BEFORE UPDATE ON crm_sales_entry_events
BEGIN SELECT RAISE(ABORT,'sales_event_immutable'); END;
CREATE TRIGGER crm_sales_events_no_delete BEFORE DELETE ON crm_sales_entry_events
BEGIN SELECT RAISE(ABORT,'sales_event_immutable'); END;

CREATE TABLE crm_sales_draft_sources (
  draft_id TEXT PRIMARY KEY REFERENCES crm_gmail_drafts(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL REFERENCES crm_sales_entries(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  opportunity_id TEXT,
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(version_id,entry_id) REFERENCES crm_sales_entry_versions(id,entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(opportunity_id,organization_id) REFERENCES crm_opportunities(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_sales_draft_org ON crm_sales_draft_sources(organization_id,created_at DESC);

CREATE TABLE crm_contact_channel_reviews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  contact_id TEXT,
  channel TEXT NOT NULL CHECK(channel IN ('email','phone','in_person')),
  decision TEXT NOT NULL CHECK(decision IN ('unknown','eligible','blocked','opposed')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(contact_id,organization_id) REFERENCES crm_contacts(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_crm_channel_reviews ON crm_contact_channel_reviews(organization_id,contact_id,channel,occurred_at DESC);
CREATE TRIGGER crm_channel_reviews_no_update BEFORE UPDATE ON crm_contact_channel_reviews
BEGIN SELECT RAISE(ABORT,'channel_review_immutable'); END;
CREATE TRIGGER crm_channel_reviews_no_delete BEFORE DELETE ON crm_contact_channel_reviews
BEGIN SELECT RAISE(ABORT,'channel_review_immutable'); END;

CREATE TABLE crm_prospect_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  sector TEXT,
  area TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','closed')),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE TABLE crm_prospect_campaign_members (
  campaign_id TEXT NOT NULL REFERENCES crm_prospect_campaigns(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  added_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,organization_id)
);
CREATE TRIGGER crm_prospect_campaign_cap BEFORE INSERT ON crm_prospect_campaign_members
WHEN (SELECT COUNT(*) FROM crm_prospect_campaign_members WHERE campaign_id=NEW.campaign_id) >= 20
BEGIN SELECT RAISE(ABORT,'campaign_limit_20'); END;

INSERT INTO os_rule_config(rule_key,enabled,local_time,updated_at)
VALUES('sales.opportunity.guide',1,NULL,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
SELECT lower(hex(randomblob(16))),'sales.opportunity.guide','crm_opportunity',q.id,
  'sales.opportunity.guide:initial:'||q.id||':'||q.version,
  json_object('stageVersion',q.version),'2026-10-13T00:00:00.000Z'
FROM crm_opportunities q JOIN crm_organizations o ON o.id=q.organization_id
WHERE q.stage NOT IN ('won','lost') AND o.status='active';
CREATE TRIGGER os_sales_opportunity_guide AFTER INSERT ON crm_opportunity_stage_events
WHEN NEW.to_stage NOT IN ('won','lost')
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'sales.opportunity.guide','crm_opportunity',NEW.opportunity_id,
    'sales.opportunity.guide:'||NEW.id,json_object('stageVersion',NEW.opportunity_version),NEW.occurred_at);
END;
