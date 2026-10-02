import { canCheckoutConfiguration, cardDestinationUrl } from './card-configuration';
import { findCardArtwork } from '../db/card-artwork.repository';
import { ProductUnavailableError } from './catalog-pricing';
import { calculateCardProductPrice } from './catalog-pricing';
import { CARD_PRICING_VERSION, findCardProduct, LEGACY_CARD_PRODUCT_ID } from '../../data/cards-catalog';
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
  artworkOwnerHash?: string;
  findArtwork?: typeof findCardArtwork;
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
  // También se valida aquí: ningún llamador puede saltarse la disponibilidad.
  if (!canCheckoutConfiguration(input.productoId ?? LEGACY_CARD_PRODUCT_ID, input.personalizacion?.configuracion, input.negocio.googlePlaceId)) {
    throw new ProductUnavailableError('Esta configuración requiere una propuesta.');
  }
  const product = findCardProduct(input.productoId ?? LEGACY_CARD_PRODUCT_ID)!;
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
    const config: import('./card-configuration').CardConfiguration | undefined = input.personalizacion?.configuracion ? structuredClone(input.personalizacion.configuracion) : undefined;
    if (!config || config.design === 'existing') throw new ProductUnavailableError('Vuelve al configurador para usar el catálogo actual.');
    if (config.design === 'own') {
      const file = config.artworkFile && await (dependencies.findArtwork ?? findCardArtwork)(config.artworkFile.token, dependencies.artworkOwnerHash);
      if (!file || file.orderId || file.inquiryId) throw new ProductUnavailableError('Adjunta un diseño de tu sesión que no pertenezca a otro pedido.');
      config.artwork = 'uploaded';
      config.artworkFile = { token: config.artworkFile!.token, filename: file.filename, width:file.width,height:file.height,status:file.status,warnings:file.warnings,layout:file.layout };
    } else { delete config.artworkFile; config.artwork = 'not-required'; }
    const amounts = calculateCardProductPrice(product.id, input.cantidad, config.design);
    const fecha = now();
    const persisted = await createPending({
      ...input,
      ...amounts,
      artworkOwnerHash: dependencies.artworkOwnerHash,
      productoNombre: product.orderName,
      personalizacion: {
        ...input.personalizacion,
        configuracion: config,
        destino: cardDestinationUrl(config, product.id, input.negocio.googlePlaceId),
        tarifa: { version: CARD_PRICING_VERSION, disenoCentimos: amounts.disenoCentimos },
      },
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
