import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  gateway: {},
}));

vi.mock('../db/client', () => ({ hasTursoConfiguration: () => true }));
vi.mock('./stripe.service', () => ({ getStripeCheckoutGateway: async () => mocks.gateway }));
vi.mock('./checkout.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('./checkout.service')>();
  return { ...original, prepareCardOrderCheckout: mocks.prepare };
});

import { POST } from '../../pages/api/tarjetas/checkout';

const validRequest = {
  claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123',
  aceptaCondicionesCompra: true,
  negocio: {
    googlePlaceId: 'ChIJAltariaTest',
    nombre: 'Café Altaria',
    direccion: 'Calle de la Luz 123, Madrid',
    googleMapsUrl: 'https://maps.google.com/?cid=123',
  },
  cantidad: 17,
  cliente: { nombre: 'Martín Camarero', email: 'martin@example.com', telefono: '612345678' },
  envio: {
    direccion: 'Calle de la Luz 123',
    codigoPostal: '28001',
    ciudad: 'Madrid',
    provincia: 'Madrid',
    pais: 'ES',
  },
};

const requestFor = (body: unknown): Request => new Request('https://altarialights.com/api/tarjetas/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://altarialights.com' },
  body: JSON.stringify(body),
});

const invoke = (body: unknown): Promise<Response> => Promise.resolve(
  POST!({ request: requestFor(body) } as Parameters<NonNullable<typeof POST>>[0]),
);

describe('POST /api/tarjetas/checkout validation contract', () => {
  beforeEach(() => {
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue({
      pedidoId: 'pedido-test',
      numeroPedido: 'ALT-TRJ-TEST',
      sessionId: 'cs_test_altaria',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_altaria',
    });
  });

  it('accepts quantity 17 and a Spanish phone without +34, then returns Checkout with 200', async () => {
    const response = await invoke(validRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessionId: 'cs_test_altaria' });
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.prepare.mock.calls[0]?.[0]).toMatchObject({
      cantidad: 17,
      cliente: { telefono: '+34612345678' },
    });
  });

  it.each([
    ['aceptaCondicionesCompra', { aceptaCondicionesCompra: false }, 'Debes aceptar las Condiciones de compra para continuar.'],
    ['cliente.telefono', { cliente: { ...validRequest.cliente, telefono: 'incorrecto' } }, 'Introduce un teléfono válido.'],
    ['cliente.email', { cliente: { ...validRequest.cliente, email: 'incorrecto' } }, 'Introduce un email válido.'],
    ['envio.ciudad', { envio: { ...validRequest.envio, ciudad: '' } }, 'Introduce la localidad.'],
    ['negocio.googlePlaceId', { negocio: { ...validRequest.negocio, googlePlaceId: '' } }, 'Selecciona un negocio de la lista de Google.'],
    ['cantidad', { cantidad: 0 }, 'Elige una cantidad entre 1 y 500.'],
  ])('returns a safe field error for %s without creating a pending order', async (path, change, message) => {
    const response = await invoke({ ...validRequest, ...change });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'datos_invalidos',
      message: 'Revisa los datos indicados.',
      fields: { [path]: message },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
