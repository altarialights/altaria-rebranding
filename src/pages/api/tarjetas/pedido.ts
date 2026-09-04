import type { APIRoute } from 'astro';
import { hasTursoConfiguration } from '../../../lib/db/client';
import { findPublicCardOrderByCheckoutSession } from '../../../lib/db/card-orders.repository';
import { jsonResponse } from '../../../lib/orders/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const sessionId = new URL(request.url).searchParams.get('session_id')?.trim() ?? '';
  if (!/^cs_test_[A-Za-z0-9_]+$/u.test(sessionId)) {
    return jsonResponse({ error: 'La referencia de pago no es válida.' }, 400);
  }
  if (!hasTursoConfiguration()) return jsonResponse({ error: 'No podemos consultar el pedido ahora mismo.' }, 503);

  try {
    const pedido = await findPublicCardOrderByCheckoutSession(sessionId);
    if (!pedido) return jsonResponse({ error: 'No encontramos este pedido.' }, 404);
    return jsonResponse({ pedido });
  } catch {
    console.error('[orders] Error al consultar el estado del pedido.');
    return jsonResponse({ error: 'No podemos consultar el pedido ahora mismo.' }, 500);
  }
};
