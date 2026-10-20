-- Phase 5, TEST only. No public domain or production activation.
CREATE TABLE cards_redirect_domains (
  order_id TEXT NOT NULL REFERENCES cards_production_jobs(order_id) ON DELETE RESTRICT,
  hostname TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  approved_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (order_id, hostname)
);

CREATE TABLE cards_destination_targets (
  destination_ref_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  url TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (destination_ref_id, order_id) REFERENCES cards_destination_refs(id,order_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, hostname) REFERENCES cards_redirect_domains(order_id,hostname) ON DELETE RESTRICT
);

CREATE TABLE cards_destination_history (
  id TEXT PRIMARY KEY,
  destination_ref_id TEXT NOT NULL REFERENCES cards_destination_targets(destination_ref_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','change','revert')),
  previous_url TEXT,
  next_url TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  UNIQUE (destination_ref_id, revision)
);

CREATE TABLE cards_dynamic_links (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  destination_ref_id TEXT NOT NULL,
  unit_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('qr','nfc')),
  public_code TEXT NOT NULL UNIQUE CHECK (length(public_code) = 32),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  campaign TEXT CHECK (campaign IS NULL OR length(campaign) BETWEEN 1 AND 80),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id,order_id) REFERENCES cards_batches(id,order_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_ref_id,order_id) REFERENCES cards_destination_refs(id,order_id) ON DELETE RESTRICT,
  FOREIGN KEY (unit_id) REFERENCES cards_units(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_cards_links_shared ON cards_dynamic_links(destination_ref_id,channel) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX idx_cards_links_unit ON cards_dynamic_links(unit_id,channel) WHERE unit_id IS NOT NULL;
CREATE INDEX idx_cards_links_order ON cards_dynamic_links(order_id,batch_id,status);

CREATE TABLE cards_link_status_history (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  UNIQUE (link_id,revision)
);

CREATE TABLE cards_link_generation_requests (
  idempotency_key TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES cards_batches(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

-- No IP, user agent, cookie, fingerprint, contact, or full request URL is retained.
CREATE TABLE cards_open_events (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  traffic_class TEXT NOT NULL CHECK (traffic_class IN ('unclassified','suspected_bot'))
);
CREATE INDEX idx_cards_open_day ON cards_open_events(day_utc,link_id);
CREATE TABLE cards_link_daily_metrics (
  link_id TEXT NOT NULL REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  day_utc TEXT NOT NULL,
  traffic_class TEXT NOT NULL CHECK (traffic_class IN ('unclassified','suspected_bot')),
  openings INTEGER NOT NULL CHECK (openings >= 0),
  PRIMARY KEY (link_id,day_utc,traffic_class)
);
CREATE TABLE cards_link_retention (
  id TEXT PRIMARY KEY CHECK (id='test'),
  raw_days INTEGER NOT NULL CHECK (raw_days BETWEEN 1 AND 90),
  aggregate_days INTEGER NOT NULL CHECK (aggregate_days BETWEEN 31 AND 730)
);
INSERT INTO cards_link_retention(id,raw_days,aggregate_days) VALUES ('test',30,400);

CREATE TRIGGER cards_target_history_guard BEFORE UPDATE ON cards_destination_targets
WHEN NEW.url != OLD.url OR NEW.hostname != OLD.hostname
BEGIN
  SELECT CASE WHEN NEW.revision != OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM cards_destination_history h WHERE h.destination_ref_id=OLD.destination_ref_id
      AND h.revision=NEW.revision AND h.previous_url=OLD.url AND h.next_url=NEW.url
      AND h.actor_user_id=NEW.updated_by AND h.occurred_at=NEW.updated_at)
    THEN RAISE(ABORT,'cards_target_history_required') END;
END;
CREATE TRIGGER cards_target_no_delete BEFORE DELETE ON cards_destination_targets
BEGIN SELECT RAISE(ABORT,'cards_target_no_delete'); END;
CREATE TRIGGER cards_destination_history_no_update BEFORE UPDATE ON cards_destination_history
BEGIN SELECT RAISE(ABORT,'cards_history_immutable'); END;
CREATE TRIGGER cards_destination_history_no_delete BEFORE DELETE ON cards_destination_history
BEGIN SELECT RAISE(ABORT,'cards_history_immutable'); END;
CREATE TRIGGER cards_links_no_delete BEFORE DELETE ON cards_dynamic_links
BEGIN SELECT RAISE(ABORT,'cards_link_no_delete'); END;
CREATE TRIGGER cards_links_association_guard BEFORE INSERT ON cards_dynamic_links
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cards_batches b JOIN cards_units u ON u.batch_id=b.id
    WHERE b.id=NEW.batch_id AND b.order_id=NEW.order_id AND u.destination_ref_id=NEW.destination_ref_id
      AND ((b.mode='shared_batch' AND NEW.unit_id IS NULL) OR
        (b.mode!='shared_batch' AND u.id=NEW.unit_id))
  ) THEN RAISE(ABORT,'cards_link_association_invalid') END;
END;
CREATE TRIGGER cards_links_identity_guard BEFORE UPDATE ON cards_dynamic_links
WHEN NEW.public_code!=OLD.public_code OR NEW.order_id!=OLD.order_id OR NEW.batch_id!=OLD.batch_id
  OR NEW.destination_ref_id!=OLD.destination_ref_id OR NEW.unit_id IS NOT OLD.unit_id OR NEW.channel!=OLD.channel
BEGIN SELECT RAISE(ABORT,'cards_link_identity_immutable'); END;
CREATE TRIGGER cards_links_status_guard BEFORE UPDATE ON cards_dynamic_links
WHEN NEW.status!=OLD.status
BEGIN
  SELECT CASE WHEN OLD.status='retired' OR NEW.revision!=OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM cards_link_status_history h WHERE h.link_id=OLD.id AND h.revision=NEW.revision
      AND h.previous_status=OLD.status AND h.next_status=NEW.status)
    THEN RAISE(ABORT,'cards_link_status_history_required') END;
