import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { calcularImportesPedido } from './config';
import {
  OrderRequestConflictError,
  prepareCardOrderCheckout,
  type CheckoutGateway,
} from './checkout.service';
import { validateCheckoutPayment } from './payment-validation';
import {
  buildCheckoutSessionParams,
  getSafeStripeErrorDetails,
  verifyStripeWebhookWithSecrets,
} from './stripe.service';
import {
  assertStripeLivemode,
  assertStripeSecretForMode,
  parseStripeMode,
  stripeEnvironmentMatches,
} from './stripe-mode';
import { getCardsCheckoutCopy } from '../../data/cards-checkout-copy';
import { formatPaidCardOrderTelegramMessage } from '../notifications/templates';
import type { CheckoutSessionData, NuevoPedidoTarjetas, PedidoTarjetas } from './types';
import {
  crearPedidoSchema,
  formatOrderValidationErrors,
  type CrearPedidoInput,
} from './validation';
import { handlePaidCheckout } from './webhook.service';

const input: CrearPedidoInput = {
  claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123',
  aceptaCondicionesCompra: true,
  negocio: {
    googlePlaceId: 'ChIJAltariaTest',
    nombre: 'Café Altaria',
    direccion: 'Calle de la Luz 123, Madrid',
    googleMapsUrl: 'https://maps.google.com/?cid=123',
  },
  cantidad: 5,
  cliente: { nombre: 'Martín Camarero', email: 'martin@example.com', telefono: '+34 600 123 456' },
  envio: {
    direccion: 'Calle de la Luz 123',
    direccionExtra: 'Local 2',
    codigoPostal: '28001',
    ciudad: 'Madrid',
    provincia: 'Madrid',
    pais: 'ES',
    referencia: 'Horario comercial',
  },
};

const toPedido = (nuevo: NuevoPedidoTarjetas, sessionId: string | null = null): PedidoTarjetas => ({
  id: nuevo.id,
  numeroPedido: nuevo.numeroPedido,
  claveIdempotencia: nuevo.claveIdempotencia,
  huellaSolicitud: nuevo.huellaSolicitud,
  estado: 'pendiente_pago',
  googlePlaceId: nuevo.negocio.googlePlaceId,
  negocioNombre: nuevo.negocio.nombre,
  negocioDireccion: nuevo.negocio.direccion,
  googleMapsUrl: nuevo.negocio.googleMapsUrl ?? null,
  cantidad: nuevo.cantidad,
  precioUnitarioCentimos: nuevo.precioUnitarioCentimos,
  subtotalCentimos: nuevo.subtotalCentimos,
  envioCentimos: nuevo.envioCentimos,
  impuestosCentimos: nuevo.impuestosCentimos,
  totalCentimos: nuevo.totalCentimos,
  moneda: nuevo.moneda,
  clienteNombre: nuevo.cliente.nombre,
  clienteEmail: nuevo.cliente.email,
  clienteTelefono: nuevo.cliente.telefono,
  envioDireccion: nuevo.envio.direccion,
  envioDireccionExtra: nuevo.envio.direccionExtra ?? null,
  envioCodigoPostal: nuevo.envio.codigoPostal,
  envioCiudad: nuevo.envio.ciudad,
  envioProvincia: nuevo.envio.provincia,
  envioPais: nuevo.envio.pais,
  referenciaEnvio: nuevo.envio.referencia ?? null,
  stripeCheckoutSessionId: sessionId,
  stripePaymentIntentId: null,
  stripeCustomerId: null,
  stripeEntorno: nuevo.stripeEntorno,
  creadoEn: nuevo.creadoEn,
  pagadoEn: null,
  telegramNotificadoEn: null,
});

const sessionFor = (pedido: PedidoTarjetas, overrides: Partial<CheckoutSessionData> = {}): CheckoutSessionData => ({
  id: 'cs_test_altaria',
  url: 'https://checkout.stripe.com/c/pay/cs_test_altaria',
  livemode: false,
  clientReferenceId: pedido.id,
  paymentStatus: 'paid',
  amountTotal: pedido.totalCentimos,
  currency: 'eur',
  paymentIntentId: 'pi_test_altaria',
  customerId: 'cus_test_altaria',
  metadata: { pedido_id: pedido.id, numero_pedido: pedido.numeroPedido },
  ...overrides,
});

