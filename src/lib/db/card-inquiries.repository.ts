import { getDatabase } from './client';
import type { CardInquiry } from '../contact/cards-inquiry';
import { assertUnboundArtwork, findCardArtwork } from './card-artwork.repository';

export class InquiryConflictError extends Error {}

export const saveCardInquiry = async (input: CardInquiry, ownerHash = ''): Promise<string> => {
  const { claveIdempotencia, startedAt: _startedAt, website: _website, ...details } = input;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(details)));
  const fingerprint = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const database = getDatabase();
  const now = new Date().toISOString();
  const artwork = input.configuracion?.tarjeta?.artworkFile;
  const configuration = structuredClone(input.configuracion ?? {});
  if (artwork) {
    const file = await findCardArtwork(artwork.token,ownerHash);
    if (!file) throw new InquiryConflictError();
    Object.assign(configuration.tarjeta!.artworkFile!, {filename:file.filename,width:file.width,height:file.height,status:file.status,warnings:file.warnings,layout:file.layout});
  }
  const inquiryId = crypto.randomUUID();
  await database.transactionAsync(async tx => {
  const prior = await tx.get('SELECT id, huella_solicitud FROM consultas_tarjetas WHERE clave_idempotencia = ?',claveIdempotencia);
  if (prior) { if (prior.huella_solicitud !== fingerprint) throw new InquiryConflictError(); return; }
  if (artwork) await assertUnboundArtwork(tx,artwork.token,ownerHash);
  await tx.run(
    `INSERT INTO consultas_tarjetas (
      id, clave_idempotencia, huella_solicitud, producto_id, nombre, contacto,
      negocio, cantidad, idea, configuracion_json, privacidad_aceptada_en, creado_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clave_idempotencia) DO NOTHING`,
    inquiryId, claveIdempotencia, fingerprint, input.productoId,
    input.nombre, input.contacto, input.negocio || null, input.cantidad ?? null,
    input.idea, JSON.stringify(configuration), now, now,
  );
  if (artwork) await tx.run('UPDATE card_artwork SET inquiry_id = ? WHERE token = ? AND owner_hash = ?',inquiryId,artwork.token,ownerHash);
  }).immediate();
  const row = await database.get(
    'SELECT id, huella_solicitud FROM consultas_tarjetas WHERE clave_idempotencia = ?', claveIdempotencia,
  ) as { id: string; huella_solicitud: string } | undefined;
  if (!row) throw new Error('No se pudo recuperar la consulta.');
  if (row.huella_solicitud !== fingerprint) throw new InquiryConflictError();
  return row.id;
};
