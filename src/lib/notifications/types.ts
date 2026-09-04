import type {
  AssessmentResult,
  CommercialPriority,
  LeadInput,
} from '../assessment/types';

export const NEW_ASSESSMENT_NOTIFICATION = 'new_assessment' as const;
export const PAID_CARD_ORDER_NOTIFICATION = 'paid_card_order' as const;
export type NotificationType = typeof NEW_ASSESSMENT_NOTIFICATION | typeof PAID_CARD_ORDER_NOTIFICATION;

export interface NewAssessmentNotificationInput {
  lead: LeadInput;
  result: AssessmentResult;
  commercialScore: number;
  commercialPriority: CommercialPriority;
  resultUrl: string;
}

export type NotificationFailureReason =
  | 'missing_configuration'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'network_error'
  | 'unexpected_error';

interface NotificationDeliveryBase {
  provider: 'telegram';
  notificationType: NotificationType;
  timestamp: string;
}

export type NotificationDeliveryResult =
  | (NotificationDeliveryBase & {
      status: 'sent';
      providerMessageId: number;
    })
  | (NotificationDeliveryBase & {
      status: 'failed';
      reason: NotificationFailureReason;
    });

export interface TelegramEnvironment {
  botToken?: string;
  chatId?: string;
}

export interface TelegramServiceOptions {
  environment?: TelegramEnvironment;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  development?: boolean;
  warn?: (message: string) => void;
  notificationType?: NotificationType;
}
