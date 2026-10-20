-- Phase 6, isolated TEST. No production or external notification configuration.
CREATE TABLE os_rule_config (
  rule_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  local_time TEXT CHECK (local_time IS NULL OR local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT
);
INSERT INTO os_rule_config(rule_key,enabled,local_time,updated_at) VALUES
  ('lead.review',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('call.next',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('opportunity.won',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('opportunity.lost',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('proposal.sent',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('proposal.responded',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('proposal.expired',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('cards.paid',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('cards.incident',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('cards.link.alert',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('cards.delivered',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('daily.brief',1,NULL,'2026-10-12T00:00:00.000Z'),
  ('telegram.simulated',1,NULL,'2026-10-12T00:00:00.000Z');

CREATE TABLE os_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 80),
  source_type TEXT NOT NULL CHECK (length(source_type) BETWEEN 3 AND 40),
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);
CREATE INDEX idx_os_outbox_pending ON os_outbox(dispatched_at,created_at);

CREATE TABLE os_jobs (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL REFERENCES os_rule_config(rule_key) ON DELETE RESTRICT,
  event_id TEXT REFERENCES os_outbox(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','done','dead')),
  run_at TEXT NOT NULL,
  lease_token TEXT,
  leased_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status='leased') = (lease_token IS NOT NULL AND leased_until IS NOT NULL))
);
CREATE INDEX idx_os_jobs_due ON os_jobs(status,run_at,leased_until);
CREATE INDEX idx_os_jobs_rule ON os_jobs(rule_key,created_at DESC);

CREATE TABLE os_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES os_jobs(id) ON DELETE RESTRICT,
  lease_token TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','retry','dead')),
  error_code TEXT
);
CREATE INDEX idx_os_attempts_job ON os_job_attempts(job_id,started_at DESC);
CREATE TRIGGER os_attempts_no_update BEFORE UPDATE ON os_job_attempts
BEGIN SELECT RAISE(ABORT,'os_attempt_immutable'); END;
CREATE TRIGGER os_attempts_no_delete BEFORE DELETE ON os_job_attempts
BEGIN SELECT RAISE(ABORT,'os_attempt_immutable'); END;

CREATE TABLE os_work_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('review','next_action','opportunity','proposal','cards','incident','link_alert','aftersales')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 200),
  priority TEXT NOT NULL CHECK (priority IN ('normal','high','urgent')),
  organization_id TEXT REFERENCES crm_organizations(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  assigned_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  due_at TEXT,
  created_at TEXT NOT NULL,
  completed_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  completed_at TEXT,
  cancel_reason TEXT,
  CHECK ((status='done')=(completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX idx_os_work_open ON os_work_items(status,priority,due_at,created_at);
CREATE INDEX idx_os_work_org ON os_work_items(organization_id,status);
CREATE INDEX idx_os_work_order ON os_work_items(order_id,status);

ALTER TABLE crm_tasks ADD COLUMN automation_key TEXT;
CREATE UNIQUE INDEX idx_crm_task_automation_key ON crm_tasks(automation_key)
  WHERE automation_key IS NOT NULL;

CREATE TABLE os_notifications (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel='telegram_simulated'),
  template_key TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('urgent','important','informational')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','delivered','dead')),
  run_at TEXT NOT NULL,
  lease_token TEXT,
  leased_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error_code TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((status='leased')=(lease_token IS NOT NULL AND leased_until IS NOT NULL))
);
CREATE INDEX idx_os_notifications_due ON os_notifications(status,run_at,leased_until);
CREATE TABLE os_notification_attempts (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES os_notifications(id) ON DELETE RESTRICT,
  lease_token TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('delivered','retry','dead')),
  error_code TEXT
);
CREATE INDEX idx_os_notification_attempts ON os_notification_attempts(notification_id,occurred_at DESC);
CREATE TRIGGER os_notification_attempts_no_update BEFORE UPDATE ON os_notification_attempts
BEGIN SELECT RAISE(ABORT,'os_notification_attempt_immutable'); END;
CREATE TRIGGER os_notification_attempts_no_delete BEFORE DELETE ON os_notification_attempts
BEGIN SELECT RAISE(ABORT,'os_notification_attempt_immutable'); END;

CREATE TABLE os_daily_briefs (
  day_madrid TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  generated_at TEXT NOT NULL,
  telegram_notification_id TEXT REFERENCES os_notifications(id) ON DELETE RESTRICT
);

CREATE TABLE os_approvals (
  id TEXT PRIMARY KEY,
  action_key TEXT NOT NULL CHECK (action_key IN ('work_item.complete')),
  resource_type TEXT NOT NULL CHECK (resource_type='work_item'),
  resource_id TEXT NOT NULL REFERENCES os_work_items(id) ON DELETE RESTRICT,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256)=64),
  resource_version TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','executing','executed','failed')),
  reviewed_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  executed_at TEXT,
  execution_key TEXT UNIQUE,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  CHECK (expires_at>requested_at)
);
CREATE INDEX idx_os_approvals_status ON os_approvals(status,expires_at);
CREATE TABLE os_approval_events (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES os_approvals(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('requested','approved','rejected','expired','executed','failed')),
  actor_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  result_code TEXT
);
CREATE INDEX idx_os_approval_events ON os_approval_events(approval_id,occurred_at);
CREATE TRIGGER os_approval_events_no_update BEFORE UPDATE ON os_approval_events
BEGIN SELECT RAISE(ABORT,'os_approval_event_immutable'); END;
CREATE TRIGGER os_approval_events_no_delete BEFORE DELETE ON os_approval_events
BEGIN SELECT RAISE(ABORT,'os_approval_event_immutable'); END;

-- Source writes and outbox inserts commit or roll back together. Payloads contain
-- IDs and state only; no contact details, message bodies, artwork, or payment data.
CREATE TRIGGER os_lead_link_outbox AFTER INSERT ON crm_source_links
WHEN NEW.digital_lead_id IS NOT NULL
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'lead.review','crm_source_link',NEW.id,
    'lead.review:'||NEW.id,json_object('organizationId',NEW.organization_id),NEW.linked_at);
END;
CREATE TRIGGER os_call_outbox AFTER INSERT ON crm_activities WHEN NEW.kind='call'
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'call.next','crm_activity',NEW.id,
    'call.next:'||NEW.id,json_object('organizationId',NEW.organization_id),NEW.created_at);
END;
CREATE TRIGGER os_opportunity_outbox AFTER INSERT ON crm_opportunity_stage_events
WHEN NEW.to_stage IN ('won','lost')
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'opportunity.'||NEW.to_stage,'crm_opportunity',NEW.opportunity_id,
    'opportunity.'||NEW.to_stage||':'||NEW.id,
    json_object('stageVersion',NEW.opportunity_version),NEW.occurred_at);
END;
CREATE TRIGGER os_proposal_outbox AFTER INSERT ON crm_proposal_events
WHEN NEW.kind IN ('marked_sent','accepted','rejected','changes_requested','expired')
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),
    CASE WHEN NEW.kind='marked_sent' THEN 'proposal.sent'
      WHEN NEW.kind='expired' THEN 'proposal.expired' ELSE 'proposal.responded' END,
    'crm_proposal',NEW.proposal_id,'proposal.'||NEW.kind||':'||NEW.id,
    json_object('eventKind',NEW.kind,'versionId',NEW.version_id),NEW.occurred_at);
END;
CREATE TRIGGER os_card_paid_outbox AFTER INSERT ON eventos_pedido
WHEN NEW.tipo_evento='pago_confirmado' AND NEW.estado_nuevo='pagado'
  AND EXISTS(SELECT 1 FROM pedidos_tarjetas p WHERE p.id=NEW.pedido_id
    AND p.stripe_entorno='test' AND p.pagado_en IS NOT NULL)
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'cards.paid','card_order',NEW.pedido_id,
    'cards.paid:'||NEW.id,'{}',NEW.creado_en);
END;
CREATE TRIGGER os_card_incident_outbox AFTER INSERT ON cards_production_incidents
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'cards.incident','card_incident',NEW.id,
    'cards.incident:'||NEW.id,json_object('severity',NEW.severity),NEW.created_at);
END;
CREATE TRIGGER os_link_alert_outbox AFTER INSERT ON cards_link_status_history
WHEN NEW.next_status IN ('paused','retired')
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'cards.link.alert','card_link',NEW.link_id,
    'cards.link.alert:'||NEW.id,json_object('status',NEW.next_status),NEW.occurred_at);
END;
CREATE TRIGGER os_card_delivered_outbox AFTER INSERT ON cards_production_events
WHEN NEW.kind='stage_changed' AND NEW.to_stage='delivered'
BEGIN
  INSERT INTO os_outbox(id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
  VALUES(lower(hex(randomblob(16))),'cards.delivered','card_order',NEW.order_id,
    'cards.delivered:'||NEW.id,'{}',NEW.occurred_at);
END;
