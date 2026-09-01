import {
  NEW_ASSESSMENT_NOTIFICATION,
  type NotificationDeliveryResult,
  type NotificationFailureReason,
  type TelegramEnvironment,
  type TelegramServiceOptions,
} from './types';

const DEFAULT_TIMEOUT_MS = 5_000;

const readServerEnvironment = async (): Promise<TelegramEnvironment> => {
  const { getSecret } = await import('astro:env/server');
  return {
    botToken: getSecret('TELEGRAM_BOT_TOKEN'),
    chatId: getSecret('TELEGRAM_CHAT_ID'),
  };
};

const failure = (
  reason: NotificationFailureReason,
  timestamp: string,
): NotificationDeliveryResult => ({
  status: 'failed',
  provider: 'telegram',
  notificationType: NEW_ASSESSMENT_NOTIFICATION,
  reason,
  timestamp,
});

export const sendTelegramMessage = async (
  text: string,
  options: TelegramServiceOptions = {},
): Promise<NotificationDeliveryResult> => {
  const timestamp = new Date().toISOString();
  const environment = options.environment ?? await readServerEnvironment();
  const development = options.development ?? process.env.NODE_ENV === 'development';

  if (!environment.botToken || !environment.chatId) {
    if (development) {
      (options.warn ?? console.warn)(
        '[notifications] Telegram no está configurado; se omite la notificación.',
      );
    }
    return failure('missing_configuration', timestamp);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await (options.fetchImplementation ?? fetch)(
      `https://api.telegram.org/bot${environment.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: environment.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) return failure('http_error', timestamp);

    const payload: unknown = await response.json();
    if (
      !payload
      || typeof payload !== 'object'
      || (payload as { ok?: unknown }).ok !== true
      || typeof (payload as { result?: { message_id?: unknown } }).result?.message_id !== 'number'
    ) {
      return failure('invalid_response', timestamp);
    }

    return {
      status: 'sent',
      provider: 'telegram',
      notificationType: NEW_ASSESSMENT_NOTIFICATION,
      providerMessageId: (payload as { result: { message_id: number } }).result.message_id,
      timestamp,
    };
  } catch {
    return failure(controller.signal.aborted ? 'timeout' : 'network_error', timestamp);
  } finally {
    clearTimeout(timeout);
  }
};
