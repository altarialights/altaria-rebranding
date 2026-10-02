import type { ImportesPedido } from './config';
import type { CrearPedidoInput } from './validation';
import type { StripeMode } from './stripe-mode';

// Snapshot calculado exclusivamente en servidor y conservado en el JSON existente.
export type OrderPersonalization = Omit<NonNullable<CrearPedidoInput['personalizacion']>, 'configuracion'> & {
  configuracion?: import('./card-configuration').CardConfiguration;
  tarifa?: { version: string; disenoCentimos: number };
};

export const ESTADOS_PEDIDO = [
  'pendiente_pago', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado', 'reembolsado',
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export interface PedidoTarjetas extends ImportesPedido {
  productoId?: string;
  productoNombre?: string;
  personalizacion?: OrderPersonalization;
  id: string;
  numeroPedido: string;
  claveIdempotencia: string;
  huellaSolicitud: string;
  estado: EstadoPedido;
  googlePlaceId: string;
  negocioNombre: string;
  negocioDireccion: string;
  googleMapsUrl: string | null;
  cantidad: number;
  clienteNombre: string;
  clienteEmail: string;
  clienteTelefono: string;
  envioDireccion: string;
  envioDireccionExtra: string | null;
  envioCodigoPostal: string;
  envioCiudad: string;
  envioProvincia: string;
  envioPais: 'ES';
  referenciaEnvio: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string | null;
  stripeEntorno: StripeMode;
  creadoEn: string;
  pagadoEn: string | null;
  telegramNotificadoEn: string | null;
}

export interface NuevoPedidoTarjetas extends CrearPedidoInput, ImportesPedido {
  artworkOwnerHash?: string;
  personalizacion?: OrderPersonalization;
  productoNombre?: string;
  id: string;
  numeroPedido: string;
  huellaSolicitud: string;
  creadoEn: string;
  stripeEntorno: StripeMode;
}

export interface ResumenPedidoPublico {
  productoNombre: string;
  numeroPedido: string;
  negocioNombre: string;
  cantidad: number;
  totalCentimos: number;
  moneda: 'eur';
  estado: EstadoPedido;
}

export interface CheckoutSessionData {
  id: string;
  url: string | null;
  livemode: boolean;
  clientReferenceId: string | null;
  paymentStatus: string;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  metadata: Record<string, string>;
}
