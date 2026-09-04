import Stripe from 'stripe';
import type { CheckoutGateway } from './checkout.service';
import type { CheckoutSessionData, PedidoTarjetas } from './types';
import {
  assertStripeLivemode,
  assertStripeSecretForMode,
  readStripeMode,
  type StripeMode,
} from './stripe-mode';

const readStripeSecret = async (name: 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'): Promise<string> => {
  const { getSecret } = await import('astro:env/server');
  return getSecret(name)?.trim() ?? '';
};

const createStripeClient = (mode: StripeMode, secretKey: string): Stripe => {
  assertStripeSecretForMode(mode, secretKey);
  return new Stripe(secretKey, { maxNetworkRetries: 2 });
};

const stringId = (value: string | { id: string } | null): string | null =>
  typeof value === 'string' ? value : value?.id ?? null;

export const normalizeCheckoutSession = (session: Stripe.Checkout.Session): CheckoutSessionData => ({
  id: session.id,
  url: session.url,
  livemode: session.livemode,
  clientReferenceId: session.client_reference_id,
  paymentStatus: session.payment_status,
  amountTotal: session.amount_total,
  currency: session.currency,
  paymentIntentId: stringId(session.payment_intent),
  customerId: stringId(session.customer),
  metadata: session.metadata ?? {},
});

export const buildCheckoutSessionParams = (
  pedido: PedidoTarjetas,
  origin: string,
): Stripe.Checkout.SessionCreateParams => {
  const successBase = new URL('/tarjetas-reseñas-google/pedido-confirmado', origin);
  const successUrl = `${successBase.href}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = new URL('/tarjetas-reseñas-google?pago=cancelado#configurador', origin).href;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    quantity: pedido.cantidad,
    price_data: {
      currency: pedido.moneda,
      unit_amount: pedido.precioUnitarioCentimos,
      product_data: { name: 'Tarjeta NFC + QR para reseñas de Google' },
    },
  }];
  if (pedido.envioCentimos > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: pedido.moneda,
        unit_amount: pedido.envioCentimos,
        product_data: { name: 'Envío del pedido' },
      },
    });
  }
  return {
    mode: 'payment',
    locale: 'es',
    payment_method_types: ['card'],
    client_reference_id: pedido.id,
    customer_email: pedido.clienteEmail,
    line_items: lineItems,
    metadata: { pedido_id: pedido.id, numero_pedido: pedido.numeroPedido },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
};

export interface SafeStripeErrorDetails {
  type: string;
  code: string | null;
  param: string | null;
  requestId: string | null;
}

export const getSafeStripeErrorDetails = (error: unknown): SafeStripeErrorDetails | null => {
  if (!(error instanceof Stripe.errors.StripeError)) return null;
  return {
    type: error.type,
    code: error.code ?? null,
    param: error.param ?? null,
    requestId: error.requestId ?? null,
  };
};

export const getStripeCheckoutGateway = async (): Promise<CheckoutGateway> => {
  const mode = await readStripeMode();
  const stripe = createStripeClient(mode, await readStripeSecret('STRIPE_SECRET_KEY'));
  return {
    mode,
    create: async (pedido: PedidoTarjetas, origin: string, idempotencyKey: string) => {
      const session = await stripe.checkout.sessions.create(
        buildCheckoutSessionParams(pedido, origin),
        { idempotencyKey },
      );
      return { id: session.id, url: session.url, livemode: session.livemode };
    },
    retrieve: async (sessionId: string) => {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return { id: session.id, url: session.url, livemode: session.livemode };
    },
  };
};

export const verifyStripeWebhook = async (rawBody: string, signature: string): Promise<Stripe.Event> => {
  const mode = await readStripeMode();
  const secretKey = await readStripeSecret('STRIPE_SECRET_KEY');
  const webhookSecret = await readStripeSecret('STRIPE_WEBHOOK_SECRET');
  return verifyStripeWebhookWithSecrets(rawBody, signature, mode, secretKey, webhookSecret);
};

export const verifyStripeWebhookWithSecrets = async (
  rawBody: string,
  signature: string,
  mode: StripeMode,
  secretKey: string,
  webhookSecret: string,
): Promise<Stripe.Event> => {
  if (!webhookSecret.startsWith('whsec_')) throw new Error('El secreto del webhook de Stripe no está configurado.');
  const stripe = createStripeClient(mode, secretKey);
  const event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  assertStripeLivemode(mode, event.livemode);
  return event;
};
