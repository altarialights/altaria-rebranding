import { describe, expect, it, vi } from 'vitest';
import { cardsCatalog, hasPurchasablePrice, type CardProduct } from '../../data/cards-catalog';
import { calculateCardProductPrice, ProductUnavailableError } from './catalog-pricing';
import { crearPedidoSchema } from './validation';
import { prepareCardOrderCheckout } from './checkout.service';
import { buildCheckoutSessionParams } from './stripe.service';
import type { PedidoTarjetas } from './types';

const request = {
  productoId: 'reservas', claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123', aceptaCondicionesCompra: true,
  negocio: { nombre: 'Negocio de prueba' }, cantidad: 2,
  personalizacion: { destino: 'https://example.com/reservas', notas: 'Indicaciones del pedido' },
  cliente: { nombre: 'Cliente QA', email: 'qa@example.com', telefono: '+34600000000' },
  envio: { direccion: 'Calle Prueba 1', codigoPostal: '28001', ciudad: 'Madrid', provincia: 'Madrid', pais: 'ES' },
};

describe('Altaria Cards catalog and server authorization', () => {
  it('shares the new quantity tariff across all card types', () => {
    expect(cardsCatalog.every(hasPurchasablePrice)).toBe(true);
    for (const product of cardsCatalog) {
      expect(calculateCardProductPrice(product.id, 17)).toMatchObject({ precioUnitarioCentimos: 1500, totalCentimos: 25500, envioCentimos: 0 });
    }
    expect(() => calculateCardProductPrice('inventado', 1)).toThrow(ProductUnavailableError);
  });
  it.each([null, { currency: 'eur', tiers: [{ minimum: 1, unitAmount: 0 }], shippingAmount: 0, freeShippingFrom: 2 },
    { currency: 'eur', tiers: [{ minimum: 10, unitAmount: 100 }], shippingAmount: 0, freeShippingFrom: 2 },
  ])('fails closed with incomplete or zero pricing: %j', (price) => {
    expect(hasPurchasablePrice({ ...cardsCatalog[0], price } as CardProduct)).toBe(false);
  });
  it('validates non-Google options without requiring Places and preserves preparation data', () => {
    const parsed = crearPedidoSchema.parse(request);
    expect(parsed.negocio.googlePlaceId).toBe('');
    expect(parsed.personalizacion).toEqual(request.personalizacion);
    expect(crearPedidoSchema.safeParse({ ...request, productoId: 'resenas' }).success).toBe(false);
  });
  it.each(['javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com'])('rejects unsafe destination %s', (destino) => {
    expect(crearPedidoSchema.safeParse({ ...request, personalizacion: { destino } }).success).toBe(false);
  });
  it('requires a valid WhatsApp number destination', () => {
    expect(crearPedidoSchema.safeParse({ ...request, productoId: 'whatsapp' }).success).toBe(false);
    expect(crearPedidoSchema.safeParse({ ...request, productoId: 'whatsapp', personalizacion: { destino: 'https://wa.me/34600000000' } }).success).toBe(true);
  });
  it('blocks unavailable products before persistence or Stripe even when invoked without the API', async () => {
    const create = vi.fn(); const find = vi.fn();
    await expect(prepareCardOrderCheckout(crearPedidoSchema.parse(request), 'https://example.com', {
      gateway: { mode: 'test', create, retrieve: vi.fn() }, findByIdempotencyKey: find,
    })).rejects.toThrow(ProductUnavailableError);
    expect(create).not.toHaveBeenCalled(); expect(find).not.toHaveBeenCalled();
  });
  it('uses the immutable order product and amount, without putting preparation text in metadata', () => {
    const pedido = { productoId: 'reservas', productoNombre: 'Tarjeta de reservas', cantidad: 3,
      moneda: 'eur', precioUnitarioCentimos: 1234, envioCentimos: 490, clienteEmail: 'qa@example.com', id: 'order', numeroPedido: 'QA',
      personalizacion: { notas: 'No enviar a Stripe', destino: 'https://example.com' },
    } as PedidoTarjetas;
    const params = buildCheckoutSessionParams(pedido, 'https://altarialights.com');
    expect(params.line_items?.[0]).toMatchObject({ quantity: 3, price_data: { unit_amount: 1234, product_data: { name: 'Tarjeta de reservas' } } });
    expect(JSON.stringify(params.metadata)).not.toContain('No enviar');
    expect(params.line_items?.[1]).toMatchObject({ quantity: 1, price_data: { unit_amount: 490 } });
  });
});
