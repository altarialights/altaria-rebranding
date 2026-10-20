import { createHash, randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { canReadOrganization, canWriteOrganization, canAdvanceStage } from '../crm/model';
import { priceProposal, type LineInput } from './money';

export class ProposalError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export interface ProposalContent {
  description: string; scope: string; schedule: string; terms: string;
  expiresAt: string | null; lines: LineInput[];
}
const iso = () => new Date().toISOString();
const audit = (principal: AdminPrincipal, action: string, target: string, at: string) => ({
  sql: `INSERT INTO altaria_admin_audit_events
    (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
    VALUES (?, ?, ?, ?, ?, 'proposal', ?, 'success', '{}')`,
  args: [randomUUID(), at, principal.id, principal.sessionHash, action, target],
});
const event = (principal: AdminPrincipal, proposalId: string, versionId: string | null,
  kind: string, at: string, note = '') => ({
  sql: `INSERT INTO crm_proposal_events
    (id, proposal_id, version_id, kind, note, actor_user_id, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  args: [randomUUID(), proposalId, versionId, kind, note, principal.id, at],
});
async function readable(db: Pick<Connection, 'get'>, principal: AdminPrincipal, proposalId: string, write = false) {
  const row = await db.get(`SELECT p.*, o.name AS organization_name, o.responsible_user_id,
    q.title AS opportunity_title, q.stage AS opportunity_stage, q.version AS opportunity_version
    FROM crm_proposals p JOIN crm_organizations o ON o.id = p.organization_id
    JOIN crm_opportunities q ON q.id = p.opportunity_id
    WHERE p.id = ? AND o.status = 'active'`, [proposalId]);
  if (!row) throw new ProposalError('missing', 404);
  const allowed = write
    ? hasAdminPermission(principal, 'crm:write') && canWriteOrganization(principal, String(row.responsible_user_id))
    : hasAdminPermission(principal, 'crm:read') && canReadOrganization(principal, String(row.responsible_user_id));
  if (!allowed) throw new ProposalError('forbidden', 403);
  return row;
}
function checkContent(content: ProposalContent) {
  for (const [key, max] of [['description', 3000], ['scope', 5000],
    ['schedule', 2000], ['terms', 5000]] as const) {
    if (typeof content[key] !== 'string' || content[key].length > max) throw new ProposalError('invalid_content');
  }
  if (content.expiresAt && (!Number.isFinite(Date.parse(content.expiresAt))
    || Date.parse(content.expiresAt) < Date.now())) throw new ProposalError('invalid_expiry');
  try { return priceProposal(content.lines); }
  catch { throw new ProposalError('invalid_lines'); }
}
async function insertVersion(tx: Pick<Connection, 'batch' | 'get'>, principal: AdminPrincipal, proposalId: string,
  versionNumber: number, content: ProposalContent, at: string) {
  const priced = checkContent(content);
  for (const line of priced.lines) {
    if (!line.catalogItemId) continue;
    const catalog = await tx.get(`SELECT kind FROM crm_proposal_catalog WHERE id = ? AND active = 1`,
      [line.catalogItemId]);
    if (!catalog || catalog.kind !== line.kind) throw new ProposalError('catalog_mismatch');
  }
  const snapshot = { description: content.description.trim(), scope: content.scope.trim(),
    schedule: content.schedule.trim(), terms: content.terms.trim(),
    expiresAt: content.expiresAt, ...priced };
  const json = JSON.stringify(snapshot);
  const hash = createHash('sha256').update(json).digest('hex');
  const id = randomUUID();
  await tx.batch([{
    sql: `INSERT INTO crm_proposal_versions
      (id, proposal_id, version_number, snapshot_json, snapshot_sha256, subtotal_cents,
       discount_cents, tax_cents, total_cents, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, proposalId, versionNumber, json, hash, priced.subtotalCents,
      priced.discountCents, priced.taxCents, priced.totalCents, principal.id, at],
  }, ...priced.lines.map((line, position) => ({
    sql: `INSERT INTO crm_proposal_version_items
      (id, version_id, position, catalog_item_id, kind, name, description, quantity_milli,
       unit_price_cents, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), id, position, line.catalogItemId, line.kind, line.name, line.description,
      line.quantityMilli, line.unitPriceCents, line.discountBps, line.taxBps,
      line.subtotalCents, line.discountCents, line.taxCents, line.totalCents],
  }))]);
  return id;
}
export async function createProposal(principal: AdminPrincipal, opportunityId: string, title: string,
  db: Connection = getDatabase()) {
  if (!hasAdminPermission(principal, 'crm:write')) throw new ProposalError('forbidden', 403);
  if (title.trim().length < 2 || title.length > 180) throw new ProposalError('invalid_title');
  return db.transactionAsync(async (tx) => {
    const row = await tx.get(`SELECT q.organization_id, o.responsible_user_id, q.stage
      FROM crm_opportunities q JOIN crm_organizations o ON o.id = q.organization_id
      WHERE q.id = ? AND o.status = 'active'`, [opportunityId]);
    if (!row) throw new ProposalError('opportunity_missing', 404);
    if (!canWriteOrganization(principal, String(row.responsible_user_id))) throw new ProposalError('forbidden', 403);
    if (['won', 'lost'].includes(String(row.stage))) throw new ProposalError('opportunity_closed', 409);
    const id = randomUUID(); const at = iso();
    await tx.batch([{ sql: `INSERT INTO crm_proposals
      (id, organization_id, opportunity_id, title, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, row.organization_id, opportunityId, title.trim(), principal.id, at, at] },
    event(principal, id, null, 'created', at), audit(principal, 'proposal.create', id, at)]);
    return id;
  }).immediate();
}
export async function saveProposalVersion(principal: AdminPrincipal, proposalId: string,
  content: ProposalContent, expectedVersion: number, db: Connection = getDatabase()) {
  return db.transactionAsync(async (tx) => {
    const row = await readable(tx, principal, proposalId, true);
    if (['accepted', 'rejected', 'expired'].includes(String(row.status))) throw new ProposalError('closed', 409);
    if (Number(row.current_version) !== expectedVersion) throw new ProposalError('conflict', 409);
    const at = iso(); const versionNumber = expectedVersion + 1;
    const versionId = await insertVersion(tx, principal, proposalId, versionNumber, content, at);
    const changed = await tx.run(`UPDATE crm_proposals SET current_version = ?, status = 'draft',
      sent_at = NULL, expires_at = ?, updated_at = ? WHERE id = ? AND current_version = ?`,
    [versionNumber, content.expiresAt, at, proposalId, expectedVersion]);
    if (Number(changed.changes) !== 1) throw new ProposalError('conflict', 409);
    if (row.status === 'sent') await tx.run(`UPDATE crm_tasks SET cancelled_at = ?, cancelled_by = ?,
      cancel_reason = 'proposal_revised', updated_at = ? WHERE id IN
      (SELECT f.task_id FROM crm_proposal_followups f JOIN crm_proposal_versions v ON v.id = f.version_id
       WHERE v.proposal_id = ?) AND status = 'open' AND cancelled_at IS NULL`,
    [at, principal.id, at, proposalId]);
    await tx.batch([event(principal, proposalId, versionId, 'versioned', at),
      audit(principal, 'proposal.version.create', proposalId, at)]);
    return versionId;
  }).immediate();
}
export async function duplicateProposal(principal: AdminPrincipal, sourceId: string,
  db: Connection = getDatabase()) {
  return db.transactionAsync(async (tx) => {
    const source = await readable(tx, principal, sourceId, true);
    const latest = await tx.get(`SELECT snapshot_json FROM crm_proposal_versions
      WHERE proposal_id = ? AND version_number = ?`, [sourceId, source.current_version]);
    const id = randomUUID(); const at = iso();
    await tx.run(`INSERT INTO crm_proposals
      (id, organization_id, opportunity_id, title, duplicate_of_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, source.organization_id, source.opportunity_id,
      `${String(source.title).slice(0, 160)} · copia`, sourceId, principal.id, at, at]);
    if (latest) {
      const parsed = JSON.parse(String(latest.snapshot_json));
      const lines = parsed.lines.map((line: Record<string, string>) => ({
        kind: line.kind, catalogItemId: line.catalogItemId, name: line.name,
        description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
        discountPercent: line.discountPercent, taxPercent: line.taxPercent,
      }));
      const versionId = await insertVersion(tx, principal, id, 1,
        { description: parsed.description, scope: parsed.scope, schedule: parsed.schedule,
          terms: parsed.terms, expiresAt: null, lines }, at);
      await tx.run('UPDATE crm_proposals SET current_version = 1 WHERE id = ?', [id]);
      await tx.batch([event(principal, id, versionId, 'duplicated', at), audit(principal, 'proposal.duplicate', id, at)]);
    } else await tx.batch([event(principal, id, null, 'duplicated', at), audit(principal, 'proposal.duplicate', id, at)]);
    return id;
  }).immediate();
}
export async function transitionProposal(principal: AdminPrincipal, id: string,
  action: 'marked_sent' | 'accepted' | 'rejected' | 'expired' | 'changes_requested',
  note = '', db: Connection = getDatabase()) {
  return db.transactionAsync(async (tx) => {
    const row = await readable(tx, principal, id, true);
    const from = String(row.status);
    if (action === 'marked_sent' && (from !== 'draft' || Number(row.current_version) < 1)) throw new ProposalError('transition_invalid', 409);
    if (['accepted', 'rejected', 'changes_requested'].includes(action) && from !== 'sent') throw new ProposalError('transition_invalid', 409);
    if (action === 'expired' && (from !== 'sent' || !row.expires_at || Date.parse(String(row.expires_at)) > Date.now())) throw new ProposalError('transition_invalid', 409);
    if (note.length > 1000) throw new ProposalError('invalid_note');
    if (['accepted', 'rejected'].includes(action) && note.trim().length < 5) throw new ProposalError('note_required');
    const at = iso();
    const version = await tx.get('SELECT id FROM crm_proposal_versions WHERE proposal_id = ? AND version_number = ?', [id, row.current_version]);
    if (!version) throw new ProposalError('version_missing', 409);
    const target = action === 'marked_sent' ? 'sent' : action === 'changes_requested' ? 'draft' : action;
    await tx.run(`UPDATE crm_proposals SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
      decided_at = CASE WHEN ? IN ('accepted','rejected') THEN ? ELSE decided_at END,
      updated_at = ? WHERE id = ? AND status = ?`, [target, target, at, target, at, at, id, from]);
    const statements = [event(principal, id, String(version.id), action, at, note.trim()),
      audit(principal, `proposal.${action}`, id, at)];
    if (action === 'marked_sent') {
      const existing = await tx.get('SELECT task_id FROM crm_proposal_followups WHERE version_id = ?', [version.id]);
      if (!existing) {
        const taskId = randomUUID();
        const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        statements.push({ sql: `INSERT INTO crm_tasks
          (id, organization_id, opportunity_id, title, due_at, responsible_user_id,
           created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [taskId, row.organization_id, row.opportunity_id,
            `Seguimiento de propuesta: ${String(row.title).slice(0, 180)}`, dueAt,
            row.responsible_user_id, principal.id, at, at] },
        { sql: 'INSERT INTO crm_proposal_followups (version_id, task_id, created_at) VALUES (?, ?, ?)',
          args: [version.id, taskId, at] });
      }
    }
    if (action === 'accepted' && row.opportunity_stage === 'negotiation'
      && canAdvanceStage('negotiation', 'won')) {
      const nextVersion = Number(row.opportunity_version) + 1;
      statements.push({ sql: `UPDATE crm_opportunities SET stage = 'won', version = ?, closed_at = ?, updated_at = ?
        WHERE id = ? AND stage = 'negotiation' AND version = ?`,
        args: [nextVersion, at, at, row.opportunity_id, row.opportunity_version] },
      { sql: `INSERT INTO crm_opportunity_stage_events
        (id, opportunity_id, from_stage, to_stage, opportunity_version, actor_user_id, occurred_at)
        VALUES (?, ?, 'negotiation', 'won', ?, ?, ?)`,
        args: [randomUUID(), row.opportunity_id, nextVersion, principal.id, at] });
    }
    if (action !== 'marked_sent') {
      const linked = await tx.all(`SELECT f.task_id FROM crm_proposal_followups f
        JOIN crm_proposal_versions v ON v.id = f.version_id
        JOIN crm_tasks t ON t.id = f.task_id
        WHERE v.proposal_id = ? AND t.status = 'open' AND t.cancelled_at IS NULL`, [id]);
      for (const task of linked) statements.push({ sql: `UPDATE crm_tasks SET cancelled_at = ?, cancelled_by = ?,
        cancel_reason = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL`,
      args: [at, principal.id, action, at, task.task_id] });
    }
    await tx.batch(statements);
    return String(row.organization_id);
  }).immediate();
}
export async function getProposal(principal: AdminPrincipal, id: string, db: Connection = getDatabase()) {
  const proposal = await readable(db, principal, id);
  const [versions, events] = await Promise.all([
    db.all('SELECT * FROM crm_proposal_versions WHERE proposal_id = ? ORDER BY version_number DESC', [id]),
    db.all('SELECT * FROM crm_proposal_events WHERE proposal_id = ? ORDER BY occurred_at DESC', [id]),
  ]);
  for (const version of versions) {
    if (createHash('sha256').update(String(version.snapshot_json)).digest('hex') !== version.snapshot_sha256) {
      throw new ProposalError('snapshot_corrupt', 503);
    }
  }
  return { proposal, versions, events };
}
export async function listProposals(principal: AdminPrincipal, organizationId?: string,
  db: Connection = getDatabase()) {
  if (!hasAdminPermission(principal, 'crm:read')) throw new ProposalError('forbidden', 403);
  const sales = principal.roles.includes('sales') && !principal.roles.includes('owner');
  const conditions = ["o.status = 'active'"];
  const args: string[] = [];
  if (sales) { conditions.push('o.responsible_user_id = ?'); args.push(principal.id); }
  if (organizationId) { conditions.push('p.organization_id = ?'); args.push(organizationId); }
  return db.all(`SELECT p.*, o.name AS organization_name, q.title AS opportunity_title,
    v.total_cents FROM crm_proposals p JOIN crm_organizations o ON o.id = p.organization_id
    JOIN crm_opportunities q ON q.id = p.opportunity_id
    LEFT JOIN crm_proposal_versions v ON v.proposal_id = p.id AND v.version_number = p.current_version
    WHERE ${conditions.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 100`, args);
}
export async function listProposalResources(db: Connection = getDatabase()) {
  const [templates, catalog] = await Promise.all([
    db.all('SELECT * FROM crm_proposal_templates WHERE active = 1 ORDER BY name'),
    db.all('SELECT * FROM crm_proposal_catalog WHERE active = 1 ORDER BY kind, name'),
  ]);
  return { templates, catalog };
}
export async function createProposalResource(principal: AdminPrincipal,
  type: 'template' | 'catalog', input: Record<string, string>, db: Connection = getDatabase()) {
  if (!principal.roles.includes('owner')) throw new ProposalError('forbidden', 403);
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 120) throw new ProposalError('invalid_name');
  const at = iso(); const id = randomUUID();
  if (type === 'template') {
    for (const key of ['description', 'scope', 'schedule', 'terms']) {
      if ((input[key] || '').length > 5000) throw new ProposalError('invalid_content');
    }
    await db.batch([{ sql: `INSERT INTO crm_proposal_templates
      (id, name, description, scope, schedule, terms, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, input.description || '', input.scope || '', input.schedule || '',
      input.terms || '', principal.id, at, at] }, audit(principal, 'proposal.template.create', id, at)], 'immediate');
  } else {
    if (!['product', 'service'].includes(input.kind) || (input.description || '').length > 1000) throw new ProposalError('invalid_content');
    // No prices are assumed for Altaria products or services. They are set by the owner.
    const cents = input.unitPrice ? Number(input.unitPrice) : null;
    if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0 || cents > 9_999_999_999)) throw new ProposalError('invalid_content');
    const taxBps = Number(input.taxBps || '2100');
    if (!Number.isSafeInteger(taxBps) || taxBps < 0 || taxBps > 10000) throw new ProposalError('invalid_content');
    await db.batch([{ sql: `INSERT INTO crm_proposal_catalog
      (id, name, kind, description, unit_price_cents, tax_bps, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, input.kind, input.description || '', cents, taxBps, principal.id, at, at] },
    audit(principal, 'proposal.catalog.create', id, at)], 'immediate');
  }
  return id;
}
