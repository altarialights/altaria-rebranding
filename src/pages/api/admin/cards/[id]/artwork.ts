import type { APIRoute } from 'astro';
import { hasAdminPermission, recordAdminAudit } from '../../../../../lib/admin/access';
import { getCardOrder } from '../../../../../lib/admin/cards/service';
import { findPaidOrderArtwork } from '../../../../../lib/db/card-artwork.repository';
export const prerender = false;

export const GET: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal || !hasAdminPermission(principal, 'cards:artwork')) {
    return Response.json({ error: 'Acceso denegado.' }, { status: 403 });
  }
  const orderId = context.params.id ?? '';
  const detail = await getCardOrder(principal, orderId);
  if (!detail || !detail.order.pagado_en || Number(detail.order.payment_confirmed) !== 1) {
    return new Response('Diseño no encontrado.', { status: 404 });
  }
  const artwork = await findPaidOrderArtwork(orderId);
  if (!artwork) return new Response('Diseño no encontrado.', { status: 404 });
  await recordAdminAudit(principal, 'cards.artwork.download', 'success', 'card_order', orderId);
  const ext = artwork.mime === 'application/pdf' ? 'pdf'
    : artwork.mime === 'image/png' ? 'png' : artwork.mime === 'image/jpeg' ? 'jpg' : 'bin';
  return new Response(new Uint8Array(artwork.bytes), { status: 200, headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="diseno-original.${ext}"`,
    'Content-Length': String(artwork.bytes.length),
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox', 'X-Robots-Tag': 'noindex, nofollow',
  } });
};
