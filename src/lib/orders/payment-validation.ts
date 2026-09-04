import type { CheckoutSessionData, PedidoTarjetas } from './types';

export type PaymentValidationResult =
  | 'pagado'
  | 'pago_pendiente'
  | 'importe_incorrecto'
  | 'moneda_incorrecta'
  | 'metadata_incorrecta';

export const validateCheckoutPayment = (
  pedido: PedidoTarjetas,
  session: CheckoutSessionData,
): PaymentValidationResult => {
  if (
    session.metadata.pedido_id !== pedido.id
    || session.metadata.numero_pedido !== pedido.numeroPedido
  ) return 'metadata_incorrecta';
  if (session.paymentStatus !== 'paid') return 'pago_pendiente';
  if (session.currency?.toLowerCase() !== pedido.moneda) return 'moneda_incorrecta';
  if (session.amountTotal !== pedido.totalCentimos) return 'importe_incorrecto';
  return 'pagado';
};
