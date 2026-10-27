-- Public meeting booking. Independent of the retired private-panel tables.
CREATE TABLE meeting_bookings (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  access_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  business TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  privacy_at TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  blocked_until TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelling','failed')),
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_attempted INTEGER NOT NULL DEFAULT 0 CHECK(event_attempted IN (0,1)),
  meet_status TEXT NOT NULL DEFAULT 'pending' CHECK(meet_status IN ('pending','ready','failed')),
  meet_url TEXT,
  deadline_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT,
  telegram_status TEXT NOT NULL DEFAULT 'pending' CHECK(telegram_status IN ('pending','sending','sent','uncertain')),
  telegram_attempts INTEGER NOT NULL DEFAULT 0,
  telegram_message_id INTEGER,
  telegram_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(starts_at < ends_at AND ends_at <= blocked_until),
  CHECK(status != 'confirmed' OR (meet_status = 'ready' AND meet_url IS NOT NULL))
);
CREATE INDEX idx_meeting_active ON meeting_bookings(starts_at,blocked_until) WHERE status != 'failed';
CREATE INDEX idx_meeting_recovery ON meeting_bookings(next_attempt_at,lease_until,status);
-- SQLite serializes writes; overlapping inserts cannot both commit, including buffers.
CREATE TRIGGER meeting_no_overlap_insert BEFORE INSERT ON meeting_bookings
WHEN NEW.status != 'failed' AND EXISTS (
  SELECT 1 FROM meeting_bookings WHERE status != 'failed'
  AND starts_at < NEW.blocked_until AND blocked_until > NEW.starts_at
)
BEGIN SELECT RAISE(ABORT,'meeting_slot_conflict'); END;
CREATE TRIGGER meeting_no_overlap_update BEFORE UPDATE OF status,starts_at,blocked_until ON meeting_bookings
WHEN NEW.status != 'failed' AND EXISTS (
  SELECT 1 FROM meeting_bookings WHERE id != NEW.id AND status != 'failed'
  AND starts_at < NEW.blocked_until AND blocked_until > NEW.starts_at
)
BEGIN SELECT RAISE(ABORT,'meeting_slot_conflict'); END;
CREATE TABLE meeting_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK(hits > 0),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_meeting_rate_expiry ON meeting_rate_limits(expires_at);
