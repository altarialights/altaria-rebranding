import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../../lib/db/client';
import { hasAdminPermission, recordAdminAudit, verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { createLocalDraft, GmailError, linkGmailThread, updateLocalDraft } from '../../../../lib/admin/gmail/service';
import { decryptGmailToken } from '../../../../lib/admin/gmail/crypto';
import { beginGmailOAuth, finishGmailOAuth, gmailConfig, verifyGmailOAuth } from '../../../../lib/admin/gmail/oauth';
import { createGmailProvider, recordGmailIncident, syncGmailConnection } from '../../../../lib/admin/gmail/sync';
export const prerender = false;
const value = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const oauthCookie = 'altaria_gmail_oauth';
export const GET: APIRoute = async (context) => {
  if (context.params.action !== 'callback') return new Response('No encontrado.', { status: 404 });
  const principal = context.locals.admin;
  const config = gmailConfig();
  if (!principal?.roles.includes('owner') || !config) return new Response('Gmail staging no configurado.', { status: 403 });
  const state = context.url.searchParams.get('state') || '';
  const code = context.url.searchParams.get('code') || '';
  const cookie = context.cookies.get(oauthCookie)?.value || '';
  context.cookies.delete(oauthCookie, { path: '/api/admin/gmail' });
  try {
    if (!state || !code) throw new Error('gmail_oauth_missing');
    const verifier = verifyGmailOAuth(cookie, state, principal, config.key);
    await finishGmailOAuth(principal, code, verifier, config, getDatabase());
    return context.redirect('/admin/crm/propuestas?gmail=connected', 303);
  } catch {
    try { await recordAdminAudit(principal, 'gmail.connect', 'failure', 'gmail_connection', principal.id); }
    catch { return new Response('No se pudo auditar la conexión.', { status: 503 }); }
    return context.redirect('/admin/crm/propuestas?gmail=error', 303);
  }
};
export const POST: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal || !hasAdminPermission(principal, 'crm:write')) return Response.json({ error: 'Acceso denegado.' }, { status: 403 });
  if (Number(context.request.headers.get('content-length') || 0) > 30_000) return Response.json({ error: 'Formulario demasiado grande.' }, { status: 413 });
  const data = await context.request.formData().catch(() => null);
  if (!data || !verifyAdminCsrfToken(principal.sessionHash, process.env.WORKOS_COOKIE_PASSWORD || '',
    value(data, 'csrf'), 'crm')) return Response.json({ error: 'Solicitud no autorizada.' }, { status: 403 });
  const action = context.params.action;
  try {
    let redirect = '/admin/crm/propuestas';
    if (action === 'connect') {
      if (!principal.roles.includes('owner')) throw new GmailError('forbidden', 403);
      const config = gmailConfig();
      if (!config) throw new GmailError('not_configured', 409);
      const pending = beginGmailOAuth(principal, config);
      context.cookies.set(oauthCookie, pending.cookie, { httpOnly: true, sameSite: 'lax',
        secure: false, path: '/api/admin/gmail', maxAge: 600 });
      return context.redirect(pending.url, 303);
    }
    if (action === 'sync') {
      if (!principal.roles.includes('owner')) throw new GmailError('forbidden', 403);
      const config = gmailConfig();
      if (!config) throw new GmailError('not_configured', 409);
      const db = getDatabase();
      const connection = await db.get('SELECT * FROM crm_gmail_connections WHERE owner_user_id = ?', [principal.id]);
      if (!connection || connection.status !== 'connected') throw new GmailError('not_connected', 409);
      try {
        const provider = await createGmailProvider(String(connection.refresh_token_ciphertext),
          config.key, config.clientId, config.clientSecret);
        await syncGmailConnection(db, principal, connection, provider);
        await db.run(`INSERT INTO altaria_admin_audit_events
          (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
          VALUES (?, ?, ?, ?, 'gmail.sync', 'gmail_connection', ?, 'success', '{}')`,
        [randomUUID(), new Date().toISOString(), principal.id, principal.sessionHash, connection.id]);
      } catch (error) {
        await recordGmailIncident(db, String(connection.id), error);
        await recordAdminAudit(principal, 'gmail.sync', 'failure', 'gmail_connection', String(connection.id));
        throw new GmailError('sync_failed', 503);
      }
      redirect = '/admin/crm/propuestas?gmail=synced';
    } else if (action === 'disconnect') {
      if (!principal.roles.includes('owner')) throw new GmailError('forbidden', 403);
      const db = getDatabase();
      const connection = await db.get('SELECT * FROM crm_gmail_connections WHERE owner_user_id = ?', [principal.id]);
      if (!connection) throw new GmailError('not_connected', 409);
      let revokeFailed = false;
      const config = gmailConfig();
      if (config && connection.status === 'connected') {
        try {
          const refresh = decryptGmailToken(String(connection.refresh_token_ciphertext), config.key);
          const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refresh }), signal: AbortSignal.timeout(15_000) });
          revokeFailed = !response.ok;
        } catch { revokeFailed = true; }
      } else revokeFailed = connection.status === 'connected';
      const at = new Date().toISOString();
      await db.batch([{ sql: `UPDATE crm_gmail_connections SET status = 'disconnected',
        refresh_token_ciphertext = 'disconnected', history_id = NULL, updated_at = ?
        WHERE owner_user_id = ?`, args: [at, principal.id] },
      { sql: `INSERT INTO altaria_admin_audit_events
        (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
        VALUES (?, ?, ?, ?, 'gmail.disconnect', 'gmail_connection', ?, 'success', '{}')`,
        args: [randomUUID(), at, principal.id, principal.sessionHash, connection.id] }], 'immediate');
      if (revokeFailed) await recordGmailIncident(db, String(connection.id), new Error('gmail_revoke_failed'));
      redirect = '/admin/crm/propuestas?gmail=disconnected';
    } else if (action === 'draft') {
      const organizationId = value(data, 'organizationId');
      const contactId = value(data, 'contactId');
      const proposalId = value(data, 'proposalId') || null;
      const threadId = value(data, 'threadId') || null;
      if (![organizationId, contactId, proposalId, threadId].every((id) => !id || uuid(id))) throw new GmailError('invalid_input');
      await createLocalDraft(principal, { organizationId, contactId, proposalId, threadId,
        subject: value(data, 'subject'), body: value(data, 'body') });
      redirect = `/admin/crm/empresas/${organizationId}?saved=draft#communications`;
    } else if (action === 'draft-update') {
      const draftId = value(data, 'draftId');
      const status = value(data, 'status');
      if (!uuid(draftId) || !['review', 'approved', 'archived'].includes(status)) throw new GmailError('invalid_input');
      const organizationId = await updateLocalDraft(principal, draftId, {
        subject: value(data, 'subject'), body: value(data, 'body'), status: status as 'review' | 'approved' | 'archived',
      });
      redirect = status === 'archived' ? `/admin/crm/empresas/${organizationId}#communications`
        : `/admin/crm/borradores/${draftId}?saved=1`;
    } else if (action === 'link-thread') {
      const organizationId = value(data, 'organizationId');
      const threadId = value(data, 'threadId');
      const contactId = value(data, 'contactId') || null;
      const proposalId = value(data, 'proposalId') || null;
      if (![organizationId, threadId, contactId, proposalId].every((id) => !id || uuid(id))) throw new GmailError('invalid_input');
      await linkGmailThread(principal, { organizationId, threadId, contactId, proposalId });
      redirect = `/admin/crm/empresas/${organizationId}?saved=thread#communications`;
    } else throw new GmailError('invalid_input', 404);
    return context.redirect(redirect, 303);
  } catch (error) {
    const status = error instanceof GmailError ? error.status : 503;
    return Response.json({ error: error instanceof GmailError && error.code === 'channel_blocked'
      ? 'Existe una oposición o bloqueo para este canal.' : status === 403 ? 'Acceso denegado.' :
      status === 409 ? 'Gmail staging aún no está preparado o conectado.' : 'No se pudo completar la operación.' }, { status });
  }
};
