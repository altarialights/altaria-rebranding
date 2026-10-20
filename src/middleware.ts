import { defineMiddleware } from 'astro:middleware';
import { authkitMiddleware, configureAuthKit } from '@workos/authkit-astro';
import { hasAdminPermission, resolveAdminPrincipal, recordAdminAudit } from './lib/admin/access';
import { isAdminSurface, isSafeAdminMutation, isWorkosRoute, requiredAdminPermission } from './lib/admin/routes';

const unauthenticated = () => Response.json({ error: 'Autenticación requerida.' }, { status: 401 });
const forbidden = () => Response.json({ error: 'Acceso denegado.' }, { status: 403 });
const unavailable = () => Response.json({ error: 'El acceso privado todavía no está configurado.' }, { status: 503 });
let configured = false;

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname.replace(/\/$/, '') || '/';
  if (!isAdminSurface(path) && !isWorkosRoute(path)) return next();
  if (path === '/admin/login') return next();

  const clientId = process.env.WORKOS_CLIENT_ID;
  const apiKey = process.env.WORKOS_API_KEY;
  const redirectUri = process.env.WORKOS_REDIRECT_URI;
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
  const localTest = process.env.ALTARIA_TEST_ISOLATED === '1';
  if (!clientId?.startsWith('client_') || !apiKey || !redirectUri || !cookiePassword || cookiePassword.length < 32) {
    return unavailable();
  }
  if (localTest && (!apiKey.startsWith('sk_test_')
    || redirectUri !== 'http://127.0.0.1:4321/auth/altaria/callback')) return unavailable();
  if (!configured) {
    configureAuthKit({ clientId, apiKey, redirectUri, cookiePassword, cookieMaxAge: 12 * 60 * 60 });
    configured = true;
  }
  const workos = authkitMiddleware(async (auth, ctx, proceed) => {
    if (isWorkosRoute(path)) return proceed();
    if (!auth.user) {
      if (path.startsWith('/api/admin/')) return unauthenticated();
      return ctx.redirect('/admin/login', 303);
    }
    // Staging policies must be checked in a real Google + TOTP flow first.
    if (process.env.ALTARIA_WORKOS_MFA_VERIFIED !== '1'
      || process.env.ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED !== '1') return unavailable();
    let principal;
    try {
      principal = await resolveAdminPrincipal(auth);
    } catch {
      return unavailable();
    }
    if (!principal) return forbidden();
    const permission = requiredAdminPermission(path);
    if (!hasAdminPermission(principal, permission)) {
      try { await recordAdminAudit(principal, 'admin.access.denied', 'denied', 'route', path); } catch { return unavailable(); }
      return forbidden();
    }
    if (path.startsWith('/api/admin/') && !isSafeAdminMutation(ctx.request)) return forbidden();
    ctx.locals.admin = principal;
    return proceed();
  }, { signInPath: '/admin/login' });
  const response = await workos(context, next);
  if (!response) return unavailable();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
});
