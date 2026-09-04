import type { APIRoute } from 'astro';
import { hasTursoConfiguration } from '../../../lib/db/client';
import {
  CheckoutUnavailableError,
  OrderRequestConflictError,
  prepareCardOrderCheckout,
} from '../../../lib/orders/checkout.service';
import { acceptsJsonBody, assertSameOrigin, jsonResponse } from '../../../lib/orders/http';
import { getStripeCheckoutGateway } from '../../../lib/orders/stripe.service';
import { crearPedidoSchema } from '../../../lib/orders/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!assertSameOrigin(request)) return jsonResponse({ error: 'Origen no permitido.' }, 403);
  if (!acceptsJsonBody(request)) return jsonResponse({ error: 'La petición no es válida.' }, 415);
  if (!hasTursoConfiguration()) return jsonResponse({ error: 'El servicio de pedidos no está disponible ahora mismo.' }, 503);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Los datos del pedido no son válidos.' }, 400);
  }
  const parsed = crearPedidoSchema.safeParse(input);
  if (!parsed.success) return jsonResponse({ error: 'Revisa los datos del pedido e inténtalo de nuevo.' }, 400);

  try {
    const gateway = await getStripeCheckoutGateway();
    const result = await prepareCardOrderCheckout(parsed.data, new URL(request.url).origin, { gateway });
    return jsonResponse({
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
      numeroPedido: result.numeroPedido,
    }, 201);
  } catch (error) {
    if (error instanceof OrderRequestConflictError) {
      return jsonResponse({ error: 'Los datos han cambiado. Recarga la página para iniciar un pedido nuevo.' }, 409);
    }
    if (error instanceof CheckoutUnavailableError) {
      return jsonResponse({ error: 'No hemos podido abrir el pago seguro. Inténtalo de nuevo.' }, 503);
    }
    console.error('[orders] Error al preparar Checkout.');
    return jsonResponse({ error: 'No hemos podido preparar el pago. Inténtalo de nuevo.' }, 500);
  }
};
