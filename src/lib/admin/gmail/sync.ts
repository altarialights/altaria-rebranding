import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import type { AdminPrincipal } from '../access';
import { canWriteOrganization } from '../crm/model';
import { decryptGmailToken } from './crypto';
import { GMAIL_SCOPE } from './oauth';

export interface GmailMessage {
  id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}
export interface GmailProvider {
  profile(): Promise<{ historyId: string }>;
  list(labelId: string, pageToken?: string): Promise<{ messages?: Array<{ id: string }>; nextPageToken?: string }>;
  history(startHistoryId: string, labelId: string, pageToken?: string): Promise<{
    historyId: string; nextPageToken?: string;
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }>;
      labelsAdded?: Array<{ message: { id: string } }> }>;
  }>;
  message(id: string): Promise<GmailMessage>;
}
const header = (message: GmailMessage, name: string) => message.payload?.headers
  ?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || '';
export function emailFromHeader(value: string): string | null {
  return emailsFromHeader(value)[0] ?? null;
}
export function emailsFromHeader(value: string): string[] {
  return [...new Set((value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).slice(0, 20))];
}
const safeCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (/^gmail_provider_(401|403|404|429|500|502|503)$/.test(code)) return code;
  if (code === 'gmail_history_expired') return code;
  if (code === 'gmail_revoke_failed') return code;
  return 'gmail_sync_failed';
};
export async function recordGmailIncident(db: Connection, connectionId: string, error: unknown) {
  const code = safeCode(error); const at = new Date().toISOString();
  const existing = await db.get(`SELECT id FROM crm_gmail_sync_incidents
    WHERE connection_id = ? AND code = ? AND status = 'open'`, [connectionId, code]);
  if (!existing) await db.run(`INSERT INTO crm_gmail_sync_incidents
    (id, connection_id, code, status, occurred_at) VALUES (?, ?, ?, 'open', ?)`,
  [randomUUID(), connectionId, code, at]);
  if (code === 'gmail_provider_401' || code === 'gmail_provider_403') {
    await db.run(`UPDATE crm_gmail_connections SET status = 'needs_reauth', updated_at = ? WHERE id = ?`,
      [at, connectionId]);
  }
}
export async function createGmailProvider(refreshCiphertext: string, keyHex: string,
  clientId: string, clientSecret: string): Promise<GmailProvider> {
  const refresh = decryptGmailToken(refreshCiphertext, keyHex);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
      refresh_token: refresh, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error(`gmail_provider_${tokenResponse.status}`);
  const token = await tokenResponse.json();
  if (typeof token.access_token !== 'string'
    || (token.scope && !String(token.scope).split(' ').includes(GMAIL_SCOPE))) throw new Error('gmail_scope_missing');
  const get = async (path: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`gmail_provider_${response.status}`);
    return response.json();
  };
  return {
    profile: () => get('profile'),
    list: (labelId, pageToken) => get('messages', { labelIds: labelId, maxResults: '100', pageToken: pageToken || '' }),
    history: (historyId, labelId, pageToken) => get('history', { startHistoryId: historyId,
      labelId, maxResults: '100', pageToken: pageToken || '' }),
    message: (id) => get(`messages/${encodeURIComponent(id)}`, { format: 'metadata' }),
  };
}
async function ingest(db: Connection, principal: AdminPrincipal, connection: Record<string, unknown>,
  message: GmailMessage) {
  if (!message.id || !message.threadId || message.id.length > 200 || message.threadId.length > 200
    || !message.labelIds?.includes(String(connection.label_id))) return false;
  const senders = emailsFromHeader(header(message, 'from'));
  const recipients = emailsFromHeader(header(message, 'to'));
  const from = senders[0];
  if (!from || senders.length !== 1) return false;
  const outgoing = from === String(connection.email).toLowerCase();
  const counterparts = outgoing ? recipients : [from];
  const at = new Date().toISOString();
  const timestamp = message.internalDate && /^\d{10,16}$/.test(message.internalDate)
    ? Number(message.internalDate) : NaN;
  const receivedAt = Number.isFinite(timestamp) && timestamp > 0
    && timestamp < 8_640_000_000_000_000 ? new Date(timestamp).toISOString() : at;
  return db.transactionAsync(async (tx) => {
    const oldMessage = await tx.get('SELECT id FROM crm_gmail_messages WHERE connection_id = ? AND gmail_message_id = ?',
      [connection.id, message.id]);
    if (oldMessage) return false;
    const matches = counterparts.length ? await tx.all(`SELECT c.id, c.organization_id, o.responsible_user_id
      FROM crm_contacts c JOIN crm_organizations o ON o.id = c.organization_id
      WHERE c.email IN (${counterparts.map(() => '?').join(',')}) AND o.status = 'active'`, counterparts) : [];
    const allowed = matches.filter((row) => canWriteOrganization(principal, String(row.responsible_user_id)));
    const unique = allowed.length === 1 && counterparts.length === 1 ? allowed[0] : null;
    let thread = await tx.get('SELECT * FROM crm_gmail_threads WHERE connection_id = ? AND gmail_thread_id = ?',
      [connection.id, message.threadId]);
    const ambiguous = allowed.length > 1 || counterparts.length > 1 || (thread?.organization_id && unique
      && String(thread.organization_id) !== String(unique.organization_id));
    const status = ambiguous ? 'ambiguous' : unique ? 'matched' : 'unmatched';
    const threadId = thread ? String(thread.id) : randomUUID();
    if (!thread) {
      await tx.run(`INSERT INTO crm_gmail_threads
        (id, connection_id, gmail_thread_id, organization_id, contact_id, subject,
         association_status, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [threadId, connection.id, message.threadId, unique?.organization_id ?? null,
        unique?.id ?? null, header(message, 'subject').slice(0, 240), status, receivedAt, at, at]);
    } else {
      await tx.run(`UPDATE crm_gmail_threads SET organization_id = ?, contact_id = ?,
        association_status = ?, last_message_at = ?, updated_at = ? WHERE id = ?`,
      [ambiguous ? null : thread.organization_id ?? unique?.organization_id ?? null,
        ambiguous ? null : thread.contact_id ?? unique?.id ?? null,
        ambiguous ? 'ambiguous' : thread.association_status === 'matched' ? 'matched' : status,
        receivedAt, at, threadId]);
    }
    const inserted = await tx.run(`INSERT INTO crm_gmail_messages
      (id, connection_id, thread_id, gmail_message_id, sender_email, recipient_emails,
       direction, snippet, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, gmail_message_id) DO NOTHING`,
    [randomUUID(), connection.id, threadId, message.id, from, recipients.join(',').slice(0, 500),
      outgoing ? 'outgoing' : 'incoming', String(message.snippet || '').slice(0, 240), receivedAt, at]);
    if (Number(inserted.changes) !== 1) return false;
    if (ambiguous) {
      const incident = await tx.get(`SELECT id FROM crm_gmail_sync_incidents
        WHERE connection_id = ? AND code = 'association_ambiguous' AND status = 'open'`, [connection.id]);
      if (!incident) await tx.run(`INSERT INTO crm_gmail_sync_incidents
        (id, connection_id, code, status, occurred_at) VALUES (?, ?, 'association_ambiguous', 'open', ?)`,
      [randomUUID(), connection.id, at]);
    }
    thread = await tx.get('SELECT * FROM crm_gmail_threads WHERE id = ?', [threadId]);
    if (!outgoing && thread?.organization_id && thread?.association_status === 'matched') {
      const activityId = randomUUID();
      await tx.run(`INSERT INTO crm_activities
        (id, organization_id, opportunity_id, contact_id, kind, summary, happened_at, actor_user_id, created_at)
        VALUES (?, ?, NULL, ?, 'note', 'Respuesta recibida en Gmail CRM', ?, ?, ?)`,
      [activityId, thread.organization_id, thread.contact_id, receivedAt, principal.id, at]);
      await tx.run(`INSERT INTO crm_timeline_events
        (id, organization_id, event_type, entity_id, actor_user_id, occurred_at, details_json)
        VALUES (?, ?, 'activity.created', ?, ?, ?, '{}')`,
      [randomUUID(), thread.organization_id, activityId, principal.id, at]);
      if (thread.proposal_id) await tx.run(`UPDATE crm_tasks SET cancelled_at = ?, cancelled_by = ?,
        cancel_reason = 'gmail_reply', updated_at = ? WHERE id IN
        (SELECT f.task_id FROM crm_proposal_followups f JOIN crm_proposal_versions v ON v.id = f.version_id
         WHERE v.proposal_id = ?) AND status = 'open' AND cancelled_at IS NULL`,
      [at, principal.id, at, thread.proposal_id]);
    }
    return true;
  }).immediate();
}
export async function syncGmailConnection(db: Connection, principal: AdminPrincipal,
  connection: Record<string, unknown>, provider: GmailProvider) {
  if (connection.owner_user_id !== principal.id || connection.status !== 'connected'
    || !principal.roles.includes('owner')) throw new Error('gmail_forbidden');
  let ids: string[] = []; let nextHistory = '';
  if (connection.history_id) {
    try {
      let pageToken: string | undefined;
      do {
        const page = await provider.history(String(connection.history_id), String(connection.label_id), pageToken);
        for (const item of page.history || []) {
          ids.push(...(item.messagesAdded || []).map((entry) => entry.message.id),
            ...(item.labelsAdded || []).map((entry) => entry.message.id));
        }
        nextHistory = page.historyId; pageToken = page.nextPageToken;
        if (ids.length > 10_000) throw new Error('gmail_sync_limit');
      } while (pageToken);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'gmail_provider_404') throw error;
      ids = []; nextHistory = '';
    }
  }
  if (!nextHistory) {
    // Baseline first: changes during the full scan are picked up on the next incremental run.
    nextHistory = (await provider.profile()).historyId;
    let pageToken: string | undefined;
    do {
      const page = await provider.list(String(connection.label_id), pageToken);
      ids.push(...(page.messages || []).map((item) => item.id));
      pageToken = page.nextPageToken;
      if (ids.length > 10_000) throw new Error('gmail_sync_limit');
    } while (pageToken);
  }
  let imported = 0;
  for (const id of new Set(ids)) {
    const message = await provider.message(id);
    if (await ingest(db, principal, connection, message)) imported++;
  }
  const at = new Date().toISOString();
  await db.batch([{ sql: `UPDATE crm_gmail_connections SET history_id = ?, last_sync_at = ?, updated_at = ?
    WHERE id = ? AND status = 'connected'`, args: [nextHistory, at, at, connection.id] },
  { sql: `UPDATE crm_gmail_sync_incidents SET status = 'resolved', resolved_at = ?
    WHERE connection_id = ? AND status = 'open' AND code != 'association_ambiguous'`,
    args: [at, connection.id] }], 'immediate');
  return { imported, scanned: new Set(ids).size };
}