describe('card order pricing and validation', () => {
  it('applies quantity pricing tiers and makes shipping free from two cards', () => {
    expect(calcularImportesPedido(1)).toEqual({
      precioUnitarioCentimos: 2000,
      subtotalCentimos: 2000,
      envioCentimos: 490,
      impuestosCentimos: 0,
      totalCentimos: 2490,
      moneda: 'eur',
    });
    expect(calcularImportesPedido(2)).toEqual({
      precioUnitarioCentimos: 2000,
      subtotalCentimos: 4000,
      envioCentimos: 0,
      impuestosCentimos: 0,
      totalCentimos: 4000,
      moneda: 'eur',
    });
    expect(calcularImportesPedido(9).precioUnitarioCentimos).toBe(2000);
    expect(calcularImportesPedido(10)).toEqual({
      precioUnitarioCentimos: 1750,
      subtotalCentimos: 17500,
      envioCentimos: 0,
      impuestosCentimos: 0,
      totalCentimos: 17500,
      moneda: 'eur',
    });
    expect(calcularImportesPedido(19).precioUnitarioCentimos).toBe(1750);
    expect(calcularImportesPedido(20)).toEqual({
      precioUnitarioCentimos: 1500,
      subtotalCentimos: 30000,
      envioCentimos: 0,
      impuestosCentimos: 0,
      totalCentimos: 30000,
      moneda: 'eur',
    });
  });

  it('rejects invalid contact, postcode and quantity data', () => {
    const parsed = crearPedidoSchema.safeParse({
      ...input,
      cantidad: 0,
      cliente: { ...input.cliente, email: 'invalid' },
      envio: { ...input.envio, codigoPostal: '28', ciudad: '' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatOrderValidationErrors(parsed.error)).toEqual(expect.objectContaining({
        cantidad: 'Elige una cantidad entre 1 y 500.',
        'cliente.email': 'Introduce un email válido.',
        'envio.codigoPostal': 'Introduce un código postal de 5 cifras.',
        'envio.ciudad': 'Introduce la localidad.',
      }));
    }
  });

  it('normalizes a Spanish phone without +34 and accepts non-essential Places fields as optional', () => {
    const parsed = crearPedidoSchema.safeParse({
      ...input,
      negocio: {
        googlePlaceId: 'ChIJAltariaTest',
        nombre: 'Q',
        googleMapsURI: 'https://maps.google.com/?cid=123',
      },
      cantidad: 17,
      cliente: { ...input.cliente, telefono: '612/345/678' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cantidad).toBe(17);
      expect(parsed.data.cliente.telefono).toBe('+34612345678');
      expect(parsed.data.negocio.direccion).toBe('');
      expect(parsed.data.negocio.googleMapsUrl).toBe('https://maps.google.com/?cid=123');
    }
  });

  it('returns safe field errors for invalid phone, email, city, business and quantity', () => {
    const parsed = crearPedidoSchema.safeParse({
      ...input,
      negocio: { ...input.negocio, googlePlaceId: '' },
      cantidad: 0,
      cliente: { ...input.cliente, email: 'invalid', telefono: 'teléfono desconocido' },
      envio: { ...input.envio, ciudad: '' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatOrderValidationErrors(parsed.error)).toEqual(expect.objectContaining({
        'negocio.googlePlaceId': 'Selecciona un negocio de la lista de Google.',
        cantidad: 'Elige una cantidad entre 1 y 500.',
        'cliente.email': 'Introduce un email válido.',
        'cliente.telefono': 'Introduce un teléfono válido.',
        'envio.ciudad': 'Introduce la localidad.',
      }));
    }
  });

  it('contains only append-only CREATE statements and required uniqueness', () => {
    const sql = readFileSync(new URL('../../../migrations/002_create_card_orders.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE pedidos_tarjetas');
    expect(sql).toContain('CREATE TABLE eventos_pedido');
    expect(sql).toContain('CREATE TABLE eventos_stripe');
    expect(sql).toMatch(/stripe_event_id TEXT NOT NULL UNIQUE/u);
    expect(sql).not.toMatch(/\b(?:DROP|ALTER)\b/iu);
    const environmentMigration = readFileSync(
      new URL('../../../migrations/003_add_card_order_stripe_environment.sql', import.meta.url),
      'utf8',
    );
    expect(environmentMigration).toMatch(/ALTER TABLE pedidos_tarjetas[\s\S]+ADD COLUMN stripe_entorno/iu);
    expect(environmentMigration).toContain("DEFAULT 'test'");
    expect(environmentMigration).toContain("CHECK (stripe_entorno IN ('test', 'live'))");
    expect(environmentMigration).not.toMatch(/\bDROP\b/iu);
  });
});

describe('Checkout creation idempotency', () => {
  it('creates one pending order, saves the session and reuses it on retry', async () => {
    let stored: PedidoTarjetas | null = null;
    const create = vi.fn(async () => ({ id: 'cs_test_altaria', url: 'https://checkout.stripe.com/c/pay/cs_test_altaria', livemode: false }));
    const retrieve = vi.fn(async () => ({ id: 'cs_test_altaria', url: 'https://checkout.stripe.com/c/pay/cs_test_altaria', livemode: false }));
    const gateway: CheckoutGateway = { mode: 'test', create, retrieve };
    const createPending = vi.fn(async (nuevo: NuevoPedidoTarjetas) => {
      stored = toPedido(nuevo);
      return { pedido: stored, creado: true };
    });
    const saveSession = vi.fn(async (_pedidoId: string, sessionId: string) => {
      if (stored) stored = { ...stored, stripeCheckoutSessionId: sessionId };
    });
    const dependencies = {
      gateway,
      findByIdempotencyKey: async () => stored,
      createPending,
      saveSession,
      now: () => new Date('2026-09-04T10:00:00.000Z'),
      randomUUID: vi.fn()
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222'),
    };

    const first = await prepareCardOrderCheckout(input, 'https://altarialights.com', dependencies);
    const second = await prepareCardOrderCheckout(input, 'https://altarialights.com', dependencies);

    expect(first.sessionId).toBe('cs_test_altaria');
    expect(second.sessionId).toBe('cs_test_altaria');
    expect(createPending).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect((stored as PedidoTarjetas | null)?.estado).toBe('pendiente_pago');

    const liveGateway: CheckoutGateway = {
      mode: 'live',
      create: vi.fn(),
      retrieve: vi.fn(),
    };
    await expect(prepareCardOrderCheckout(input, 'https://altarialights.com', {
      ...dependencies,
      gateway: liveGateway,
    })).rejects.toBeInstanceOf(OrderRequestConflictError);
    expect(liveGateway.create).not.toHaveBeenCalled();
    expect(liveGateway.retrieve).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with different data', async () => {
    const fake = toPedido({
      ...input,
      ...calcularImportesPedido(input.cantidad),
      id: '11111111-1111-4111-8111-111111111111',
      numeroPedido: 'ALT-TRJ-20260904-22222222',
      huellaSolicitud: 'different',
      creadoEn: '2026-09-04T10:00:00.000Z',
      stripeEntorno: 'test',
    });
    await expect(prepareCardOrderCheckout(input, 'https://altarialights.com', {
      gateway: { mode: 'test', create: vi.fn(), retrieve: vi.fn() },
      findByIdempotencyKey: async () => fake,
    })).rejects.toBeInstanceOf(OrderRequestConflictError);
  });
});

describe('Stripe payment validation and webhook effects', () => {
  const pedido = toPedido({
    ...input,
    ...calcularImportesPedido(input.cantidad),
    id: '11111111-1111-4111-8111-111111111111',
    numeroPedido: 'ALT-TRJ-20260904-22222222',
    huellaSolicitud: 'hash',
    creadoEn: '2026-09-04T10:00:00.000Z',
    stripeEntorno: 'test',
  }, 'cs_test_altaria');

  it('accepts only paid, matching EUR sessions with matching metadata', () => {
    expect(validateCheckoutPayment(pedido, sessionFor(pedido))).toBe('pagado');
    expect(validateCheckoutPayment(pedido, sessionFor(pedido, { paymentStatus: 'unpaid' }))).toBe('pago_pendiente');
    expect(validateCheckoutPayment(pedido, sessionFor(pedido, { amountTotal: 1 }))).toBe('importe_incorrecto');
    expect(validateCheckoutPayment(pedido, sessionFor(pedido, { currency: 'usd' }))).toBe('moneda_incorrecta');
    expect(validateCheckoutPayment(pedido, sessionFor(pedido, { metadata: {} }))).toBe('metadata_incorrecta');
  });

  it('notifies Telegram only once when Stripe redelivers the same event', async () => {
    let processed = false;
    const notify = vi.fn(async () => ({
      status: 'sent' as const,
      provider: 'telegram' as const,
      notificationType: 'paid_card_order' as const,
      providerMessageId: 42,
      timestamp: '2026-09-04T10:01:00.000Z',
    }));
    const recordNotification = vi.fn(async () => undefined);
    const process = vi.fn(async () => {
      if (processed) return { resultado: 'duplicado' as const, pedido: null, notificarTelegram: false as const };
      processed = true;
      return { resultado: 'pagado' as const, pedido: { ...pedido, estado: 'pagado' as const }, notificarTelegram: true as const };
    });

    await handlePaidCheckout('evt_test_1', 'checkout.session.completed', sessionFor(pedido), { process, notify, recordNotification });
    await handlePaidCheckout('evt_test_1', 'checkout.session.completed', sessionFor(pedido), { process, notify, recordNotification });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(recordNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps the paid result when Telegram fails', async () => {
    const recordNotification = vi.fn(async () => undefined);
    const result = await handlePaidCheckout('evt_test_2', 'checkout.session.completed', sessionFor(pedido), {
      process: async () => ({ resultado: 'pagado', pedido: { ...pedido, estado: 'pagado' }, notificarTelegram: true }),
      notify: async () => ({
        status: 'failed', provider: 'telegram', notificationType: 'paid_card_order',
        reason: 'network_error', timestamp: '2026-09-04T10:01:00.000Z',
      }),
      recordNotification,
      warn: vi.fn(),
    });
    expect(result.resultado).toBe('pagado');
    expect(recordNotification).toHaveBeenCalledWith(pedido.id, 'evt_test_2', expect.objectContaining({ status: 'failed' }));
  });
});

describe('Stripe environment and signature enforcement', () => {
  const pedido = toPedido({
    ...input,
    ...calcularImportesPedido(input.cantidad),
    id: '11111111-1111-4111-8111-111111111111',
    numeroPedido: 'ALT-TRJ-20260904-22222222',
    huellaSolicitud: 'hash',
    creadoEn: '2026-09-04T10:00:00.000Z',
    stripeEntorno: 'test',
  });

  it('builds hosted payment Checkout with server amounts and minimal metadata', () => {
    const params = buildCheckoutSessionParams(pedido, 'https://altarialights.com');
    expect(params.mode).toBe('payment');
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.client_reference_id).toBe(pedido.id);
    expect(params.customer_email).toBe(input.cliente.email);
    expect(params.metadata).toEqual({ pedido_id: pedido.id, numero_pedido: pedido.numeroPedido });
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items?.[0]).toMatchObject({ quantity: 5, price_data: { unit_amount: 2000, currency: 'eur' } });
    expect(params.success_url).toBe(
      'https://altarialights.com/tarjetas-rese%C3%B1as-google/pedido-confirmado?session_id={CHECKOUT_SESSION_ID}',
    );
    expect(params.success_url).not.toContain('ñ');
    expect(params.success_url).toContain('tarjetas-rese%C3%B1as-google');
    expect(params.success_url).toContain('{CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe(
      'https://altarialights.com/tarjetas-rese%C3%B1as-google?pago=cancelado#configurador',
    );
    expect(params.cancel_url).not.toContain('ñ');
  });

  it('keeps Stripe logs limited to safe diagnostic fields', () => {
    const error = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'Invalid URL',
      code: 'url_invalid',
      param: 'success_url',
      requestId: 'req_test_altaria',
    });
    expect(getSafeStripeErrorDetails(error)).toEqual({
      type: 'StripeInvalidRequestError',
      code: 'url_invalid',
      param: 'success_url',
      requestId: 'req_test_altaria',
    });
  });

  it('requires the secret key prefix to match STRIPE_MODE', () => {
    expect(() => assertStripeSecretForMode('test', 'sk_test_allowed')).not.toThrow();
    expect(() => assertStripeSecretForMode('test', 'sk_live_forbidden')).toThrow(/STRIPE_MODE=test/u);
    expect(() => assertStripeSecretForMode('live', 'sk_live_allowed')).not.toThrow();
    expect(() => assertStripeSecretForMode('live', 'sk_test_forbidden')).toThrow(/STRIPE_MODE=live/u);
  });

  it('fails safely when STRIPE_MODE is missing or invalid', () => {
    expect(() => parseStripeMode(undefined)).toThrow(/STRIPE_MODE/u);
    expect(() => parseStripeMode('production')).toThrow(/STRIPE_MODE/u);
  });

  it('requires Stripe livemode to match the configured environment', () => {
    expect(() => assertStripeLivemode('test', false)).not.toThrow();
    expect(() => assertStripeLivemode('test', true)).toThrow(/STRIPE_MODE=test/u);
    expect(() => assertStripeLivemode('live', true)).not.toThrow();
    expect(() => assertStripeLivemode('live', false)).toThrow(/STRIPE_MODE=live/u);
  });

  it('rejects test orders with live events and live orders with test events', () => {
    expect(stripeEnvironmentMatches('test', false)).toBe(true);
    expect(stripeEnvironmentMatches('test', true)).toBe(false);
    expect(stripeEnvironmentMatches('live', true)).toBe(true);
    expect(stripeEnvironmentMatches('live', false)).toBe(false);
  });

  it('keeps live UI free of test wording and marks test UI clearly', () => {
    const liveCopy = Object.values(getCardsCheckoutCopy('live')).join(' ').toLowerCase();
    const testCopy = Object.values(getCardsCheckoutCopy('test')).join(' ').toLowerCase();
    expect(liveCopy).not.toContain('prueba');
    expect(liveCopy).not.toContain('test mode');
    expect(testCopy).toContain('modo de prueba');
  });

  it('distinguishes live and test paid orders in Telegram', () => {
    expect(formatPaidCardOrderTelegramMessage({ ...pedido, stripeEntorno: 'live' }))
      .toContain('💳 NUEVO PEDIDO PAGADO');
    expect(formatPaidCardOrderTelegramMessage({ ...pedido, stripeEntorno: 'test' }))
      .toContain('🧪 PEDIDO DE PRUEBA PAGADO');
  });

  it('accepts a valid test signature and rejects an invalid one', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_signed', type: 'checkout.session.completed', livemode: false,
      object: 'event', data: { object: { id: 'cs_test_altaria', object: 'checkout.session' } },
    });
    const webhookSecret = 'whsec_test_altaria';
    const stripe = new Stripe('sk_test_signature');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const event = await verifyStripeWebhookWithSecrets(payload, signature, 'test', 'sk_test_signature', webhookSecret);
    expect(event.id).toBe('evt_test_signed');
    await expect(verifyStripeWebhookWithSecrets(payload, 't=1,v1=invalid', 'test', 'sk_test_signature', webhookSecret)).rejects.toThrow();

    const livePayload = JSON.stringify({
      id: 'evt_live_signed', type: 'checkout.session.completed', livemode: true,
      object: 'event', data: { object: { id: 'cs_live_altaria', object: 'checkout.session' } },
    });
    const liveSignature = stripe.webhooks.generateTestHeaderString({ payload: livePayload, secret: webhookSecret });
    const liveEvent = await verifyStripeWebhookWithSecrets(
      livePayload, liveSignature, 'live', 'sk_live_signature', webhookSecret,
    );
    expect(liveEvent.id).toBe('evt_live_signed');
    await expect(verifyStripeWebhookWithSecrets(
      payload, signature, 'live', 'sk_live_signature', webhookSecret,
    )).rejects.toThrow(/STRIPE_MODE=live/u);
    await expect(verifyStripeWebhookWithSecrets(
      livePayload, liveSignature, 'test', 'sk_test_signature', webhookSecret,
    )).rejects.toThrow(/STRIPE_MODE=test/u);
  });
});
