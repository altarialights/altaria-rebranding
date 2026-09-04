import {
  processPaidCheckoutSession,
  recordCardOrderTelegramResult,
  type StripeEventResult,
} from '../db/card-orders.repository';
import { notifyPaidCardOrder } from '../notifications/notification.service';
import type { CheckoutSessionData, PedidoTarjetas } from './types';

interface WebhookDependencies {
  process?: typeof processPaidCheckoutSession;
  notify?: (pedido: PedidoTarjetas) => ReturnType<typeof notifyPaidCardOrder>;
  recordNotification?: typeof recordCardOrderTelegramResult;
  warn?: (message: string) => void;
}

export const handlePaidCheckout = async (
  eventId: string,
  eventType: string,
  session: CheckoutSessionData,
  dependencies: WebhookDependencies = {},
): Promise<StripeEventResult> => {
  const process = dependencies.process ?? processPaidCheckoutSession;
  const notify = dependencies.notify ?? notifyPaidCardOrder;
  const recordNotification = dependencies.recordNotification ?? recordCardOrderTelegramResult;
  const warn = dependencies.warn ?? console.warn;
  const result = await process(eventId, eventType, session);
  if (!result.notificarTelegram) return result;

  const notification = await notify(result.pedido);
  try {
    await recordNotification(
      result.pedido.id,
      eventId,
      notification.status === 'sent'
        ? { status: 'sent', timestamp: notification.timestamp, providerMessageId: notification.providerMessageId }
        : { status: 'failed', timestamp: notification.timestamp, reason: notification.reason },
    );
  } catch {
    warn(`[orders] No se pudo registrar el resultado de Telegram para ${result.pedido.numeroPedido}.`);
  }
  if (notification.status === 'failed') {
    warn(`[orders] Telegram falló para ${result.pedido.numeroPedido} (${notification.reason}).`);
  }
  return result;
};
