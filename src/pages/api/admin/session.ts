import type { APIRoute } from 'astro';
import { hasAdminPermission } from '../../../lib/admin/access';
export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  const principal = locals.admin;
  if (!principal) return Response.json({ error: 'Autenticación requerida.' }, { status: 401 });
  return Response.json({
    user: { displayName: principal.displayName, roles: principal.roles },
    sections: ([
      ['inicio', 'admin:read'], ['crm', 'crm:read'], ['cards', 'cards:read'],
      ['informes', 'reports:read'], ['configuracion', 'settings:read'],
    ] as const).filter(([, permission]) => hasAdminPermission(principal, permission)).map(([section]) => section),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
};
