-- Altaria OS Phase 1. Standalone identity tables; no production data dependency.
CREATE TABLE altaria_admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  workos_user_id TEXT UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  CHECK (email = lower(trim(email)) AND length(email) BETWEEN 5 AND 254),
  CHECK (status != 'active' OR workos_user_id IS NOT NULL)
);

CREATE TABLE altaria_admin_roles (
  key TEXT PRIMARY KEY CHECK (key IN ('owner', 'sales', 'production', 'viewer')),
  label TEXT NOT NULL UNIQUE
);

INSERT INTO altaria_admin_roles (key, label) VALUES
  ('owner', 'Propietario'),
  ('sales', 'Comercial'),
  ('production', 'Producción'),
  ('viewer', 'Consulta');

CREATE TABLE altaria_admin_user_roles (
  user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL REFERENCES altaria_admin_roles(key) ON DELETE RESTRICT,
  granted_at TEXT NOT NULL,
  granted_by TEXT REFERENCES altaria_admin_users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_key)
);

CREATE INDEX idx_altaria_admin_user_roles_role ON altaria_admin_user_roles(role_key);

CREATE TABLE altaria_admin_audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE SET NULL,
  actor_session_hash TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 100),
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  details_json TEXT NOT NULL DEFAULT '{}',
  CHECK (json_valid(details_json))
);

CREATE INDEX idx_altaria_admin_audit_occurred ON altaria_admin_audit_events(occurred_at DESC);
CREATE INDEX idx_altaria_admin_audit_actor ON altaria_admin_audit_events(actor_user_id, occurred_at DESC);

CREATE TABLE altaria_admin_revoked_sessions (
  session_hash TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  actor_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE SET NULL
);
