import { describe, expect, it, vi } from 'vitest';
import { cardsCatalog, cardsPricing } from '../../data/cards-catalog';
import { calculateCardProductPrice, ProductUnavailableError } from './catalog-pricing';
import { prepareCardOrderCheckout } from './checkout.service';
import { buildCheckoutSessionParams } from './stripe.service';
import { crearPedidoSchema } from './validation';
import type { NuevoPedidoTarjetas, PedidoTarjetas } from './types';

const request = (design: 'own' | 'custom' = 'custom', quantity = 5) => crearPedidoSchema.parse({
  productoId: 'reservas', claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123', aceptaCondicionesCompra: true,
  cantidad: quantity, negocio: { nombre: 'Negocio QA' },
  personalizacion: { configuracion: { version: 2, design, destination: 'link', artwork: 'requested-later', details: { url: 'https://example.com/reservas' } },
    tarifa: { version: 'forged', disenoCentimos: 1 }, destino: 'https://example.com/forged' },
  cliente: { nombre: 'Cliente QA', email: 'qa@example.com', telefono: '+34600000000' },
  envio: { direccion: 'Calle Prueba 1', codigoPostal: '28001', ciudad: 'Madrid', provincia: 'Madrid', pais: 'ES' },
});

describe('New shared Altaria Cards tariff', () => {
  it.each([[1,2000],[4,2000],[5,1800],[9,1800],[10,1500],[19,1500],[20,1500],[49,1500],[50,1000],[500,1000]])('prices quantity %i at %i cents for every type, design once per order', (quantity, unit) => {
    for (const product of cardsCatalog) for (const design of ['own', 'custom'] as const) {
      const amount = calculateCardProductPrice(product.id, quantity, design);
      expect(amount.precioUnitarioCentimos).toBe(unit);
      expect(amount.disenoCentimos).toBe(design === 'custom' ? 1000 : 0);
      expect(amount.subtotalCentimos).toBe(quantity * unit + (design === 'custom' ? 1000 : 0));
      expect(amount.totalCentimos).toBe(amount.subtotalCentimos + (quantity === 1 ? 490 : 0));
    }
  });
  it.each([0, -1, 1.5, 501, NaN])('rejects invalid quantity %s', quantity => {
    expect(() => calculateCardProductPrice('resenas', quantity)).toThrow();
  });
  it('persists server pricing, Stripe charges design once, retries keep frozen amounts after a tariff change', async () => {
    const input = request();
    expect(input.personalizacion).not.toHaveProperty('tarifa');
    let stored: PedidoTarjetas | null = null;
    const createPending = vi.fn(async (value: NuevoPedidoTarjetas) => {
      stored = { ...value, clienteEmail: value.cliente.email, stripeCheckoutSessionId: null } as unknown as PedidoTarjetas;
      return { pedido: stored, creado: true };
    });
    const create = vi.fn(async (pedido: PedidoTarjetas) => {
      const params = buildCheckoutSessionParams(pedido, 'https://example.com');
      const lines = params.line_items!;
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ quantity: 1, price_data: { unit_amount: 1000 } });
      expect(lines.reduce((sum, line) => sum + line.quantity! * line.price_data!.unit_amount!, 0)).toBe(10000);
      expect(pedido.totalCentimos).toBe(10000);
      return { id: 'cs_test_qa', url: 'https://checkout.stripe.com/c/pay/cs_test_qa', livemode: false };
    });
    const deps = { gateway: { mode: 'test' as const, create, retrieve: vi.fn() }, findByIdempotencyKey: async () => stored, createPending, saveSession: vi.fn() };
    await prepareCardOrderCheckout(input, 'https://example.com', deps);
    // Simula el reintento entre persistir el pedido y guardar la sesión de Stripe.
    const previous = cardsPricing.design.custom;
    try {
      Object.assign(cardsPricing.design, { custom: 9900 });
      await prepareCardOrderCheckout(input, 'https://example.com', deps);
    } finally { Object.assign(cardsPricing.design, { custom: previous }); }
    expect(createPending).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('resumes a historical Google order at its saved price; refuses a new legacy request', async () => {
    const input = request('own'); delete input.personalizacion; input.productoId = 'resenas'; input.negocio.googlePlaceId = 'ChIJHistorical';
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const historical = { id: 'old', numeroPedido: 'OLD', huellaSolicitud: hash, stripeEntorno: 'test', cantidad: 10,
      precioUnitarioCentimos: 1750, subtotalCentimos: 17500, totalCentimos: 17500, envioCentimos: 0, moneda: 'eur', stripeCheckoutSessionId: null } as PedidoTarjetas;
    const create = vi.fn(async (pedido: PedidoTarjetas) => {
      expect(buildCheckoutSessionParams(pedido, 'https://example.com').line_items).toHaveLength(1);
      expect(pedido.totalCentimos).toBe(17500);
      return { id: 'cs_test_old', url: 'https://checkout.stripe.com/c/pay/cs_test_old', livemode: false };
    });
    const deps = { gateway: { mode: 'test' as const, create, retrieve: vi.fn() }, findByIdempotencyKey: async () => historical, saveSession: vi.fn(), createPending: vi.fn() };
    await prepareCardOrderCheckout(input, 'https://example.com', deps);
    expect(deps.createPending).not.toHaveBeenCalled();
    await expect(prepareCardOrderCheckout(input, 'https://example.com', { ...deps, findByIdempotencyKey: async () => null })).rejects.toThrow(ProductUnavailableError);
  });
  it.each(cardsCatalog.map(product => product.id))('rejects destination creation at API validation for %s, regardless of submitted prices', productoId => {
    const input = request();
    input.productoId = productoId;
    input.personalizacion!.configuracion!.destination = 'create';
    input.personalizacion!.configuracion!.details.project = 'Una web para mi negocio';
    expect(crearPedidoSchema.safeParse({ ...input, amount: 1 }).success).toBe(false);
  });
});
