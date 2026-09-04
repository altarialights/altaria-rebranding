import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { jsonResponse } from '../../../lib/orders/http';
import { normalizeCheckoutSession, verifyStripeWebhook } from '../../../lib/orders/stripe.service';
import { handlePaidCheckout } from '../../../lib/orders/webhook.service';

export const prerender = false;

const CHECKOUT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

export const POST: APIRoute = async ({ request }) => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength && (!Number.isFinite(contentLength) || contentLength > 1_000_000)) {
    return jsonResponse({ error: 'El evento es demasiado grande.' }, 413);
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return jsonResponse({ error: 'Falta la firma de Stripe.' }, 400);
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await verifyStripeWebhook(rawBody, signature);
  } catch {
    return jsonResponse({ error: 'Firma de Stripe no válida.' }, 400);
  }

  if (!CHECKOUT_EVENTS.has(event.type)) return jsonResponse({ received: true, handled: false });

  let pedidoId: string | null = null;
  try {
    const session = normalizeCheckoutSession(event.data.object as Stripe.Checkout.Session);
    pedidoId = session.clientReferenceId;
    const result = await handlePaidCheckout(event.id, event.type, session);
    return jsonResponse({ received: true, handled: true, result: result.resultado });
  } catch (error) {
    console.error('[orders] Fallo al procesar un evento Stripe.', {
      type: error instanceof Error ? error.name : 'UnknownError',
      pedido_id: pedidoId,
    });
    return jsonResponse({ error: 'No se ha podido procesar el evento.' }, 500);
  }
};
