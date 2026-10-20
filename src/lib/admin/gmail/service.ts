import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { canReadOrganization, canWriteOrganization } from '../crm/model';

export class GmailError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export async function listCompanyCommunications(principal: AdminPrincipal, organizationId: string,
  db: Connection = getDatabase()) {
  const org = await db.get('SELECT responsible_user_id FROM crm_organizations WHERE id = ? AND status = ?',
    [organizationId, 'active']);
  if (!org || !hasAdminPermission(principal, 'crm:read')
    || !canReadOrganization(principal, String(org.responsible_user_id))) throw new GmailError('forbidden', 403);
  const [threads, drafts] = await Promise.all([
    db.all(`SELECT t.*, COUNT(m.id) AS message_count FROM crm_gmail_threads t
      LEFT JOIN crm_gmail_messages m ON m.thread_id = t.id WHERE t.organization_id = ?
      GROUP BY t.id ORDER BY t.last_message_at DESC LIMIT 50`, [organizationId]),
    db.all(`SELECT id, recipient_email, subject, status, updated_at, proposal_id
      FROM crm_gmail_drafts WHERE organization_id = ? AND status != 'archived'
      ORDER BY updated_at DESC LIMIT 50`, [organizationId]),
  ]);
  return { threads, drafts };
}
export async function createLocalDraft(principal: AdminPrincipal, input: {
  organizationId: string; contactId: string; proposalId: string | null;
  threadId: string | null; subject: string; body: string;
  salesSource?: { entryId: string; versionId: string; opportunityId: string | null };
}, db: Connection = getDatabase()) {
  if (!hasAdminPermission(principal, 'crm:write')) throw new GmailError('forbidden', 403);
  if (input.subject.trim().length < 2 || input.subject.length > 240
    || input.body.trim().length < 5 || input.body.length > 10_000) throw new GmailError('invalid_input');
  return db.transactionAsync(async (tx) => {
    const org = await tx.get(`SELECT responsible_user_id FROM crm_organizations
      WHERE id = ? AND status = 'active'`, [input.organizationId]);
    if (!org || !canWriteOrganization(principal, String(org.responsible_user_id))) throw new GmailError('forbidden', 403);
    const contact = await tx.get('SELECT email FROM crm_contacts WHERE id = ? AND organization_id = ?',
      [input.contactId, input.organizationId]);
    if (!contact?.email) throw new GmailError('contact_email_missing');
    const channelReviews = await tx.all(`SELECT r.decision FROM crm_contact_channel_reviews r
      WHERE r.organization_id = ? AND r.channel = 'email'
        AND (r.contact_id IS NULL OR r.contact_id = ?)
        AND r.rowid = (SELECT x.rowid FROM crm_contact_channel_reviews x
          WHERE x.organization_id = r.organization_id AND x.channel = r.channel
            AND x.contact_id IS r.contact_id
          ORDER BY x.occurred_at DESC, x.rowid DESC LIMIT 1)`,
      [input.organizationId,input.contactId]);
    if (channelReviews.some(row => row.decision === 'blocked' || row.decision === 'opposed')) {
      throw new GmailError('channel_blocked', 403);
    }
    if (input.proposalId) {
      const proposal = await tx.get('SELECT id FROM crm_proposals WHERE id = ? AND organization_id = ?',
        [input.proposalId, input.organizationId]);
      if (!proposal) throw new GmailError('proposal_mismatch');
    }
    if (input.threadId) {
      const thread = await tx.get(`SELECT id FROM crm_gmail_threads WHERE id = ? AND organization_id = ?
        AND association_status = 'matched'`, [input.threadId, input.organizationId]);
      if (!thread) throw new GmailError('thread_mismatch');
    }
    if (input.salesSource) {
      const source = await tx.get(`SELECT v.id FROM crm_sales_entry_versions v
        JOIN crm_sales_entries e ON e.id=v.entry_id
        WHERE v.id=? AND e.id=? AND e.status!='retired'
          AND (e.approved_version=v.version OR ?=1)`,
        [input.salesSource.versionId,input.salesSource.entryId,principal.roles.includes('owner')?1:0]);
      if (!source) throw new GmailError('sales_source_invalid', 409);
      if (input.salesSource.opportunityId) {
        const opportunity = await tx.get(`SELECT id FROM crm_opportunities
          WHERE id=? AND organization_id=?`,[input.salesSource.opportunityId,input.organizationId]);
        if (!opportunity) throw new GmailError('opportunity_mismatch',409);
      }
    }
    const id = randomUUID(); const at = new Date().toISOString();
    const statements = [{ sql: `INSERT INTO crm_gmail_drafts
      (id, organization_id, thread_id, proposal_id, recipient_email, subject, body,
       created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.organizationId, input.threadId, input.proposalId, contact.email,
      input.subject.trim(), input.body.trim(), principal.id, at, at] },
    { sql: `INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, 'gmail.draft.create', 'gmail_draft', ?, 'success', '{}')`,
      args: [randomUUID(), at, principal.id, principal.sessionHash, id] }];
    if (input.salesSource) statements.push({sql:`INSERT INTO crm_sales_draft_sources
      (draft_id,entry_id,version_id,organization_id,opportunity_id,created_by,created_at)
      VALUES(?,?,?,?,?,?,?)`,args:[id,input.salesSource.entryId,input.salesSource.versionId,
        input.organizationId,input.salesSource.opportunityId,principal.id,at]});
    await tx.batch(statements);
    return id;
  }).immediate();
}
export async function linkGmailThread(principal: AdminPrincipal, input: {
  threadId: string; organizationId: string; contactId: string | null; proposalId: string | null;
}, db: Connection = getDatabase()) {
  if (!principal.roles.includes('owner') || !hasAdminPermission(principal, 'crm:write')) throw new GmailError('forbidden', 403);
  return db.transactionAsync(async (tx) => {
    const org = await tx.get('SELECT responsible_user_id FROM crm_organizations WHERE id = ? AND status = ?',
      [input.organizationId, 'active']);
    if (!org || !canWriteOrganization(principal, String(org.responsible_user_id))) throw new GmailError('forbidden', 403);
    const thread = await tx.get(`SELECT t.id, t.organization_id FROM crm_gmail_threads t
      JOIN crm_gmail_connections c ON c.id = t.connection_id
      WHERE t.id = ? AND c.owner_user_id = ?`, [input.threadId, principal.id]);
    if (!thread) throw new GmailError('thread_missing', 404);
    if (thread.organization_id && thread.organization_id !== input.organizationId) throw new GmailError('thread_mismatch', 409);
    if (input.contactId) {
      const contact = await tx.get('SELECT id FROM crm_contacts WHERE id = ? AND organization_id = ?',
        [input.contactId, input.organizationId]);
      if (!contact) throw new GmailError('contact_mismatch');
    }
    if (input.proposalId) {
      const proposal = await tx.get('SELECT id FROM crm_proposals WHERE id = ? AND organization_id = ?',
        [input.proposalId, input.organizationId]);
      if (!proposal) throw new GmailError('proposal_mismatch');
    }
    const at = new Date().toISOString();
    await tx.batch([{ sql: `UPDATE crm_gmail_threads SET organization_id = ?, contact_id = ?,
      proposal_id = ?, association_status = 'matched', updated_at = ? WHERE id = ?`,
    args: [input.organizationId, input.contactId, input.proposalId, at, input.threadId] },
    { sql: `INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, 'gmail.thread.link', 'gmail_thread', ?, 'success', '{}')`,
    args: [randomUUID(), at, principal.id, principal.sessionHash, input.threadId] }]);
  }).immediate();
}

export async function getLocalDraft(principal: AdminPrincipal, id: string,
  db: Connection = getDatabase()) {
  const row = await db.get(`SELECT d.*, o.name AS organization_name, o.responsible_user_id
    FROM crm_gmail_drafts d JOIN crm_organizations o ON o.id = d.organization_id
    WHERE d.id = ? AND o.status = 'active'`, [id]);
  if (!row || !hasAdminPermission(principal, 'crm:read')
    || !canReadOrganization(principal, String(row.responsible_user_id))) throw new GmailError('forbidden', 403);
  return row;
}
export async function updateLocalDraft(principal: AdminPrincipal, id: string, input: {
  subject: string; body: string; status: 'review' | 'approved' | 'archived';
}, db: Connection = getDatabase()) {
  if (!hasAdminPermission(principal, 'crm:write')) throw new GmailError('forbidden', 403);
  if (input.subject.trim().length < 2 || input.subject.length > 240
    || input.body.trim().length < 5 || input.body.length > 10_000
    || !['review', 'approved', 'archived'].includes(input.status)) throw new GmailError('invalid_input');
  return db.transactionAsync(async (tx) => {
    const draft = await tx.get(`SELECT d.organization_id, d.status, d.recipient_email, o.responsible_user_id
      FROM crm_gmail_drafts d JOIN crm_organizations o ON o.id = d.organization_id
      WHERE d.id = ? AND o.status = 'active'`, [id]);
    if (!draft || !canWriteOrganization(principal, String(draft.responsible_user_id))) throw new GmailError('forbidden', 403);
    if (draft.status === 'archived') throw new GmailError('draft_archived', 409);
    if (input.status === 'approved') {
      const contact = await tx.get(`SELECT id FROM crm_contacts WHERE organization_id=? AND email=?`,
        [draft.organization_id,draft.recipient_email]);
      if (!contact) throw new GmailError('contact_email_missing',409);
      const reviews = await tx.all(`SELECT r.decision FROM crm_contact_channel_reviews r
        WHERE r.organization_id=? AND r.channel='email' AND (r.contact_id IS NULL OR r.contact_id=?)
          AND r.rowid=(SELECT x.rowid FROM crm_contact_channel_reviews x
            WHERE x.organization_id=r.organization_id AND x.channel=r.channel
              AND x.contact_id IS r.contact_id
            ORDER BY x.occurred_at DESC,x.rowid DESC LIMIT 1)`,[draft.organization_id,contact.id]);
      if (reviews.some(row=>row.decision==='blocked'||row.decision==='opposed'))
        throw new GmailError('channel_blocked',403);
    }
    const at = new Date().toISOString();
    await tx.batch([{ sql: `UPDATE crm_gmail_drafts SET subject = ?, body = ?, status = ?, updated_at = ? WHERE id = ?`,
      args: [input.subject.trim(), input.body.trim(), input.status, at, id] },
    { sql: `INSERT INTO altaria_admin_audit_events
      (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
      VALUES (?, ?, ?, ?, 'gmail.draft.update', 'gmail_draft', ?, 'success', '{}')`,
      args: [randomUUID(), at, principal.id, principal.sessionHash, id] }]);
    return String(draft.organization_id);
  }).immediate();
}
export async function getGmailThread(principal: AdminPrincipal, id: string,
  db: Connection = getDatabase()) {
  const thread = await db.get(`SELECT t.*, o.name AS organization_name, o.responsible_user_id,
    c.full_name AS contact_name, p.title AS proposal_title
    FROM crm_gmail_threads t JOIN crm_organizations o ON o.id = t.organization_id
    LEFT JOIN crm_contacts c ON c.id = t.contact_id
    LEFT JOIN crm_proposals p ON p.id = t.proposal_id
    WHERE t.id = ? AND o.status = 'active'`, [id]);
  if (!thread || !hasAdminPermission(principal, 'crm:read')
    || !canReadOrganization(principal, String(thread.responsible_user_id))) throw new GmailError('forbidden', 403);
  const messages = await db.all(`SELECT direction, sender_email, recipient_emails, snippet, received_at
    FROM crm_gmail_messages WHERE thread_id = ? ORDER BY received_at, id LIMIT 200`, [id]);
  return { thread, messages };
}
