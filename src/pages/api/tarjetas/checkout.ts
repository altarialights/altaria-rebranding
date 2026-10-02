import type { APIRoute } from 'astro';
import { hasTursoConfiguration } from '../../../lib/db/client';
import {
  CheckoutUnavailableError,
  OrderRequestConflictError,
  prepareCardOrderCheckout,
} from '../../../lib/orders/checkout.service';
import { acceptsJsonBody, assertSameOrigin, jsonResponse } from '../../../lib/orders/http';
import { getSafeStripeErrorDetails, getStripeCheckoutGateway } from '../../../lib/orders/stripe.service';
import { crearPedidoSchema, formatOrderValidationErrors } from '../../../lib/orders/validation';
import { findCardProduct, hasPurchasablePrice, LEGACY_CARD_PRODUCT_ID } from '../../../data/cards-catalog';
import { ProductUnavailableError } from '../../../lib/orders/catalog-pricing';
import { artworkOwner } from '../../../lib/orders/artwork-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!assertSameOrigin(request)) return jsonResponse({ error: 'Origen no permitido.' }, 403);
  if (!acceptsJsonBody(request)) return jsonResponse({ error: 'La petición no es válida.' }, 415);

  let input: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 20_000) return jsonResponse({ error: 'El pedido es demasiado grande.' }, 413);
    input = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'Los datos del pedido no son válidos.' }, 400);
  }
  const requestedId = input && typeof input === 'object' ? (input as Record<string, unknown>).productoId : undefined;
  const product = findCardProduct(typeof requestedId === 'string' ? requestedId : LEGACY_CARD_PRODUCT_ID);
  if ((requestedId !== undefined && typeof requestedId !== 'string') || !product) {
    return jsonResponse({ error: 'Selecciona una opción válida.' }, 400);
  }
  if (!hasPurchasablePrice(product)) return jsonResponse({ error: 'Esta opción requiere una propuesta antes del pago.' }, 409);
  const parsed = crearPedidoSchema.safeParse(input);
  if (!parsed.success) {
    return jsonResponse({
      error: 'datos_invalidos',
      message: 'Revisa los datos indicados.',
      fields: formatOrderValidationErrors(parsed.error),
    }, 400);
  }

  if (!hasTursoConfiguration()) return jsonResponse({ error: 'El servicio de pedidos no está disponible ahora mismo.' }, 503);

  try {
    const gateway = await getStripeCheckoutGateway();
    const result = await prepareCardOrderCheckout(parsed.data, new URL(request.url).origin, { gateway, artworkOwnerHash: artworkOwner(cookies) });
    return jsonResponse({
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
      numeroPedido: result.numeroPedido,
    }, 200);
  } catch (error) {
    if (error instanceof ProductUnavailableError) return jsonResponse({ error: error.message }, 409);
    if (error instanceof OrderRequestConflictError) {
      return jsonResponse({ error: 'Los datos han cambiado. Recarga la página para iniciar un pedido nuevo.' }, 409);
    }
    if (error instanceof CheckoutUnavailableError) {
      return jsonResponse({ error: 'No hemos podido abrir el pago seguro. Inténtalo de nuevo.' }, 503);
    }
    const stripeError = getSafeStripeErrorDetails(error);
    if (stripeError) console.error('[orders] Stripe rechazó Checkout.', stripeError);
    else console.error('[orders] Error al preparar Checkout.', { type: error instanceof Error ? error.name : 'UnknownError' });
    return jsonResponse({ error: 'No hemos podido preparar el pago. Inténtalo de nuevo.' }, 500);
  }
};
