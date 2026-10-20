import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../src/lib/db/client';

afterEach(() => vi.unstubAllEnvs());

describe('runtime Turso isolation', () => {
  it('rejects a direct local run even when synthetic TEST credentials are present', () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'libsql://synthetic-test.aws-eu-west-1.turso.io');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'synthetic-test-token');
    vi.stubEnv('ALTARIA_TEST_ISOLATED', '');
    expect(() => getDatabase()).toThrow(/bloqueado/);
  });

  it('rejects the known production host even if falsely marked TEST', () => {
    const productionUrl = 'libsql://altaria-digital-index-altarialights.aws-eu-west-1.turso.io';
    vi.stubEnv('TURSO_DATABASE_URL', productionUrl);
    vi.stubEnv('TURSO_AUTH_TOKEN', 'synthetic-token');
    vi.stubEnv('ALTARIA_TEST_ISOLATED', '1');
    vi.stubEnv('ALTARIA_TEST_TURSO_URL', productionUrl);
    expect(() => getDatabase()).toThrow(/producción/);
  });
});
