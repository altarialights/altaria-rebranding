-- Content OS resources and workflow. Metadata only; no cloud account or media bytes.
CREATE TABLE content_assets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  asset_class TEXT NOT NULL CHECK(asset_class IN ('original','work','final','reference')),
  environment TEXT NOT NULL CHECK(environment='test'),
  provider TEXT NOT NULL CHECK(provider='mock_local'),
  storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key) BETWEEN 16 AND 200),
  file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 3 AND 100),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 3 AND 500),
  rights_note TEXT NOT NULL CHECK(length(rights_note) BETWEEN 3 AND 500),
  status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('pending','verified','quarantined','deleted')),
  retention_until TEXT,
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(id,brand_id),
  CHECK((status='deleted')=(deleted_at IS NOT NULL))
);
CREATE INDEX idx_content_assets_brand ON content_assets(brand_id,status,created_at DESC);
CREATE TABLE content_piece_assets (
  piece_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  brand_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('original','work','final','reference')),
  added_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL,
  PRIMARY KEY(piece_id,version,asset_id),
  FOREIGN KEY(piece_id,version) REFERENCES content_piece_versions(piece_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(piece_id,brand_id) REFERENCES content_pieces(id,brand_id) ON DELETE RESTRICT,
  FOREIGN KEY(asset_id,brand_id) REFERENCES content_assets(id,brand_id) ON DELETE RESTRICT
);
CREATE TRIGGER content_piece_assets_no_update BEFORE UPDATE ON content_piece_assets
BEGIN SELECT RAISE(ABORT,'content_asset_link_immutable'); END;
CREATE TRIGGER content_piece_assets_no_delete BEFORE DELETE ON content_piece_assets
BEGIN SELECT RAISE(ABORT,'content_asset_link_immutable'); END;
CREATE TABLE content_review_requests (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  review_stage TEXT NOT NULL CHECK(review_stage IN ('script','visuals','final')),
  policy_id TEXT NOT NULL REFERENCES content_review_policies(id) ON DELETE RESTRICT,
  policy_mode TEXT NOT NULL CHECK(policy_mode IN ('simple','staged')),
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
  asset_manifest_sha256 TEXT NOT NULL CHECK(length(asset_manifest_sha256)=64),
  requested_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
  decided_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY(piece_id,version) REFERENCES content_piece_versions(piece_id,version) ON DELETE RESTRICT
);
CREATE INDEX idx_content_reviews_piece ON content_review_requests(piece_id,version,review_stage,status);
CREATE UNIQUE INDEX idx_content_reviews_pending ON content_review_requests(piece_id,review_stage)
  WHERE status='pending';
CREATE TABLE content_review_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES content_review_requests(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT,
  owner_self_override INTEGER NOT NULL DEFAULT 0 CHECK(owner_self_override IN (0,1)),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL,
  CHECK(owner_self_override=0 OR length(trim(reason))>=10)
);
CREATE TRIGGER content_review_decisions_no_update BEFORE UPDATE ON content_review_decisions
BEGIN SELECT RAISE(ABORT,'content_review_decision_immutable'); END;
CREATE TRIGGER content_review_decisions_no_delete BEFORE DELETE ON content_review_decisions
BEGIN SELECT RAISE(ABORT,'content_review_decision_immutable'); END;
CREATE TABLE content_publication_records (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  brand_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  scheduled_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled','confirmed')),
  evidence_url TEXT,
  platform_post_id TEXT,
  evidence_method TEXT CHECK(evidence_method IS NULL OR evidence_method IN ('human_permalink','synthetic_test')),
  evidence_note TEXT,
  verified_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(piece_id,version) REFERENCES content_piece_versions(piece_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(piece_id,brand_id) REFERENCES content_pieces(id,brand_id) ON DELETE RESTRICT,
  FOREIGN KEY(brand_id,channel) REFERENCES content_brand_channels(brand_id,channel) ON DELETE RESTRICT,
  CHECK((status='confirmed')=(confirmed_at IS NOT NULL AND verified_by IS NOT NULL AND evidence_method IS NOT NULL)),
  CHECK(status='confirmed' OR evidence_url IS NULL)
);
CREATE UNIQUE INDEX idx_content_publication_active ON content_publication_records(piece_id)
  WHERE status='scheduled';
CREATE UNIQUE INDEX idx_content_publication_post ON content_publication_records(channel,platform_post_id)
  WHERE platform_post_id IS NOT NULL;
CREATE UNIQUE INDEX idx_content_publication_url ON content_publication_records(channel,evidence_url)
  WHERE evidence_url IS NOT NULL;
CREATE TABLE content_metrics (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES content_publication_records(id) ON DELETE RESTRICT,
  metric_key TEXT NOT NULL CHECK(length(metric_key) BETWEEN 2 AND 80),
  metric_value INTEGER CHECK(metric_value IS NULL OR metric_value>=0),
  unit TEXT NOT NULL CHECK(length(unit) BETWEEN 2 AND 40),
  source TEXT NOT NULL CHECK(source IN ('manual','imported','calculated','unavailable')),
  source_note TEXT NOT NULL CHECK(length(source_note) BETWEEN 3 AND 500),
  observed_at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  CHECK((source='unavailable')=(metric_value IS NULL))
);
CREATE INDEX idx_content_metrics_publication ON content_metrics(publication_id,observed_at DESC);
CREATE TRIGGER content_metrics_no_update BEFORE UPDATE ON content_metrics
BEGIN SELECT RAISE(ABORT,'content_metric_immutable'); END;
CREATE TRIGGER content_metrics_no_delete BEFORE DELETE ON content_metrics
BEGIN SELECT RAISE(ABORT,'content_metric_immutable'); END;
CREATE TABLE content_crm_links (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES content_pieces(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  opportunity_id TEXT,
  link_type TEXT NOT NULL CHECK(link_type IN ('context','source','campaign')),
  linked_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  linked_at TEXT NOT NULL,
  FOREIGN KEY(opportunity_id,organization_id) REFERENCES crm_opportunities(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(piece_id,organization_id,opportunity_id,link_type)
);
CREATE INDEX idx_content_crm_org ON content_crm_links(organization_id,linked_at DESC);
CREATE TABLE content_work_links (
  work_item_id TEXT PRIMARY KEY REFERENCES os_work_items(id) ON DELETE RESTRICT,
  piece_id TEXT NOT NULL REFERENCES content_pieces(id) ON DELETE RESTRICT,
  linked_at TEXT NOT NULL
);
CREATE INDEX idx_content_work_piece ON content_work_links(piece_id);
INSERT INTO os_rule_config(rule_key,enabled,local_time,updated_at) VALUES
 ('content.script_pending',1,NULL,'2026-10-13T00:00:00.000Z'),
 ('content.review_requested',1,NULL,'2026-10-13T00:00:00.000Z'),
 ('content.hold',1,NULL,'2026-10-13T00:00:00.000Z'),
 ('content.due',1,NULL,'2026-10-13T00:00:00.000Z'),
 ('content.ready',1,NULL,'2026-10-13T00:00:00.000Z');
CREATE TRIGGER content_event_outbox AFTER INSERT ON content_events
WHEN NEW.event_type IN ('content.script_pending','content.review_requested','content.hold','content.ready')
BEGIN
  INSERT OR IGNORE INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.event_type,'content_piece',NEW.piece_id,
    NEW.event_type||':'||NEW.piece_id||':'||NEW.version||':'||NEW.id,
    json_object('pieceId',NEW.piece_id,'version',NEW.version),NEW.occurred_at);
END;
