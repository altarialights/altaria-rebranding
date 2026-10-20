-- Phase 4. Production is independent of commercial/payment order state.
-- All records are TEST-only until a separately reviewed production rollout.
CREATE TABLE cards_production_jobs (
  order_id TEXT PRIMARY KEY REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL DEFAULT 'preparation' CHECK (stage IN
    ('preparation','production','verification','ready_to_ship','shipped','delivered')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  carrier TEXT,
  tracking TEXT,
  started_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  shipped_at TEXT,
  delivered_at TEXT,
  CHECK ((stage IN ('shipped','delivered')) = (shipped_at IS NOT NULL)),
  CHECK ((stage = 'delivered') = (delivered_at IS NOT NULL)),
  CHECK (tracking IS NULL OR length(tracking) BETWEEN 3 AND 120),
  CHECK (carrier IS NULL OR length(carrier) BETWEEN 2 AND 100)
);
CREATE INDEX idx_cards_jobs_stage_priority ON cards_production_jobs(stage, priority, updated_at DESC);

CREATE TABLE cards_production_checks (
  order_id TEXT NOT NULL REFERENCES cards_production_jobs(order_id) ON DELETE RESTRICT,
  check_key TEXT NOT NULL CHECK (check_key IN
    ('preparation','artwork_review','print_record','nfc_programmed','qr_verified','nfc_verified','physical_control')),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 500),
  checked_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (order_id, check_key)
);

CREATE TABLE cards_destination_refs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (id, order_id)
);
CREATE INDEX idx_cards_destination_order ON cards_destination_refs(order_id);

CREATE TABLE cards_batches (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES cards_production_jobs(order_id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('shared_batch','individual','identified_shared')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  internal_batch_code TEXT UNIQUE,
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((mode = 'shared_batch') = (internal_batch_code IS NOT NULL)),
  UNIQUE (id, order_id)
);
CREATE INDEX idx_cards_batches_order ON cards_batches(order_id, created_at);

CREATE TABLE cards_units (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 500),
  internal_unit_code TEXT UNIQUE,
  destination_ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id, order_id) REFERENCES cards_batches(id, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_ref_id, order_id) REFERENCES cards_destination_refs(id, order_id) ON DELETE RESTRICT,
  UNIQUE (batch_id, sequence)
);
CREATE INDEX idx_cards_units_order ON cards_units(order_id, batch_id, sequence);

CREATE TABLE cards_production_incidents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES cards_production_jobs(order_id) ON DELETE RESTRICT,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 5 AND 500),
  severity TEXT NOT NULL CHECK (severity IN ('minor','blocking')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  resolved_at TEXT,
  resolution TEXT,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK ((status = 'resolved') = (resolved_by IS NOT NULL)),
  CHECK ((status = 'resolved') = (resolution IS NOT NULL))
);
CREATE INDEX idx_cards_incidents_order ON cards_production_incidents(order_id, status, created_at DESC);

CREATE TABLE cards_production_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN
    ('started','stage_changed','check_recorded','batch_created','incident_opened','incident_resolved','priority_changed','organization_linked')),
  from_stage TEXT,
  to_stage TEXT,
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json))
);
CREATE INDEX idx_cards_events_order ON cards_production_events(order_id, occurred_at DESC);

CREATE TRIGGER cards_jobs_only_paid_test BEFORE INSERT ON cards_production_jobs
WHEN NOT EXISTS (SELECT 1 FROM pedidos_tarjetas p WHERE p.id = NEW.order_id
  AND p.stripe_entorno = 'test' AND p.pagado_en IS NOT NULL AND p.estado IN ('pagado','preparando','enviado','entregado'))
BEGIN SELECT RAISE(ABORT, 'cards_requires_paid_test_order'); END;

