-- Phase 4 hardening. Production requires the payment event written by the
-- existing Stripe webhook; a manually populated paid timestamp is insufficient.
CREATE TRIGGER cards_jobs_payment_event_insert BEFORE INSERT ON cards_production_jobs
WHEN NOT EXISTS (SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=NEW.order_id
  AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado')
BEGIN SELECT RAISE(ABORT, 'cards_payment_event_required'); END;

CREATE TRIGGER cards_jobs_payment_event_transition BEFORE UPDATE ON cards_production_jobs
WHEN NEW.stage != OLD.stage AND NOT EXISTS (SELECT 1 FROM eventos_pedido e WHERE e.pedido_id=NEW.order_id
  AND e.tipo_evento='pago_confirmado' AND e.estado_nuevo='pagado')
BEGIN SELECT RAISE(ABORT, 'cards_payment_event_required'); END;

CREATE TRIGGER cards_jobs_block_incident_transition BEFORE UPDATE ON cards_production_jobs
WHEN NEW.stage != OLD.stage AND NEW.stage IN ('ready_to_ship','shipped','delivered')
  AND EXISTS (SELECT 1 FROM cards_production_incidents i WHERE i.order_id=NEW.order_id
    AND i.status='open' AND i.severity='blocking')
BEGIN SELECT RAISE(ABORT, 'cards_blocking_incident_open'); END;
