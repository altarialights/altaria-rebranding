import { randomBytes, createHash } from 'node:crypto';
import { getDatabase } from './client';
import type { Transaction } from '@tursodatabase/serverless';
import type { CardArtwork } from '../orders/artwork';
import type { validateArtwork } from '../orders/artwork-validation';
type Validation = Awaited<ReturnType<typeof validateArtwork>>;
export async function saveCardArtwork(bytes: Uint8Array, validation: Validation, name: string, ownerHash: string): Promise<CardArtwork> {
  if (!ownerHash) throw new Error('Sesión de diseño requerida.');
  const token = randomBytes(32).toString('hex');
  const filename = name.slice(0,255) || 'diseno';
  await getDatabase().run('INSERT INTO card_artwork (token, owner_hash, filename, mime_type, size_bytes, width, height, validation_status, warnings_json, layout_json, sha256, content_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    token, ownerHash, filename, validation.mime, bytes.length, validation.width, validation.height, validation.status, JSON.stringify(validation.warnings), JSON.stringify(validation.layout), createHash('sha256').update(bytes).digest('hex'), Buffer.from(bytes).toString('base64'), new Date().toISOString());
  return { token, filename, width:validation.width,height:validation.height,status:validation.status,warnings:validation.warnings,layout:validation.layout };
}
export async function findCardArtwork(token: string, ownerHash = '') {
  if (!/^[a-f0-9]{64}$/.test(token) || !ownerHash) return null;
  const row = await getDatabase().get('SELECT * FROM card_artwork WHERE token = ? AND owner_hash = ?', token, ownerHash);
  return row ? { filename: String(row.filename), mime: String(row.mime_type), bytes: Buffer.from(String(row.content_base64), 'base64'),
    width:Number(row.width),height:Number(row.height),status:row.validation_status as 'ready'|'review',warnings:JSON.parse(String(row.warnings_json)) as string[],
    layout:JSON.parse(String(row.layout_json)), orderId:row.order_id as string|null, inquiryId:row.inquiry_id as string|null } : null;
}
export async function assertUnboundArtwork(tx: Transaction, token: string, ownerHash: string) {
  const file = await tx.get('SELECT token FROM card_artwork WHERE token = ? AND owner_hash = ? AND order_id IS NULL AND inquiry_id IS NULL',token,ownerHash);
  if (!file) throw new Error('El diseño no pertenece a esta sesión o ya está asociado a una solicitud.');
}
export async function removeCardArtwork(token: string, ownerHash: string) {
  if (!ownerHash || !/^[a-f0-9]{64}$/.test(token)) return false;
  const operation = getDatabase().transactionAsync(async tx => {
    const row = await tx.get('SELECT token FROM card_artwork WHERE token = ? AND owner_hash = ? AND order_id IS NULL AND inquiry_id IS NULL',token,ownerHash);
    if (!row) return false;
    await tx.run('DELETE FROM card_artwork WHERE token = ? AND owner_hash = ?',token,ownerHash); return true;
  });
  return operation.immediate();
}

// Internal notification use only. Never expose this lookup through a public endpoint.
export async function findPaidOrderArtwork(orderId: string) {
  const row = await getDatabase().get(`SELECT a.* FROM card_artwork a
    JOIN pedidos_tarjetas p ON p.id = a.order_id
    WHERE a.order_id = ? AND p.pagado_en IS NOT NULL`, orderId);
  if (!row) return null;
  const bytes = Buffer.from(String(row.content_base64), 'base64');
  if (bytes.length !== Number(row.size_bytes) || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
    throw new Error('Artwork integrity check failed');
  return {bytes,filename:String(row.filename),mime:String(row.mime_type),status:String(row.validation_status)};
}
