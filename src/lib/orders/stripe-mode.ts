export const STRIPE_MODES = ['test', 'live'] as const;

export type StripeMode = (typeof STRIPE_MODES)[number];

export const parseStripeMode = (value: string | undefined): StripeMode => {
  if (value === 'test' || value === 'live') return value;
  throw new Error('STRIPE_MODE debe estar configurado como test o live.');
};

export const readStripeMode = async (): Promise<StripeMode> => {
  const { getSecret } = await import('astro:env/server');
  return parseStripeMode(getSecret('STRIPE_MODE')?.trim());
};

export const stripeModeIsLive = (mode: StripeMode): boolean => mode === 'live';

export const assertStripeSecretForMode = (mode: StripeMode, secretKey: string): void => {
  const expectedPrefix = mode === 'live' ? 'sk_live_' : 'sk_test_';
  if (!secretKey.startsWith(expectedPrefix)) {
    throw new Error(`La clave secreta de Stripe no coincide con STRIPE_MODE=${mode}.`);
  }
};

export const assertStripeLivemode = (mode: StripeMode, livemode: boolean): void => {
  if (livemode !== stripeModeIsLive(mode)) {
    throw new Error(`El objeto de Stripe no coincide con STRIPE_MODE=${mode}.`);
  }
};

export const stripeEnvironmentMatches = (mode: StripeMode, livemode: boolean): boolean =>
  livemode === stripeModeIsLive(mode);
