import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthKitAuth } from '@workos/authkit-astro';

const state = vi.hoisted(() => ({
  user: { id: 'synthetic-owner', email: 'owner@example.test', workos_user_id: 'workos-synthetic', status: 'active', display_name: 'Persona de prueba' } as Record<string, unknown> | null,
  revoked: false,
  marker: 'a'.repeat(64),
  roles: ['owner'] as string[],
  batch: vi.fn(),
}));
vi.mock('../db/client', () => ({
  getDatabase: () => ({
    get: async (sql: string, args?: unknown[]) => sql.includes('altaria_test_environment')
      ? { marker: state.marker } : sql.includes('altaria_admin_revoked_sessions')
        ? (state.revoked ? { session_hash: 'synthetic' } : null)
        : state.user && args?.[0] === state.user.workos_user_id
          && args?.[1] === state.user.email && args?.[2] === state.user.status ? state.user : null,
    all: async () => state.roles.map((role_key) => ({ role_key })),
    batch: state.batch,
  }),
}));

import { resolveAdminPrincipal, revokeAdminSession, type AdminPrincipal } from './access';

const auth = (change: Record<string, unknown> = {}) => ({
  user: { id: 'workos-synthetic', email: 'owner@example.test', emailVerified: true },
  sessionId: 'session-synthetic', impersonator: null, ...change,
}) as unknown as AuthKitAuth;

beforeEach(() => {
  state.user = { id: 'synthetic-owner', email: 'owner@example.test', workos_user_id: 'workos-synthetic', status: 'active', display_name: 'Persona de prueba' };
  state.revoked = false;
  state.marker = 'a'.repeat(64);
  state.roles = ['owner'];
  state.batch.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('identidad y autorización contra el repositorio', () => {
  it('sólo devuelve un usuario activo vinculado a WorkOS y a un rol', async () => {
    const principal = await resolveAdminPrincipal(auth());
    expect(principal).toMatchObject({ id: 'synthetic-owner', roles: ['owner'] });
    expect(principal?.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(principal?.sessionHash).not.toContain('session-synthetic');
  });
  it('rechaza ausencia de usuario, email no verificado, impersonación y sesión revocada', async () => {
    expect(await resolveAdminPrincipal(auth({ user: null }))).toBeNull();
    expect(await resolveAdminPrincipal(auth({ user: { id: 'x', email: 'owner@example.test', emailVerified: false } }))).toBeNull();
    expect(await resolveAdminPrincipal(auth({ impersonator: { email: 'other@example.test' } }))).toBeNull();
    state.revoked = true;
    expect(await resolveAdminPrincipal(auth())).toBeNull();
  });
  it('rechaza usuarios no aprovisionados y sin rol válido', async () => {
    state.user = null;
    expect(await resolveAdminPrincipal(auth())).toBeNull();
    state.user = { id: 'synthetic-owner', email: 'owner@example.test', workos_user_id: 'workos-synthetic', status: 'active', display_name: '' };
    state.roles = ['invented'];
    expect(await resolveAdminPrincipal(auth())).toBeNull();
    state.roles = ['toString'];
    expect(await resolveAdminPrincipal(auth())).toBeNull();
  });
  it('rechaza una cuenta con el mismo email pero distinto ID WorkOS y un email cambiado', async () => {
    expect(await resolveAdminPrincipal(auth({ user: {
      id: 'workos-other', email: 'owner@example.test', emailVerified: true,
    } }))).toBeNull();
    expect(await resolveAdminPrincipal(auth({ user: {
      id: 'workos-synthetic', email: 'other@example.test', emailVerified: true,
    } }))).toBeNull();
    state.user = { ...state.user, status: 'suspended' };
    expect(await resolveAdminPrincipal(auth())).toBeNull();
  });
  it('comprueba el marcador remoto TEST antes de resolver permisos', async () => {
    vi.stubEnv('ALTARIA_TEST_ISOLATED', '1');
    vi.stubEnv('ALTARIA_TEST_DB_MARKER', 'a'.repeat(64));
    expect(await resolveAdminPrincipal(auth())).not.toBeNull();
    state.marker = 'b'.repeat(64);
    expect(await resolveAdminPrincipal(auth())).toBeNull();
  });
  it('revoca localmente y audita en el mismo lote atómico con parámetros', async () => {
    const principal = await resolveAdminPrincipal(auth()) as AdminPrincipal;
    await revokeAdminSession(principal);
    expect(state.batch).toHaveBeenCalledTimes(1);
    const [statements, mode] = state.batch.mock.calls[0];
    expect(mode).toBe('immediate');
    expect(statements).toHaveLength(2);
    expect(statements[0].args).toContain(principal.sessionHash);
    expect(statements[1].args).toContain('admin.session.revoke');
    expect(statements[1].args).toContain('success');
  });
});
