-- Phase 7: private MCP access and review queue, append-only in Turso TEST.
-- No existing identity, approval, commercial or production table is rebuilt.
CREATE TABLE os_mcp_access_grants (
  user_id TEXT PRIMARY KEY REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK(can_read IN (0,1)),
  can_prepare INTEGER NOT NULL DEFAULT 0 CHECK(can_prepare IN (0,1)),
  grant_version INTEGER NOT NULL DEFAULT 1 CHECK(grant_version>=1),
  granted_by TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  granted_at TEXT NOT NULL,
  revoked_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  revoked_at TEXT,
  CHECK(revoked_at IS NULL OR revoked_by IS NOT NULL)
);

CREATE TABLE os_mcp_action_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  tool_key TEXT NOT NULL CHECK(length(tool_key) BETWEEN 3 AND 80),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  resource_type TEXT NOT NULL CHECK(length(resource_type) BETWEEN 3 AND 80),
  resource_id TEXT NOT NULL CHECK(length(resource_id) BETWEEN 3 AND 100),
  resource_version TEXT NOT NULL CHECK(length(resource_version) BETWEEN 1 AND 120),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','approved','rejected','expired','executing','executed','failed')),
  reviewed_by TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  executed_at TEXT,
  execution_key TEXT UNIQUE,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  UNIQUE(requester_user_id,tool_key,idempotency_key),
  CHECK(expires_at>requested_at)
);
CREATE INDEX idx_os_mcp_action_queue ON os_mcp_action_requests(status,expires_at,requested_at DESC);
CREATE INDEX idx_os_mcp_action_actor ON os_mcp_action_requests(requester_user_id,requested_at DESC);

CREATE TABLE os_mcp_action_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES os_mcp_action_requests(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN
    ('requested','approved','rejected','expired','executed','failed')),
  actor_user_id TEXT REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  result_code TEXT
);
CREATE INDEX idx_os_mcp_action_events ON os_mcp_action_events(request_id,occurred_at);
CREATE TRIGGER os_mcp_action_events_no_update BEFORE UPDATE ON os_mcp_action_events
BEGIN SELECT RAISE(ABORT,'os_mcp_action_event_immutable'); END;
CREATE TRIGGER os_mcp_action_events_no_delete BEFORE DELETE ON os_mcp_action_events
BEGIN SELECT RAISE(ABORT,'os_mcp_action_event_immutable'); END;

CREATE TABLE os_mcp_rate_windows (
  user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  window_start TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('read','prepare')),
  call_count INTEGER NOT NULL CHECK(call_count BETWEEN 1 AND 1000),
  PRIMARY KEY(user_id,window_start,kind)
);