END;
CREATE TRIGGER cards_link_history_no_update BEFORE UPDATE ON cards_link_status_history
BEGIN SELECT RAISE(ABORT,'cards_history_immutable'); END;
CREATE TRIGGER cards_link_history_no_delete BEFORE DELETE ON cards_link_status_history
BEGIN SELECT RAISE(ABORT,'cards_history_immutable'); END;
CREATE TRIGGER cards_open_rollup AFTER INSERT ON cards_open_events
BEGIN
  INSERT INTO cards_link_daily_metrics(link_id,day_utc,traffic_class,openings)
  VALUES (NEW.link_id,NEW.day_utc,NEW.traffic_class,1)
  ON CONFLICT(link_id,day_utc,traffic_class) DO UPDATE SET openings=openings+1;
END;
CREATE TRIGGER cards_ready_links_guard BEFORE UPDATE OF stage ON cards_production_jobs
WHEN NEW.stage='ready_to_ship'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM cards_units u JOIN cards_batches b ON b.id=u.batch_id
    WHERE u.order_id=NEW.order_id AND EXISTS (
      SELECT 1 FROM (SELECT 'qr' AS channel UNION ALL SELECT 'nfc') ch
      WHERE NOT EXISTS (
        SELECT 1 FROM cards_dynamic_links l
        JOIN cards_destination_targets t ON t.destination_ref_id=l.destination_ref_id
        JOIN cards_redirect_domains d ON d.order_id=t.order_id AND d.hostname=t.hostname
        WHERE l.batch_id=u.batch_id AND l.destination_ref_id=u.destination_ref_id
          AND l.channel=ch.channel AND l.status='active' AND d.active=1
          AND (l.unit_id=u.id OR (b.mode='shared_batch' AND l.unit_id IS NULL))
      )
    )) THEN RAISE(ABORT,'cards_links_required') END;
END;
