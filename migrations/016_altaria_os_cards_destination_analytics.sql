-- Phase 5 analytics correction, TEST only. Keep historical destination attribution.
ALTER TABLE cards_open_events ADD COLUMN target_revision INTEGER
  CHECK (target_revision IS NULL OR target_revision >= 1);
CREATE TABLE cards_link_destination_daily_metrics (
  link_id TEXT NOT NULL REFERENCES cards_dynamic_links(id) ON DELETE RESTRICT,
  day_utc TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision >= 1),
  traffic_class TEXT NOT NULL CHECK (traffic_class IN ('unclassified','suspected_bot')),
  openings INTEGER NOT NULL CHECK (openings >= 0),
  PRIMARY KEY (link_id,day_utc,target_revision,traffic_class)
);
CREATE TRIGGER cards_open_revision_guard BEFORE INSERT ON cards_open_events
WHEN NEW.target_revision IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cards_dynamic_links l JOIN cards_destination_history h
    ON h.destination_ref_id=l.destination_ref_id AND h.revision=NEW.target_revision
    WHERE l.id=NEW.link_id)
BEGIN SELECT RAISE(ABORT,'cards_target_revision_unknown'); END;
CREATE TRIGGER cards_open_destination_rollup AFTER INSERT ON cards_open_events
WHEN NEW.target_revision IS NOT NULL
BEGIN
  INSERT INTO cards_link_destination_daily_metrics(link_id,day_utc,target_revision,traffic_class,openings)
  VALUES (NEW.link_id,NEW.day_utc,NEW.target_revision,NEW.traffic_class,1)
  ON CONFLICT(link_id,day_utc,target_revision,traffic_class) DO UPDATE SET openings=openings+1;
END;
