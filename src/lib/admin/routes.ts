import type { AdminPermission } from './access';

export function isAdminSurface(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
    || pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export function isWorkosRoute(pathname: string): boolean {
  return pathname === '/auth/altaria/login' || pathname === '/auth/altaria/callback'
    || pathname === '/auth/altaria/logout';
}

export function requiredAdminPermission(pathname: string): AdminPermission {
  if (pathname === '/admin/contenido' || pathname.startsWith('/admin/contenido/')
    || pathname === '/api/admin/content' || pathname.startsWith('/api/admin/content/')) {
    return 'content:read';
  }
  if (pathname === '/admin/configuracion' || pathname.startsWith('/admin/configuracion/')
    || pathname === '/api/admin/configuracion' || pathname.startsWith('/api/admin/configuracion/')) {
    return 'settings:read';
  }
  if (pathname === '/admin/crm' || pathname.startsWith('/admin/crm/')
    || pathname === '/api/admin/crm' || pathname.startsWith('/api/admin/crm/')
    || pathname.startsWith('/api/admin/proposals/')
    || pathname.startsWith('/api/admin/gmail/')) return 'crm:read';
  if (pathname === '/admin/cards' || pathname.startsWith('/admin/cards/')
    || pathname === '/api/admin/cards' || pathname.startsWith('/api/admin/cards/')) return 'cards:read';
  if (pathname === '/admin/informes' || pathname.startsWith('/admin/informes/')) return 'reports:read';
  return 'admin:read';
}

export function isSafeAdminMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const contentType = request.headers.get('content-type') || '';
  return origin === new URL(request.url).origin
    && (site === null || site === 'same-origin')
    && (contentType.startsWith('application/json') || contentType.startsWith('application/x-www-form-urlencoded')
      || request.method==='POST'&&new URL(request.url).pathname==='/api/admin/content/upload'
        &&contentType.startsWith('multipart/form-data'));
}