CREATE TRIGGER cards_jobs_transition_guard BEFORE UPDATE ON cards_production_jobs
WHEN NEW.stage != OLD.stage
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pedidos_tarjetas p WHERE p.id = NEW.order_id
    AND p.stripe_entorno = 'test' AND p.pagado_en IS NOT NULL AND p.estado IN ('pagado','preparando','enviado','entregado'))
    THEN RAISE(ABORT, 'cards_requires_paid_test_order') END;
  SELECT CASE WHEN NOT (
    (OLD.stage='preparation' AND NEW.stage='production') OR
    (OLD.stage='production' AND NEW.stage='verification') OR
    (OLD.stage='verification' AND NEW.stage='ready_to_ship') OR
    (OLD.stage='ready_to_ship' AND NEW.stage='shipped') OR
    (OLD.stage='shipped' AND NEW.stage='delivered'))
    THEN RAISE(ABORT, 'cards_invalid_transition') END;
  SELECT CASE WHEN NEW.stage='production' AND (
    (SELECT count(*) FROM cards_production_checks c WHERE c.order_id=NEW.order_id
      AND c.check_key IN ('preparation','artwork_review')) != 2 OR
    (SELECT coalesce(sum(b.quantity),0) FROM cards_batches b WHERE b.order_id=NEW.order_id) !=
      (SELECT p.cantidad FROM pedidos_tarjetas p WHERE p.id=NEW.order_id))
    THEN RAISE(ABORT, 'cards_preparation_incomplete') END;
  SELECT CASE WHEN NEW.stage='verification' AND
    (SELECT count(*) FROM cards_production_checks c WHERE c.order_id=NEW.order_id
      AND c.check_key IN ('print_record','nfc_programmed')) != 2
    THEN RAISE(ABORT, 'cards_production_incomplete') END;
  SELECT CASE WHEN NEW.stage='ready_to_ship' AND (
    (SELECT count(*) FROM cards_production_checks c WHERE c.order_id=NEW.order_id
      AND c.check_key IN ('qr_verified','nfc_verified','physical_control')) != 3 OR
    EXISTS (SELECT 1 FROM cards_production_incidents i WHERE i.order_id=NEW.order_id
      AND i.status='open' AND i.severity='blocking'))
    THEN RAISE(ABORT, 'cards_verification_incomplete') END;
  SELECT CASE WHEN NEW.stage='shipped' AND
    (NEW.carrier IS NULL OR NEW.tracking IS NULL OR NEW.shipped_at IS NULL)
    THEN RAISE(ABORT, 'cards_shipment_incomplete') END;
END;

CREATE TRIGGER cards_checks_no_update BEFORE UPDATE ON cards_production_checks
BEGIN SELECT RAISE(ABORT, 'cards_check_immutable'); END;
CREATE TRIGGER cards_checks_no_delete BEFORE DELETE ON cards_production_checks
BEGIN SELECT RAISE(ABORT, 'cards_check_immutable'); END;
CREATE TRIGGER cards_events_no_update BEFORE UPDATE ON cards_production_events
BEGIN SELECT RAISE(ABORT, 'cards_event_immutable'); END;
CREATE TRIGGER cards_events_no_delete BEFORE DELETE ON cards_production_events
BEGIN SELECT RAISE(ABORT, 'cards_event_immutable'); END;
CREATE TRIGGER cards_units_no_update BEFORE UPDATE ON cards_units
BEGIN SELECT RAISE(ABORT, 'cards_unit_immutable'); END;
CREATE TRIGGER cards_units_no_delete BEFORE DELETE ON cards_units
BEGIN SELECT RAISE(ABORT, 'cards_unit_immutable'); END;
CREATE TRIGGER cards_batches_no_update BEFORE UPDATE ON cards_batches
BEGIN SELECT RAISE(ABORT, 'cards_batch_immutable'); END;
CREATE TRIGGER cards_batches_no_delete BEFORE DELETE ON cards_batches
BEGIN SELECT RAISE(ABORT, 'cards_batch_immutable'); END;
