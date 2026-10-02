import { describe, it, expect, vi } from 'vitest';
import { cardsCatalog } from '../../data/cards-catalog';
import { canCheckoutConfiguration, isGoogleReviewUrl, type CardConfiguration } from './card-configuration';
import { cardConfigurationSchema } from './card-configuration-schema';
import { prepareCardOrderCheckout } from './checkout.service';
import type { CrearPedidoInput } from './validation';
import { ProductUnavailableError } from './catalog-pricing';
import type { PedidoTarjetas, NuevoPedidoTarjetas } from './types';

const base: CardConfiguration = { version: 2, design: 'existing', destination: 'link', artwork: 'not-required', details: { url: 'https://g.page/r/Example/review' } };
describe('Wizard commerce boundary', () => {
  for (const product of cardsCatalog) for (const design of ['own','custom','existing'] as const) for (const destination of ['link','help','create'] as const) {
    it(`${product.id} / ${design} / ${destination}`, () => {
      expect(canCheckoutConfiguration(product.id, { ...base, design, destination, details: { ...base.details, business: 'Negocio', locality: 'Madrid' } }, 'ChIJExample'))
        .toBe(design === 'existing' ? product.id === 'resenas' && destination !== 'create' : destination === 'link' || (destination === 'help' && !['acceso', 'otra-idea'].includes(product.id)));
    });
  }
  it.each(['javascript:alert(1)', 'https://g.page.evil.test/r/X/review', 'https://example.com', 'https://user:secret@g.page/r/X/review', 'http://g.page/r/X/review', 'https://search.google.com/local/writereview'])('rejects non-review URL %s', url => {
    expect(isGoogleReviewUrl(url)).toBe(false);
    expect(canCheckoutConfiguration('resenas', { ...base, details: { url } })).toBe(false);
  });
  it('unresolved help needs a proposal, resolved help retains the existing tariff', () => {
    expect(canCheckoutConfiguration('resenas', { ...base, destination: 'help' })).toBe(false);
    expect(canCheckoutConfiguration('resenas', { ...base, destination: 'help' }, 'ChIJExample')).toBe(true);
  });
  it('rejects custom work disguised as the existing model', () => {
    expect(canCheckoutConfiguration('resenas', { ...base, details: { ...base.details, instructions: 'Un diseño completamente nuevo' } })).toBe(false);
  });
  it('service independently blocks destination creation before persistence or Stripe', async () => {
    const find = vi.fn(); const create = vi.fn();
    await expect(prepareCardOrderCheckout({ productoId: 'resenas', cantidad: 1, negocio: { googlePlaceId: 'ChIJExample' }, personalizacion: { configuracion: { ...base, design: 'own', destination: 'create' } } } as CrearPedidoInput, 'https://example.com', {
      gateway: { mode: 'test', create, retrieve: vi.fn() }, findByIdempotencyKey: find,
    })).rejects.toThrow(ProductUnavailableError);
    expect(find).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('requires a creation brief and validates optional URLs without requiring every profile', () => {
    expect(cardConfigurationSchema.safeParse({ ...base, destination: 'create', details: {} }).success).toBe(false);
    expect(cardConfigurationSchema.safeParse({ ...base, design: 'custom', details: { instagram: 'https://instagram.com/example' } }).success).toBe(true);
    expect(cardConfigurationSchema.safeParse({ ...base, details: { instagram: 'not-url' } }).success).toBe(false);
  });
  it('freezes the validated URL and configuration with server prices, ignoring a conflicting client destination', async () => {
    const createPending = vi.fn(async (input: NuevoPedidoTarjetas) => ({ pedido: {
      ...input, stripeCheckoutSessionId: null,
    } as unknown as PedidoTarjetas, creado: true }));
    const gatewayCreate = vi.fn(async () => ({ id: 'cs_test_qa', url: 'https://checkout.stripe.com/c/pay/cs_test_qa', livemode: false }));
    await prepareCardOrderCheckout({
      productoId: 'resenas', cantidad: 17, claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123',
      negocio: { googlePlaceId: '', nombre: 'Negocio QA', direccion: '' },
      personalizacion: { destino: 'https://example.com/forged', configuracion: { ...base, design: 'custom' } },
    } as CrearPedidoInput, 'https://example.com', {
      gateway: { mode: 'test', create: gatewayCreate, retrieve: vi.fn() },
      findByIdempotencyKey: vi.fn(async () => null), createPending, saveSession: vi.fn(),
    });
    expect(createPending.mock.calls[0][0]).toMatchObject({
      totalCentimos: 26500, personalizacion: { destino: base.details.url, configuracion: { ...base, design: 'custom' } },
    });
    expect(gatewayCreate).toHaveBeenCalledOnce();
  });
});
