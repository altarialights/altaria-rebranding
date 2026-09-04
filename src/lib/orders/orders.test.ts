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
  assertStripeTestSecret,
  buildCheckoutSessionParams,
  verifyStripeWebhookWithSecrets,
} from './stripe.service';
import type { CheckoutSessionData, NuevoPedidoTarjetas, PedidoTarjetas } from './types';
import {
  crearPedidoSchema,
  formatOrderValidationErrors,
  type CrearPedidoInput,
} from './validation';
import { handlePaidCheckout } from './webhook.service';

const input: CrearPedidoInput = {
  claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123',
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
  it('calculates all trusted amounts on the server without provisional tax', () => {
    expect(calcularImportesPedido(5)).toEqual({
      precioUnitarioCentimos: 2500,
      subtotalCentimos: 12500,
      envioCentimos: 490,
      impuestosCentimos: 0,
      totalCentimos: 12990,
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
  });
});

describe('Checkout creation idempotency', () => {
  it('creates one pending order, saves the session and reuses it on retry', async () => {
    let stored: PedidoTarjetas | null = null;
    const create = vi.fn(async () => ({ id: 'cs_test_altaria', url: 'https://checkout.stripe.com/c/pay/cs_test_altaria', livemode: false }));
    const retrieve = vi.fn(async () => ({ id: 'cs_test_altaria', url: 'https://checkout.stripe.com/c/pay/cs_test_altaria', livemode: false }));
    const gateway: CheckoutGateway = { create, retrieve };
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
  });

  it('rejects reuse of an idempotency key with different data', async () => {
    const fake = toPedido({
      ...input,
      ...calcularImportesPedido(input.cantidad),
      id: '11111111-1111-4111-8111-111111111111',
      numeroPedido: 'ALT-TRJ-20260904-22222222',
      huellaSolicitud: 'different',
      creadoEn: '2026-09-04T10:00:00.000Z',
    });
    await expect(prepareCardOrderCheckout(input, 'https://altarialights.com', {
      gateway: { create: vi.fn(), retrieve: vi.fn() },
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

describe('Stripe test-mode and signature enforcement', () => {
  const pedido = toPedido({
    ...input,
    ...calcularImportesPedido(input.cantidad),
    id: '11111111-1111-4111-8111-111111111111',
    numeroPedido: 'ALT-TRJ-20260904-22222222',
    huellaSolicitud: 'hash',
    creadoEn: '2026-09-04T10:00:00.000Z',
  });

  it('builds hosted payment Checkout with server amounts and minimal metadata', () => {
    const params = buildCheckoutSessionParams(pedido, 'https://altarialights.com');
    expect(params.mode).toBe('payment');
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.client_reference_id).toBe(pedido.id);
    expect(params.customer_email).toBe(input.cliente.email);
    expect(params.metadata).toEqual({ pedido_id: pedido.id, numero_pedido: pedido.numeroPedido });
    expect(params.line_items).toHaveLength(2);
    expect(params.line_items?.[0]).toMatchObject({ quantity: 5, price_data: { unit_amount: 2500, currency: 'eur' } });
    expect(params.line_items?.[1]).toMatchObject({ quantity: 1, price_data: { unit_amount: 490, currency: 'eur' } });
    expect(params.success_url).toContain('{CHECKOUT_SESSION_ID}');
  });

  it('rejects live secret keys', () => {
    expect(() => assertStripeTestSecret('sk_live_forbidden')).toThrow(/sk_test_/u);
    expect(() => assertStripeTestSecret('sk_test_allowed')).not.toThrow();
  });

  it('accepts a valid test signature and rejects an invalid one', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_signed', type: 'checkout.session.completed', livemode: false,
      object: 'event', data: { object: { id: 'cs_test_altaria', object: 'checkout.session' } },
    });
    const webhookSecret = 'whsec_test_altaria';
    const stripe = new Stripe('sk_test_signature');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const event = await verifyStripeWebhookWithSecrets(payload, signature, 'sk_test_signature', webhookSecret);
    expect(event.id).toBe('evt_test_signed');
    await expect(verifyStripeWebhookWithSecrets(payload, 't=1,v1=invalid', 'sk_test_signature', webhookSecret)).rejects.toThrow();
  });
});
