-- Content OS core. Append-only, isolated TEST; no social connections or media bytes.
CREATE TABLE content_brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE content_brand_channels (
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK(channel IN ('instagram','linkedin')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(brand_id,channel)
);
CREATE TABLE content_brand_memberships (
  user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  can_read INTEGER NOT NULL DEFAULT 1 CHECK(can_read IN (0,1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK(can_edit IN (0,1)),
  can_review INTEGER NOT NULL DEFAULT 0 CHECK(can_review IN (0,1)),
  can_record_publication INTEGER NOT NULL DEFAULT 0 CHECK(can_record_publication IN (0,1)),
  can_manage_brand INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_brand IN (0,1)),
  granted_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(user_id,brand_id)
);
CREATE INDEX idx_content_memberships_brand ON content_brand_memberships(brand_id,revoked_at);
CREATE TABLE content_projects (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  review_mode TEXT CHECK(review_mode IS NULL OR review_mode IN ('simple','staged')),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(id,brand_id),
  UNIQUE(brand_id,name)
);
CREATE TABLE content_review_policies (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  project_id TEXT,
  version INTEGER NOT NULL CHECK(version>=1),
  mode TEXT NOT NULL CHECK(mode IN ('simple','staged')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,brand_id) REFERENCES content_projects(id,brand_id) ON DELETE RESTRICT,
  UNIQUE(brand_id,project_id,version)
);
CREATE UNIQUE INDEX idx_content_policy_brand_active ON content_review_policies(brand_id)
  WHERE project_id IS NULL AND active=1;
CREATE UNIQUE INDEX idx_content_policy_project_active ON content_review_policies(project_id)
  WHERE project_id IS NOT NULL AND active=1;
CREATE TABLE content_frequency_targets (
  brand_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'week' CHECK(period IN ('week','month')),
  target_count INTEGER NOT NULL CHECK(target_count BETWEEN 0 AND 100),
  updated_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(brand_id,channel),
  FOREIGN KEY(brand_id,channel) REFERENCES content_brand_channels(brand_id,channel) ON DELETE RESTRICT
);
CREATE TABLE content_pieces (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  format TEXT NOT NULL CHECK(length(format) BETWEEN 2 AND 80),
  stage TEXT NOT NULL DEFAULT 'idea' CHECK(stage IN ('idea','script','visuals','editing','review','ready')),
  publication_state TEXT NOT NULL DEFAULT 'none' CHECK(publication_state IN ('none','scheduled','published','analyzed','archived')),
  on_hold INTEGER NOT NULL DEFAULT 0 CHECK(on_hold IN (0,1)),
  hold_reason TEXT,
  due_at TEXT,
  assigned_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version>=1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(brand_id,channel) REFERENCES content_brand_channels(brand_id,channel) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,brand_id) REFERENCES content_projects(id,brand_id) ON DELETE RESTRICT,
  CHECK((on_hold=1)=(hold_reason IS NOT NULL AND length(trim(hold_reason))>=3)),
  CHECK(publication_state='none' OR stage='ready'),
  UNIQUE(id,brand_id)
);
CREATE INDEX idx_content_pieces_calendar ON content_pieces(brand_id,channel,due_at);
CREATE INDEX idx_content_pieces_stage ON content_pieces(brand_id,stage,publication_state,on_hold);
CREATE INDEX idx_content_pieces_assignee ON content_pieces(assigned_user_id,due_at);
CREATE TABLE content_piece_versions (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES content_pieces(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version>=1),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  objective TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '',
  copy TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  references_text TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  source TEXT NOT NULL DEFAULT 'new_draft' CHECK(source IN ('new_draft','supplied_reference')),
  created_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(piece_id,version)
);
CREATE TRIGGER content_versions_no_update BEFORE UPDATE ON content_piece_versions
BEGIN SELECT RAISE(ABORT,'content_version_immutable'); END;
CREATE TRIGGER content_versions_no_delete BEFORE DELETE ON content_piece_versions
BEGIN SELECT RAISE(ABORT,'content_version_immutable'); END;
CREATE TABLE content_events (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES content_pieces(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 80),
  version INTEGER NOT NULL CHECK(version>=1),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  reason TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_content_events_piece ON content_events(piece_id,occurred_at DESC);
CREATE TRIGGER content_events_no_update BEFORE UPDATE ON content_events
BEGIN SELECT RAISE(ABORT,'content_event_immutable'); END;
CREATE TRIGGER content_events_no_delete BEFORE DELETE ON content_events
BEGIN SELECT RAISE(ABORT,'content_event_immutable'); END;
CREATE TABLE content_comments (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES content_pieces(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 2 AND 4000),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(piece_id,version) REFERENCES content_piece_versions(piece_id,version) ON DELETE RESTRICT
);
CREATE INDEX idx_content_comments_piece ON content_comments(piece_id,created_at DESC);
CREATE TRIGGER content_comments_no_update BEFORE UPDATE ON content_comments
BEGIN SELECT RAISE(ABORT,'content_comment_immutable'); END;
CREATE TRIGGER content_comments_no_delete BEFORE DELETE ON content_comments
BEGIN SELECT RAISE(ABORT,'content_comment_immutable'); END;
CREATE TABLE content_brand_guide_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES content_brands(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version>=1),
  identity_text TEXT NOT NULL DEFAULT '',
  objectives_text TEXT NOT NULL DEFAULT '',
  audience_text TEXT NOT NULL DEFAULT '',
  tone_text TEXT NOT NULL DEFAULT '',
  colors_text TEXT NOT NULL DEFAULT '',
  typography_text TEXT NOT NULL DEFAULT '',
  visual_rules_text TEXT NOT NULL DEFAULT '',
  formats_text TEXT NOT NULL DEFAULT '',
  approved_examples_text TEXT NOT NULL DEFAULT '',
  restrictions_text TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT 'local:editorial',
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved')),
  created_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  approved_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE(brand_id,version),
  CHECK((status='approved')=(approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TRIGGER content_guide_no_update BEFORE UPDATE ON content_brand_guide_versions
BEGIN SELECT RAISE(ABORT,'content_guide_immutable'); END;
CREATE TRIGGER content_guide_no_delete BEFORE DELETE ON content_brand_guide_versions
BEGIN SELECT RAISE(ABORT,'content_guide_immutable'); END;

INSERT INTO content_brands(id,name,status,created_at,updated_at) VALUES
 ('martin-altaria','Martín Altaria','active','2026-10-13T00:00:00.000Z','2026-10-13T00:00:00.000Z'),
 ('altaria-cards','Altaria Cards','active','2026-10-13T00:00:00.000Z','2026-10-13T00:00:00.000Z'),
 ('de-zamorano','Restaurante De Zamorano','planned','2026-10-13T00:00:00.000Z','2026-10-13T00:00:00.000Z');
INSERT INTO content_brand_channels(brand_id,channel,status,created_at) VALUES
 ('martin-altaria','instagram','active','2026-10-13T00:00:00.000Z'),
 ('martin-altaria','linkedin','active','2026-10-13T00:00:00.000Z'),
 ('altaria-cards','instagram','active','2026-10-13T00:00:00.000Z'),
 ('de-zamorano','instagram','planned','2026-10-13T00:00:00.000Z');
INSERT INTO content_review_policies(id,brand_id,project_id,version,mode,active,created_at) VALUES
 ('martin-policy-1','martin-altaria',NULL,1,'simple',1,'2026-10-13T00:00:00.000Z'),
 ('cards-policy-1','altaria-cards',NULL,1,'simple',1,'2026-10-13T00:00:00.000Z'),
 ('zamorano-policy-1','de-zamorano',NULL,1,'simple',1,'2026-10-13T00:00:00.000Z');
