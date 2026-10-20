-- Phase 5 safety follow-up, TEST only. Physical QR/NFC checks require active links.
CREATE TRIGGER cards_checks_links_guard BEFORE INSERT ON cards_production_checks
WHEN NEW.check_key IN ('qr_verified','nfc_verified')
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
    )) THEN RAISE(ABORT,'cards_links_required_before_physical_check') END;
END;
CREATE TRIGGER cards_ship_links_guard BEFORE UPDATE OF stage ON cards_production_jobs
WHEN NEW.stage='shipped'
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
    )) THEN RAISE(ABORT,'cards_links_required_before_shipping') END;
END;
