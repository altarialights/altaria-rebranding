import { describe, expect, it } from 'vitest';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase, assertTestMarkerFormat, assertTestStripe, tursoHost } from '../scripts/lib/test-isolation.mjs';
import { assertLocalQaUrl } from '../scripts/lib/local-qa-url.mjs';

const production = {
  TURSO_DATABASE_URL: 'libsql://altaria-digital-index-altarialights.aws-eu-west-1.turso.io',
  TURSO_AUTH_TOKEN: 'synthetic-production-token',
  STRIPE_SECRET_KEY: 'sk_live_synthetic',
  STRIPE_WEBHOOK_SECRET: 'whsec_synthetic-production',
};
const testUrl = 'libsql://altaria-os-test-synthetic.aws-eu-west-1.turso.io';
const database = (overrides = {}) => ({
  targetUrl: testUrl,
  approvedUrl: testUrl,
  token: 'synthetic-test-token',
  productionEnv: production,
  ...overrides,
});

describe('Turso TEST preflight', () => {
  it('accepts only the separate, explicitly pinned synthetic TEST host', () => {
    expect(assertTestDatabase(database())).toBe(tursoHost(testUrl));
  });
  it.each([
    { targetUrl: production.TURSO_DATABASE_URL, approvedUrl: production.TURSO_DATABASE_URL },
    { approvedUrl: 'libsql://different-test.aws-eu-west-1.turso.io' },
    { token: production.TURSO_AUTH_TOKEN },
    { targetUrl: 'file:///tmp/test.db', approvedUrl: 'file:///tmp/test.db' },
    { targetUrl: `${testUrl}/other`, approvedUrl: `${testUrl}/other` },
    { targetUrl: `${testUrl}?x=1`, approvedUrl: `${testUrl}?x=1` },
    { approvedUrl: testUrl.replace('libsql:', 'https:') },
    { targetUrl: 'libsql://another-synthetic.aws-eu-west-1.turso.io', approvedUrl: 'libsql://another-synthetic.aws-eu-west-1.turso.io' },
    { productionEnv: null },
  ])('rejects a production, mismatched or ambiguous destination', (change) => {
    expect(() => assertTestDatabase(database(change))).toThrow();
  });
  it('checks the remote marker before any product operation', async () => {
    const marker = 'a'.repeat(64);
    expect(() => assertTestMarkerFormat(marker)).not.toThrow();
    expect(() => assertTestMarkerFormat('REPLACE_WITH_MARKER')).toThrow();
    await expect(assertRemoteTestMarker({ get: async () => ({ marker }) }, marker)).resolves.toBeUndefined();
    await expect(assertRemoteTestMarker({ get: async () => ({ marker: 'b'.repeat(64) }) }, marker)).rejects.toThrow();
    await expect(assertRemoteTestMarker({ get: async () => { throw Error('missing'); } }, marker)).rejects.toThrow();
    await expect(assertRemoteTestMarker({ get: async () => ({ marker }) }, 'invalid')).rejects.toThrow();
  });
});

describe('Stripe TEST preflight', () => {
  const stripe = { mode: 'test', secretKey: 'sk_test_synthetic', webhookSecret: 'whsec_synthetic-test', productionEnv: production };
  it('accepts synthetic test credentials', () => expect(() => assertTestStripe(stripe)).not.toThrow());
  it.each([
    { mode: 'live', secretKey: production.STRIPE_SECRET_KEY },
    { secretKey: production.STRIPE_SECRET_KEY },
    { webhookSecret: production.STRIPE_WEBHOOK_SECRET },
    { secretKey: 'sk_test_...' },
    { secretKey: 'sk_test_REPLACE' },
    { webhookSecret: 'whsec_REPLACE' },
    { mode: undefined },
    { productionEnv: null },
  ])('rejects live, reused, placeholder or ambiguous credentials', (change) => {
    expect(() => assertTestStripe({ ...stripe, ...change })).toThrow();
  });
});

describe('WorkOS staging preflight', () => {
  const staging = {
    clientId: 'client_SYNTHETIC123', apiKey: 'sk_test_synthetic',
    redirectUri: 'http://127.0.0.1:4321/auth/altaria/callback',
    cookiePassword: 'synthetic-cookie-password-longer-than-32-characters',
    productionEnv: { WORKOS_CLIENT_ID: 'client_PRODUCTION123', WORKOS_API_KEY: 'sk_live_synthetic' },
  };
  it('accepts only synthetic staging credentials', () => expect(() => assertStagingWorkOS(staging)).not.toThrow());
  it.each([
    { apiKey: 'sk_live_synthetic' }, { apiKey: 'sk_test_REPLACE' },
    { clientId: 'client_PRODUCTION123' }, { redirectUri: 'https://altarialights.com/callback' },
    { cookiePassword: 'short' },
  ])('rejects live, reused or ambiguous configuration', (change) => {
    expect(() => assertStagingWorkOS({ ...staging, ...change })).toThrow();
  });
});

describe('Browser QA destination', () => {
  it('accepts loopback and rejects public, ambiguous or production URLs', () => {
    expect(() => assertLocalQaUrl('http://127.0.0.1:4321/')).not.toThrow();
    expect(() => assertLocalQaUrl('http://localhost:4321/')).not.toThrow();
    for (const url of ['https://altarialights.com', 'http://altarialights.com', 'https://localhost:4321', 'http://user@localhost:4321']) {
      expect(() => assertLocalQaUrl(url)).toThrow();
    }
  });
});
