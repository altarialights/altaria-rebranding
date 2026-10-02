import { findPaidOrderArtwork } from '../db/card-artwork.repository';
import { formatNewAssessmentTelegramMessage, formatPaidCardOrderTelegramMessage } from './templates';
import { sendTelegramMessage } from './telegram.service';
import {
  NEW_ASSESSMENT_NOTIFICATION,
  PAID_CARD_ORDER_NOTIFICATION,
  type NewAssessmentNotificationInput,
  type NotificationDeliveryResult,
  type TelegramServiceOptions,
} from './types';
import type { PedidoTarjetas } from '../orders/types';

export const notifyNewAssessment = async (
  input: NewAssessmentNotificationInput,
  options?: TelegramServiceOptions,
): Promise<NotificationDeliveryResult> => {
  try {
    return await sendTelegramMessage(formatNewAssessmentTelegramMessage(input), options);
  } catch {
    return {
      status: 'failed',
      provider: 'telegram',
      notificationType: NEW_ASSESSMENT_NOTIFICATION,
      reason: 'unexpected_error',
      timestamp: new Date().toISOString(),
    };
  }
};

export const notifyPaidCardOrder = async (
  pedido: PedidoTarjetas,
  options?: TelegramServiceOptions,
): Promise<NotificationDeliveryResult> => {
  try {
    const notification = await sendTelegramMessage(formatPaidCardOrderTelegramMessage(pedido), {
      ...options,
      notificationType: PAID_CARD_ORDER_NOTIFICATION,
    });
    if (notification.status !== 'sent' || !pedido.personalizacion?.configuracion?.artworkFile) return notification;
    const file = await findPaidOrderArtwork(pedido.id);
    if (!file) throw new Error('Associated artwork missing');
    const attachment = await sendTelegramMessage(
      `Original del pedido ${pedido.numeroPedido} ? ${file.status === 'review' ? 'Requiere revisi?n' : 'Dise?o recibido'}`,
      {...options, timeoutMs: options?.timeoutMs ?? 15000, notificationType: PAID_CARD_ORDER_NOTIFICATION},
      {...file,replyTo:notification.providerMessageId},
    );
    return attachment.status === 'failed' ? attachment : notification;
  } catch {
    return {
      status: 'failed',
      provider: 'telegram',
      notificationType: PAID_CARD_ORDER_NOTIFICATION,
      reason: 'unexpected_error',
      timestamp: new Date().toISOString(),
    };
  }
};
