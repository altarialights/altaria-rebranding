import type { APIRoute } from 'astro';
import { getWorkOS } from '@workos/authkit-astro';
import { revokeAdminSession, verifyAdminCsrfToken } from '../../../../lib/admin/access';
export const prerender = false;

export const POST: APIRoute = async (context) => {
  const principal = context.locals.admin;
  const auth = context.locals.auth;
  if (!principal || !auth?.user || !auth.sessionId) return new Response(null, { status: 401 });
  const secret = process.env.WORKOS_COOKIE_PASSWORD || '';
  const data = await context.request.formData().catch(() => null);
  const candidate = data?.get('csrf');
  if (typeof candidate !== 'string' || !verifyAdminCsrfToken(principal.sessionHash, secret, candidate)) {
    return new Response(null, { status: 403 });
  }
  try {
    await revokeAdminSession(principal);
    try { await getWorkOS().userManagement.revokeSession({ sessionId: auth.sessionId }); }
    catch { console.error('[altaria-os] La sesión se bloqueó localmente; revocación remota pendiente.'); }
    context.cookies.delete('wos-session', { path: '/' });
    return context.redirect('/admin/login?closed=1', 303);
  } catch {
    return new Response(null, { status: 503 });
  }
};
