import { calcularImportesPedido } from './config';
import type { PedidoTarjetas } from './types';
import type { CrearPedidoInput } from './validation';
import { stripeEnvironmentMatches, type StripeMode } from './stripe-mode';
import {
  createPendingCardOrder,
  findCardOrderByIdempotencyKey,
  saveCheckoutSession,
} from '../db/card-orders.repository';

export interface CheckoutGateway {
  mode: StripeMode;
  create(pedido: PedidoTarjetas, origin: string, idempotencyKey: string): Promise<{ id: string; url: string | null; livemode: boolean }>;
  retrieve(sessionId: string): Promise<{ id: string; url: string | null; livemode: boolean }>;
}

interface CheckoutDependencies {
  gateway: CheckoutGateway;
  findByIdempotencyKey?: typeof findCardOrderByIdempotencyKey;
  createPending?: typeof createPendingCardOrder;
  saveSession?: typeof saveCheckoutSession;
  now?: () => Date;
  randomUUID?: () => string;
}

export class OrderRequestConflictError extends Error {}
export class CheckoutUnavailableError extends Error {}

const hashRequest = async (input: CrearPedidoInput): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createOrderNumber = (date: Date, randomUUID: () => string): string => {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return `ALT-TRJ-${day}-${suffix}`;
};

const usableSession = (
  session: { id: string; url: string | null; livemode: boolean },
  mode: StripeMode,
): { sessionId: string; checkoutUrl: string } => {
  if (!stripeEnvironmentMatches(mode, session.livemode)) {
    throw new CheckoutUnavailableError('La sesión de Stripe no coincide con el entorno configurado.');
  }
  if (!session.url) throw new CheckoutUnavailableError('La sesión de pago no tiene una URL disponible.');
  return { sessionId: session.id, checkoutUrl: session.url };
};

export const prepareCardOrderCheckout = async (
  input: CrearPedidoInput,
  origin: string,
  dependencies: CheckoutDependencies,
): Promise<{ pedidoId: string; numeroPedido: string; sessionId: string; checkoutUrl: string }> => {
  const findByIdempotencyKey = dependencies.findByIdempotencyKey ?? findCardOrderByIdempotencyKey;
  const createPending = dependencies.createPending ?? createPendingCardOrder;
  const saveSession = dependencies.saveSession ?? saveCheckoutSession;
  const now = dependencies.now ?? (() => new Date());
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const huellaSolicitud = await hashRequest(input);

  let pedido = await findByIdempotencyKey(input.claveIdempotencia);
  if (pedido && pedido.huellaSolicitud !== huellaSolicitud) {
    throw new OrderRequestConflictError('La clave de reintento pertenece a otro pedido.');
  }

  if (!pedido) {
    const fecha = now();
    const persisted = await createPending({
      ...input,
      ...calcularImportesPedido(input.cantidad),
      id: randomUUID(),
      numeroPedido: createOrderNumber(fecha, randomUUID),
      huellaSolicitud,
      creadoEn: fecha.toISOString(),
      stripeEntorno: dependencies.gateway.mode,
    });
    pedido = persisted.pedido;
    if (pedido.huellaSolicitud !== huellaSolicitud) {
      throw new OrderRequestConflictError('La clave de reintento pertenece a otro pedido.');
    }
  }

  if (pedido.stripeEntorno !== dependencies.gateway.mode) {
    throw new OrderRequestConflictError('El pedido pertenece a otro entorno de Stripe.');
  }

  if (pedido.stripeCheckoutSessionId) {
    const existing = usableSession(
      await dependencies.gateway.retrieve(pedido.stripeCheckoutSessionId),
      dependencies.gateway.mode,
    );
    return { pedidoId: pedido.id, numeroPedido: pedido.numeroPedido, ...existing };
  }

  const created = usableSession(
    await dependencies.gateway.create(pedido, origin, `tarjetas:${input.claveIdempotencia}`),
    dependencies.gateway.mode,
  );
  await saveSession(pedido.id, created.sessionId);
  return { pedidoId: pedido.id, numeroPedido: pedido.numeroPedido, ...created };
};
