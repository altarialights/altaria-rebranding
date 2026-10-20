import { describe, expect, it } from 'vitest';
import { createAdminCsrfToken, hasAdminPermission, hashSession, verifyAdminCsrfToken, type AdminPrincipal, type AdminRole } from './access';
import { isAdminSurface, isSafeAdminMutation, isWorkosRoute, requiredAdminPermission } from './routes';

const principal = (role: AdminRole): AdminPrincipal => ({
  id: 'synthetic-user', email: 'owner@example.test', displayName: 'Persona de prueba',
  roles: [role], sessionHash: hashSession('synthetic-session'),
});

describe('permisos administrativos de servidor', () => {
  it('sólo el propietario administra usuarios y configuración', () => {
    expect(hasAdminPermission(principal('owner'), 'users:manage')).toBe(true);
    for (const role of ['sales', 'production', 'viewer'] as const) {
      expect(hasAdminPermission(principal(role), 'users:manage')).toBe(false);
      expect(hasAdminPermission(principal(role), 'settings:read')).toBe(false);
    }
  });
  it('separa CRM y Cards según el rol', () => {
    expect(hasAdminPermission(principal('sales'), 'crm:read')).toBe(true);
    expect(hasAdminPermission(principal('sales'), 'cards:read')).toBe(false);
    expect(hasAdminPermission(principal('production'), 'cards:read')).toBe(true);
    expect(hasAdminPermission(principal('production'), 'crm:read')).toBe(false);
    expect(hasAdminPermission(principal('viewer'), 'reports:read')).toBe(true);
  });
  it('no acepta roles inventados y no expone el ID de sesión', () => {
    expect(hasAdminPermission({ ...principal('viewer'), roles: ['unknown' as AdminRole] }, 'admin:read')).toBe(false);
    expect(hashSession('synthetic-session')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSession('synthetic-session')).not.toContain('synthetic-session');
  });
  it('vincula el cierre de sesión a un token CSRF no reutilizable', () => {
    const secret = 'synthetic-cookie-secret-with-more-than-32-characters';
    const first = hashSession('session-one');
    const second = hashSession('session-two');
    const token = createAdminCsrfToken(first, secret);
    expect(verifyAdminCsrfToken(first, secret, token)).toBe(true);
    expect(verifyAdminCsrfToken(second, secret, token)).toBe(false);
    expect(verifyAdminCsrfToken(first, secret, 'invalid')).toBe(false);
    const crmToken = createAdminCsrfToken(first, secret, 'crm');
    expect(verifyAdminCsrfToken(first, secret, crmToken, 'crm')).toBe(true);
    expect(verifyAdminCsrfToken(first, secret, crmToken)).toBe(false);
  });
});

describe('superficie administrativa', () => {
  it('identifica sólo prefijos completos', () => {
    expect(isAdminSurface('/admin')).toBe(true);
    expect(isAdminSurface('/admin/crm')).toBe(true);
    expect(isAdminSurface('/api/admin/session')).toBe(true);
    expect(isAdminSurface('/administrator')).toBe(false);
    expect(isAdminSurface('/api/administer')).toBe(false);
    expect(isWorkosRoute('/auth/altaria/callback')).toBe(true);
  });
  it('asigna permisos por sección antes de entregar rutas', () => {
    expect(requiredAdminPermission('/admin/configuracion')).toBe('settings:read');
    expect(requiredAdminPermission('/admin/crm')).toBe('crm:read');
    expect(requiredAdminPermission('/admin/cards')).toBe('cards:read');
    expect(requiredAdminPermission('/admin/informes')).toBe('reports:read');
    expect(requiredAdminPermission('/api/admin/session')).toBe('admin:read');
  });
  it('rechaza mutaciones cross-site y sin origen verificable', () => {
    const url = 'http://127.0.0.1:4321/api/admin/session/revoke';
    const request = (origin?: string, site?: string, contentType = 'application/json') =>
      new Request(url, { method: 'POST', headers: {
        ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}),
        'content-type': contentType,
      } });
    expect(isSafeAdminMutation(request(url.replace('/api/admin/session/revoke', ''), 'same-origin'))).toBe(true);
    expect(isSafeAdminMutation(request('https://evil.example', 'cross-site'))).toBe(false);
    expect(isSafeAdminMutation(request())).toBe(false);
    expect(isSafeAdminMutation(request('http://127.0.0.1:4321', 'same-origin', 'text/plain'))).toBe(false);
  });
});
