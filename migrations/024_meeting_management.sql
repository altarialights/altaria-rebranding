-- Organizer actions and reconciliation; preserve the original booking and audit timestamps.
ALTER TABLE meeting_bookings ADD COLUMN calendar_url TEXT;
ALTER TABLE meeting_bookings ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE meeting_bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE meeting_bookings ADD COLUMN telegram_edit_pending INTEGER NOT NULL DEFAULT 0 CHECK(telegram_edit_pending IN (0,1));
