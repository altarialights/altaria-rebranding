import { formatNewAssessmentTelegramMessage } from './templates';
import { sendTelegramMessage } from './telegram.service';
import {
  NEW_ASSESSMENT_NOTIFICATION,
  type NewAssessmentNotificationInput,
  type NotificationDeliveryResult,
  type TelegramServiceOptions,
} from './types';

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
