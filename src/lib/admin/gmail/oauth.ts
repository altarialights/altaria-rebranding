import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import type { AdminPrincipal } from '../access';
import { encryptGmailToken } from './crypto';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
const redirect = 'http://127.0.0.1:4321/api/admin/gmail/callback';
const businessMailbox = 'altarialights@gmail.com';
function mailboxIdentity(value: string): string | null {
  const email = value.toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  const [local, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return email;
}
export function approvedGmailTestEmail(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) return null;
  const identity = mailboxIdentity(value);
  return identity && identity !== mailboxIdentity(businessMailbox) ? value : null;
}
export interface GmailConfig { clientId: string; clientSecret: string; key: string; redirectUri: string; testEmail: string }
export function gmailConfig(): GmailConfig | null {
  const testEmail = approvedGmailTestEmail(process.env.ALTARIA_GMAIL_TEST_EMAIL);
  if (process.env.ALTARIA_TEST_ISOLATED !== '1'
    || process.env.ALTARIA_GMAIL_CONNECT_ENABLED !== '1'
    || process.env.GMAIL_OAUTH_REDIRECT_URI !== redirect
    || !/^[a-f0-9]{64}$/i.test(process.env.ALTARIA_GMAIL_TOKEN_KEY || '')
    || !testEmail || !process.env.GMAIL_OAUTH_CLIENT_ID || !process.env.GMAIL_OAUTH_CLIENT_SECRET) return null;
  return { clientId: process.env.GMAIL_OAUTH_CLIENT_ID!,
    clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!, testEmail,
    key: process.env.ALTARIA_GMAIL_TOKEN_KEY!, redirectUri: redirect };
}
const mac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');
export function beginGmailOAuth(principal: AdminPrincipal, config: NonNullable<ReturnType<typeof gmailConfig>>) {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const expires = Date.now() + 10 * 60_000;
  const payload = `${state}.${verifier}.${principal.sessionHash}.${expires}`;
  const cookie = `${Buffer.from(payload).toString('base64url')}.${mac(payload, config.key)}`;
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({ client_id: config.clientId,
    redirect_uri: config.redirectUri, response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`, access_type: 'offline',
    prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString(), cookie };
}
export function verifyGmailOAuth(cookie: string, state: string, principal: AdminPrincipal, secret: string) {
  const [encoded, signature] = cookie.split('.');
  if (!encoded || !signature) throw new Error('gmail_oauth_state');
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = mac(payload, secret);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('gmail_oauth_state');
  const [nonce, verifier, sessionHash, expiry] = payload.split('.');
  if (nonce !== state || sessionHash !== principal.sessionHash
    || !Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) throw new Error('gmail_oauth_state');
  return verifier;
}
async function googleJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`gmail_provider_${response.status}`);
  return response.json();
}
export async function finishGmailOAuth(principal: AdminPrincipal, code: string, verifier: string,
  config: NonNullable<ReturnType<typeof gmailConfig>>, db: Connection) {
  const token = await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: config.redirectUri,
      grant_type: 'authorization_code', code_verifier: verifier }),
  });
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string'
    || !String(token.scope || '').split(' ').includes(GMAIL_SCOPE)) throw new Error('gmail_scope_missing');
  const identity = await googleJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const mailboxEmail = String(identity.email || '').toLowerCase();
  if (!identity.sub || identity.email_verified !== true
    || mailboxEmail !== config.testEmail
    || approvedGmailTestEmail(mailboxEmail) !== mailboxEmail) throw new Error('gmail_identity_mismatch');
  const profile = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (String(profile.emailAddress || '').toLowerCase() !== mailboxEmail) throw new Error('gmail_identity_mismatch');
  const labels = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const label = Array.isArray(labels.labels)
    ? labels.labels.find((item: { name?: string; type?: string }) => item.name === 'ALTARIA/CRM'
      && String(item.type).toLowerCase() === 'user') : null;
  if (!label?.id) throw new Error('gmail_label_missing');
  const at = new Date().toISOString();
  const { randomUUID } = await import('node:crypto');
  const existing = await db.get('SELECT google_subject FROM crm_gmail_connections WHERE owner_user_id = ?', [principal.id]);
  if (existing && existing.google_subject !== identity.sub) throw new Error('gmail_identity_mismatch');
  await db.batch([{ sql: `INSERT INTO crm_gmail_connections
    (id, owner_user_id, google_subject, email, refresh_token_ciphertext, token_key_version,
     scope, label_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'v1', ?, ?, 'connected', ?, ?)
    ON CONFLICT(owner_user_id) DO UPDATE SET google_subject = excluded.google_subject,
      email = excluded.email, refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      token_key_version = 'v1', scope = excluded.scope, label_id = excluded.label_id,
      status = 'connected', updated_at = excluded.updated_at`,
    args: [randomUUID(), principal.id, String(identity.sub), mailboxEmail,
      encryptGmailToken(token.refresh_token, config.key), GMAIL_SCOPE, String(label.id), at, at] },
  { sql: `INSERT INTO altaria_admin_audit_events
    (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
    VALUES (?, ?, ?, ?, 'gmail.connect', 'gmail_connection', ?, 'success', '{}')`,
    args: [randomUUID(), at, principal.id, principal.sessionHash, principal.id] }], 'immediate');
}
