/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  readonly ASSESSMENT_DEMO_MODE?: string;
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly TELEGRAM_CHAT_ID?: string;
  readonly PUBLIC_GOOGLE_MAPS_API_KEY?: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_MODE?: 'test' | 'live';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
