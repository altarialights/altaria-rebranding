import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthKitAuth } from '@workos/authkit-astro';
import { getDatabase } from '../db/client';

export type AdminRole = 'owner' | 'sales' | 'production' | 'viewer';
export type AdminPermission = 'admin:read' | 'content:read' | 'crm:read' | 'crm:write' | 'cards:read' | 'cards:write' | 'cards:artwork' | 'reports:read' | 'settings:read' | 'users:manage' | 'audit:read';
export interface ContentGrant {
  brandId: string;
  read: boolean;
  edit: boolean;
  review: boolean;
  recordPublication: boolean;
  manageBrand: boolean;
}
export interface AdminPrincipal {
  id: string;
  email: string;
  displayName: string;
  roles: AdminRole[];
  sessionHash: string;
  contentGrants?: ContentGrant[];
}

const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  owner: ['admin:read', 'crm:read', 'crm:write', 'cards:read', 'cards:write', 'cards:artwork', 'reports:read', 'settings:read', 'users:manage', 'audit:read'],
  sales: ['admin:read', 'crm:read', 'crm:write', 'reports:read'],
  production: ['admin:read', 'cards:read', 'cards:write', 'cards:artwork'],
  viewer: ['admin:read', 'crm:read', 'cards:read', 'reports:read'],
};

export function hasAdminPermission(principal: AdminPrincipal, permission: AdminPermission): boolean {
  if (permission === 'content:read') return principal.roles.includes('owner')
    || Boolean(principal.contentGrants?.some((grant) => grant.read));
  if (permission === 'admin:read' && principal.contentGrants?.some((grant) => grant.read)) return true;
  return principal.roles.some((role) => rolePermissions[role]?.includes(permission));
}

export function hashSession(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export function createAdminCsrfToken(sessionHash: string, secret: string,
  purpose: 'session-revoke' | 'crm' | 'cards' | 'automations' | 'content' = 'session-revoke'): string {
  if (secret.length < 32) throw new Error('Se requiere secreto de sesión válido.');
  return createHmac('sha256', secret).update(`admin-${purpose}:${sessionHash}`).digest('hex');
}

export function verifyAdminCsrfToken(sessionHash: string, secret: string, candidate: string,
  purpose: 'session-revoke' | 'crm' | 'cards' | 'automations' | 'content' = 'session-revoke'): boolean {
  if (!/^[a-f0-9]{64}$/.test(candidate)) return false;
  const expected = Buffer.from(createAdminCsrfToken(sessionHash, secret, purpose), 'hex');
  return timingSafeEqual(expected, Buffer.from(candidate, 'hex'));
}

export async function resolveAdminPrincipal(auth: AuthKitAuth): Promise<AdminPrincipal | null> {
  if (!auth.user || auth.user.emailVerified !== true || auth.impersonator || !auth.sessionId) return null;
  const email = auth.user.email?.trim().toLowerCase();
  if (!email || !auth.user.id) return null;
  const db = getDatabase();
  if (process.env.ALTARIA_TEST_ISOLATED === '1') {
    const marker = process.env.ALTARIA_TEST_DB_MARKER;
    if (!/^[a-f0-9]{64}$/.test(marker || '')) return null;
    const remoteMarker = await db.get('SELECT marker FROM altaria_test_environment WHERE id = ?', ['test']);
    if (remoteMarker?.marker !== marker) return null;
  }
  const row = await db.get(
    `SELECT id, email, COALESCE(display_name, '') AS display_name
       FROM altaria_admin_users
      WHERE workos_user_id = ? AND email = ? AND status = ?`,
    [auth.user.id, email, 'active'],
  );
  if (!row) return null;
  const sessionHash = hashSession(auth.sessionId);
  const revoked = await db.get(
    'SELECT session_hash FROM altaria_admin_revoked_sessions WHERE session_hash = ? AND expires_at > ?',
    [sessionHash, new Date().toISOString()],
  );
  if (revoked) return null;
  const memberships = await db.all(
    'SELECT role_key FROM altaria_admin_user_roles WHERE user_id = ?', [String(row.id)],
  );
  const roles = memberships.map((membership) => String(membership.role_key))
    .filter((value): value is AdminRole => Object.hasOwn(rolePermissions, value));
  const contentRows = await db.all(`SELECT m.brand_id,m.can_read,m.can_edit,m.can_review,
      m.can_record_publication,m.can_manage_brand FROM content_brand_memberships m
      JOIN content_brands b ON b.id=m.brand_id
      WHERE m.user_id=? AND m.revoked_at IS NULL AND b.status='active'`,[String(row.id)]);
  const contentGrants: ContentGrant[] = contentRows.map((grant) => ({
    brandId:String(grant.brand_id),read:Boolean(grant.can_read),edit:Boolean(grant.can_edit),
    review:Boolean(grant.can_review),recordPublication:Boolean(grant.can_record_publication),
    manageBrand:Boolean(grant.can_manage_brand),
  }));
  if (roles.length === 0 && !contentGrants.some((grant) => grant.read)) return null;
  return {
    id: String(row.id), email: String(row.email),
    displayName: String(row.display_name || email), roles, sessionHash, contentGrants,
  };
}

export async function recordAdminAudit(
  principal: AdminPrincipal,
  action: string,
  outcome: 'success' | 'denied' | 'failure',
  targetType: string | null = null,
  targetId: string | null = null,
): Promise<void> {
  await getDatabase().run(`INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), new Date().toISOString(), principal.id, principal.sessionHash,
    action, targetType, targetId, outcome, '{}');
}

export async function revokeAdminSession(principal: AdminPrincipal): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await getDatabase().batch([
    { sql: `INSERT INTO altaria_admin_revoked_sessions (session_hash, revoked_at, expires_at, actor_user_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(session_hash) DO NOTHING`,
      args: [principal.sessionHash, now.toISOString(), expires.toISOString(), principal.id] },
    { sql: `INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), now.toISOString(), principal.id, principal.sessionHash,
        'admin.session.revoke', 'session', principal.sessionHash, 'success', '{}'] },
  ], 'immediate');
}
