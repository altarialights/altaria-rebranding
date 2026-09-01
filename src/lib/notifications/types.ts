import type {
  AssessmentResult,
  CommercialPriority,
  LeadInput,
} from '../assessment/types';

export const NEW_ASSESSMENT_NOTIFICATION = 'new_assessment' as const;

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
  notificationType: typeof NEW_ASSESSMENT_NOTIFICATION;
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
}
