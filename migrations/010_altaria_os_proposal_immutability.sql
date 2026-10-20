-- Phase 3 hardening. Every saved proposal version, line and event is append-only.
CREATE TRIGGER crm_proposal_versions_no_update
BEFORE UPDATE ON crm_proposal_versions
BEGIN SELECT RAISE(ABORT, 'proposal_version_immutable'); END;

CREATE TRIGGER crm_proposal_versions_no_delete
BEFORE DELETE ON crm_proposal_versions
BEGIN SELECT RAISE(ABORT, 'proposal_version_immutable'); END;

CREATE TRIGGER crm_proposal_version_items_no_update
BEFORE UPDATE ON crm_proposal_version_items
BEGIN SELECT RAISE(ABORT, 'proposal_item_immutable'); END;

CREATE TRIGGER crm_proposal_version_items_no_delete
BEFORE DELETE ON crm_proposal_version_items
BEGIN SELECT RAISE(ABORT, 'proposal_item_immutable'); END;

CREATE TRIGGER crm_proposal_events_no_update
BEFORE UPDATE ON crm_proposal_events
BEGIN SELECT RAISE(ABORT, 'proposal_event_immutable'); END;

CREATE TRIGGER crm_proposal_events_no_delete
BEFORE DELETE ON crm_proposal_events
BEGIN SELECT RAISE(ABORT, 'proposal_event_immutable'); END;
