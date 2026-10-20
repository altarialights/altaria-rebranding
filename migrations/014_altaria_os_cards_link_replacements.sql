-- Phase 5 follow-up, TEST only. Retired codes remain dead; a replacement gets a new code.
DROP INDEX idx_cards_links_shared;
DROP INDEX idx_cards_links_unit;
CREATE UNIQUE INDEX idx_cards_links_shared ON cards_dynamic_links(destination_ref_id,channel)
  WHERE unit_id IS NULL AND status!='retired';
CREATE UNIQUE INDEX idx_cards_links_unit ON cards_dynamic_links(unit_id,channel)
  WHERE unit_id IS NOT NULL AND status!='retired';

CREATE TABLE cards_link_replacements (
  old_link_id TEXT PRIMARY KEY REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  new_link_id TEXT NOT NULL UNIQUE REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES altaria_admin_users(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL
);
CREATE TRIGGER cards_link_replacements_no_update BEFORE UPDATE ON cards_link_replacements
BEGIN SELECT RAISE(ABORT,'cards_replacement_immutable'); END;
CREATE TRIGGER cards_link_replacements_no_delete BEFORE DELETE ON cards_link_replacements
BEGIN SELECT RAISE(ABORT,'cards_replacement_immutable'); END;
