import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import { hasAdminPermission, type AdminPrincipal } from '../access';
import { canAdvanceStage, canWriteOrganization, normalizeCompanyName,
  normalizeIdentifier, type CrmStage, type SourceKind } from './model';

type Value = string | number | null;
type Statement = { sql: string; args: Value[] };
const nowIso = () => new Date().toISOString();
export class CrmError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const requireWrite = (principal: AdminPrincipal) => {
  if (!hasAdminPermission(principal, 'crm:write')) throw new CrmError('forbidden', 403);
};
const audit = (principal: AdminPrincipal, action: string, targetType: string, targetId: string, at: string): Statement => ({
  sql: `INSERT INTO altaria_admin_audit_events
    (id, occurred_at, actor_user_id, actor_session_hash, action, target_type, target_id, outcome, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'success', '{}')`,
  args: [randomUUID(), at, principal.id, principal.sessionHash, action, targetType, targetId],
});
const timeline = (principal: AdminPrincipal, organizationId: string, eventType: string,
  entityId: string, at: string, details: Record<string, string> = {}): Statement => ({
  sql: `INSERT INTO crm_timeline_events
    (id, organization_id, event_type, entity_id, actor_user_id, occurred_at, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  args: [randomUUID(), organizationId, eventType, entityId, principal.id, at, JSON.stringify(details)],
});
type DbReader = Pick<Connection, 'get'>;
async function writableOrganization(db: DbReader, principal: AdminPrincipal, organizationId: string) {
  const row = await db.get('SELECT id, responsible_user_id FROM crm_organizations WHERE id = ? AND status = ?',
    [organizationId, 'active']);
  if (!row) throw new CrmError('organization_missing', 404);
  if (!canWriteOrganization(principal, String(row.responsible_user_id))) throw new CrmError('forbidden', 403);
  return row;
}
async function assignableUser(db: DbReader, principal: AdminPrincipal, requested: string | null): Promise<string> {
  const id = requested ?? principal.id;
  if (!principal.roles.includes('owner') && id !== principal.id) throw new CrmError('forbidden', 403);
  const row = await db.get(`SELECT u.id FROM altaria_admin_users u
    JOIN altaria_admin_user_roles r ON r.user_id = u.id
    WHERE u.id = ? AND u.status = ? AND r.role_key IN ('owner','sales') LIMIT 1`, [id, 'active']);
  if (!row) throw new CrmError('assignee_invalid');
  return id;
}
async function assertAssigneeCanSeeOrganization(db: DbReader, assigneeId: string, organizationOwnerId: string) {
  if (assigneeId === organizationOwnerId) return;
  const owner = await db.get('SELECT 1 FROM altaria_admin_user_roles WHERE user_id = ? AND role_key = ?',
    [assigneeId, 'owner']);
  if (!owner) throw new CrmError('assignee_outside_org');
}
async function linkedResource(db: DbReader, organizationId: string, table: 'crm_contacts' | 'crm_opportunities', id: string | null) {
  if (!id) return;
  const row = await db.get(`SELECT id FROM ${table} WHERE id = ? AND organization_id = ?`, [id, organizationId]);
  if (!row) throw new CrmError('resource_mismatch');
}

export interface OrganizationInput {
  name: string; sector: string | null; city: string | null; region: string | null;
  countryCode: string; websiteUrl: string | null; leadOrigin: string;
  responsibleUserId: string | null; identifierKind: string; identifierValue: string;
  confirmPossibleDuplicate: boolean;
}
export async function classifyOrganizationCandidate(input: Pick<OrganizationInput,
  'name' | 'city' | 'identifierKind' | 'identifierValue'>,
  db: Pick<Connection, 'get' | 'all'> = getDatabase()) {
  const normalizedName = normalizeCompanyName(input.name);
  if (normalizedName.length < 2) throw new CrmError('invalid_name');
  let identifier: string | null = null;
  if (input.identifierKind && input.identifierValue) {
    try { identifier = normalizeIdentifier(input.identifierKind, input.identifierValue); }
    catch { throw new CrmError('invalid_identifier'); }
    if (identifier.length < 3 || identifier.length > 255) throw new CrmError('invalid_identifier');
  }
  if (identifier) {
    const reliable = await db.get(`SELECT o.id, o.name FROM crm_organization_identifiers i
      JOIN crm_organizations o ON o.id = i.organization_id
      WHERE i.kind = ? AND i.normalized_value = ? AND i.verification_status = ? AND o.status = ?`,
      [input.identifierKind, identifier, 'verified', 'active']);
    if (reliable) return { kind: 'reliable' as const, matches: [reliable], normalizedName, identifier };
  }
  const matches = await db.all(`SELECT id, name FROM crm_organizations
    WHERE normalized_name = ? AND lower(coalesce(city, '')) = lower(?) AND status = ? LIMIT 5`,
    [normalizedName, input.city ?? '', 'active']);
  if (matches.length) return { kind: 'possible' as const, matches, normalizedName, identifier };
  if (identifier) {
    const domainMatches = await db.all(`SELECT o.id, o.name FROM crm_organization_identifiers i
      JOIN crm_organizations o ON o.id = i.organization_id
      WHERE i.kind = ? AND i.normalized_value = ? AND o.status = ? LIMIT 5`,
      [input.identifierKind, identifier, 'active']);
    if (domainMatches.length) return { kind: 'possible' as const, matches: domainMatches, normalizedName, identifier };
  }
  return { kind: 'new' as const, matches: [], normalizedName, identifier };
}

export async function createOrganization(principal: AdminPrincipal, input: OrganizationInput,
  db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    const responsible = await assignableUser(tx, principal, input.responsibleUserId);
    const result = await classifyOrganizationCandidate(input, tx);
    if (result.kind === 'reliable') throw new CrmError('duplicate_verified', 409);
    if (result.kind === 'possible' && (!input.confirmPossibleDuplicate || !principal.roles.includes('owner'))) {
      throw new CrmError('duplicate_review', 409);
    }
    const id = randomUUID(); const at = nowIso();
    const statements: Statement[] = [{
      sql: `INSERT INTO crm_organizations
        (id, name, normalized_name, sector, city, region, country_code, website_url,
         lead_origin, responsible_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.name, result.normalizedName, input.sector, input.city, input.region,
        input.countryCode, input.websiteUrl, input.leadOrigin, responsible, at, at],
    }];
    if (result.identifier) statements.push({
      sql: `INSERT INTO crm_organization_identifiers
        (id, organization_id, kind, normalized_value, verification_status, created_at)
        VALUES (?, ?, ?, ?, 'unverified', ?)`,
      args: [randomUUID(), id, input.identifierKind, result.identifier, at],
    });
    statements.push(timeline(principal, id, 'organization.created', id, at),
      audit(principal, 'crm.organization.create', 'organization', id, at));
    await tx.batch(statements);
    return id;
  }).immediate();
}

export async function updateOrganization(principal: AdminPrincipal, id: string, input: OrganizationInput,
  db: Connection = getDatabase()): Promise<void> {
  requireWrite(principal);
  await db.transactionAsync(async (tx) => {
    await writableOrganization(tx, principal, id);
    const responsible = await assignableUser(tx, principal, input.responsibleUserId);
    const normalized = normalizeCompanyName(input.name);
    if (normalized.length < 2) throw new CrmError('invalid_name');
    const duplicate = await tx.get(`SELECT id FROM crm_organizations WHERE id <> ?
      AND normalized_name = ? AND lower(coalesce(city,'')) = lower(?) AND status = ?`,
      [id, normalized, input.city ?? '', 'active']);
    if (duplicate && (!input.confirmPossibleDuplicate || !principal.roles.includes('owner'))) {
      throw new CrmError('duplicate_review', 409);
    }
    const at = nowIso();
    await tx.batch([{
      sql: `UPDATE crm_organizations SET name = ?, normalized_name = ?, sector = ?, city = ?, region = ?,
        country_code = ?, website_url = ?, lead_origin = ?, responsible_user_id = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
      args: [input.name, normalized, input.sector, input.city, input.region, input.countryCode,
        input.websiteUrl, input.leadOrigin, responsible, at, id, 'active'],
    }, timeline(principal, id, 'organization.updated', id, at),
    audit(principal, 'crm.organization.update', 'organization', id, at)]);
  }).immediate();
}

export async function createContact(principal: AdminPrincipal, input: {
  organizationId: string; fullName: string; email: string | null; phone: string | null;
  jobTitle: string | null; isPrimary: boolean;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    await writableOrganization(tx, principal, input.organizationId);
    const id = randomUUID(); const at = nowIso();
    await tx.batch([{
      sql: `INSERT INTO crm_contacts
        (id, organization_id, full_name, email, phone, job_title, is_primary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.organizationId, input.fullName, input.email, input.phone,
        input.jobTitle, input.isPrimary ? 1 : 0, at, at],
    }, timeline(principal, input.organizationId, 'contact.created', id, at),
    audit(principal, 'crm.contact.create', 'contact', id, at)]);
    return id;
  }).immediate();
}

export async function createOpportunity(principal: AdminPrincipal, input: {
  organizationId: string; title: string; amountEuros: number | null; responsibleUserId: string | null;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    const organization = await writableOrganization(tx, principal, input.organizationId);
    const responsible = await assignableUser(tx, principal, input.responsibleUserId);
    await assertAssigneeCanSeeOrganization(tx, responsible, String(organization.responsible_user_id));
    const id = randomUUID(); const at = nowIso();
    await tx.batch([{
      sql: `INSERT INTO crm_opportunities
        (id, organization_id, title, stage, amount_cents, responsible_user_id, created_at, updated_at)
        VALUES (?, ?, ?, 'new', ?, ?, ?, ?)`,
      args: [id, input.organizationId, input.title, input.amountEuros, responsible, at, at],
    }, {
      sql: `INSERT INTO crm_opportunity_stage_events
        (id, opportunity_id, from_stage, to_stage, opportunity_version, actor_user_id, occurred_at)
        VALUES (?, ?, NULL, 'new', 1, ?, ?)`,
      args: [randomUUID(), id, principal.id, at],
    }, timeline(principal, input.organizationId, 'opportunity.created', id, at),
    audit(principal, 'crm.opportunity.create', 'opportunity', id, at)]);
    return id;
  }).immediate();
}

export async function changeOpportunityStage(principal: AdminPrincipal, input: {
  opportunityId: string; toStage: CrmStage; lostReason: string | null;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    const row = await tx.get(`SELECT p.organization_id, p.stage, p.version, o.responsible_user_id
      FROM crm_opportunities p JOIN crm_organizations o ON o.id = p.organization_id
      WHERE p.id = ? AND o.status = ?`, [input.opportunityId, 'active']);
    if (!row) throw new CrmError('opportunity_missing', 404);
    if (!canWriteOrganization(principal, String(row.responsible_user_id))) throw new CrmError('forbidden', 403);
    const from = String(row.stage) as CrmStage;
    if (!canAdvanceStage(from, input.toStage)) throw new CrmError('stage_invalid', 409);
    if (input.toStage === 'lost' && (!input.lostReason || input.lostReason.length < 3)) {
      throw new CrmError('lost_reason_required');
    }
    const at = nowIso(); const version = Number(row.version) + 1;
    const updated = await tx.run(`UPDATE crm_opportunities SET stage = ?, version = ?,
      closed_at = ?, lost_reason = ?, updated_at = ? WHERE id = ? AND version = ? AND stage = ?`,
      [input.toStage, version, ['won', 'lost'].includes(input.toStage) ? at : null,
        input.toStage === 'lost' ? input.lostReason : null, at, input.opportunityId, row.version, from]);
    if (Number(updated.changes) !== 1) throw new CrmError('stage_conflict', 409);
    await tx.batch([{
      sql: `INSERT INTO crm_opportunity_stage_events
        (id, opportunity_id, from_stage, to_stage, opportunity_version, actor_user_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), input.opportunityId, from, input.toStage, version, principal.id, at],
    }, timeline(principal, String(row.organization_id), 'opportunity.stage', input.opportunityId, at,
      { from, to: input.toStage }),
    audit(principal, 'crm.opportunity.stage', 'opportunity', input.opportunityId, at)]);
    return String(row.organization_id);
  }).immediate();
}

export async function createActivity(principal: AdminPrincipal, input: {
  organizationId: string; opportunityId: string | null; contactId: string | null;
  kind: 'call' | 'visit' | 'meeting' | 'note'; summary: string; detail: string | null;
  happenedAt: string; followupTitle: string | null; followupDueAt: string | null;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  if (new Date(input.happenedAt).getTime() > Date.now() + 5 * 60_000) throw new CrmError('activity_future');
  return db.transactionAsync(async (tx) => {
    await writableOrganization(tx, principal, input.organizationId);
    await linkedResource(tx, input.organizationId, 'crm_opportunities', input.opportunityId);
    await linkedResource(tx, input.organizationId, 'crm_contacts', input.contactId);
    const id = randomUUID(); const at = nowIso();
    const statements: Statement[] = [{
      sql: `INSERT INTO crm_activities
        (id, organization_id, opportunity_id, contact_id, kind, summary, detail, happened_at, actor_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.organizationId, input.opportunityId, input.contactId,
        input.kind, input.summary, input.detail, input.happenedAt, principal.id, at],
    }, timeline(principal, input.organizationId, 'activity.created', id, at)];
    if (input.followupTitle) {
      const taskId = randomUUID();
      statements.push({
        sql: `INSERT INTO crm_tasks
          (id, organization_id, opportunity_id, contact_id, origin_activity_id, title, due_at,
           responsible_user_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [taskId, input.organizationId, input.opportunityId, input.contactId, id,
          input.followupTitle, input.followupDueAt, principal.id, principal.id, at, at],
      }, timeline(principal, input.organizationId, 'task.created', taskId, at));
    }
    statements.push(audit(principal, 'crm.activity.create', 'activity', id, at));
    await tx.batch(statements);
    return id;
  }).immediate();
}

export async function createTask(principal: AdminPrincipal, input: {
  organizationId: string; opportunityId: string | null; contactId: string | null;
  title: string; dueAt: string | null; responsibleUserId: string | null;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    const organization = await writableOrganization(tx, principal, input.organizationId);
    await linkedResource(tx, input.organizationId, 'crm_opportunities', input.opportunityId);
    await linkedResource(tx, input.organizationId, 'crm_contacts', input.contactId);
    const responsible = await assignableUser(tx, principal, input.responsibleUserId);
    await assertAssigneeCanSeeOrganization(tx, responsible, String(organization.responsible_user_id));
    const id = randomUUID(); const at = nowIso();
    await tx.batch([{
      sql: `INSERT INTO crm_tasks
        (id, organization_id, opportunity_id, contact_id, title, due_at,
         responsible_user_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.organizationId, input.opportunityId, input.contactId, input.title,
        input.dueAt, responsible, principal.id, at, at],
    }, timeline(principal, input.organizationId, 'task.created', id, at),
    audit(principal, 'crm.task.create', 'task', id, at)]);
    return id;
  }).immediate();
}

export async function completeTask(principal: AdminPrincipal, taskId: string,
  db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    const row = await tx.get(`SELECT t.organization_id, t.responsible_user_id AS task_owner, t.status, t.cancelled_at,
      o.responsible_user_id AS organization_owner FROM crm_tasks t
      JOIN crm_organizations o ON o.id = t.organization_id WHERE t.id = ? AND o.status = ?`, [taskId, 'active']);
    if (!row) throw new CrmError('task_missing', 404);
    if (!canWriteOrganization(principal, String(row.organization_owner))) throw new CrmError('forbidden', 403);
    if (row.status !== 'open' || row.cancelled_at) throw new CrmError('task_already_done', 409);
    const at = nowIso();
    const changed = await tx.run(`UPDATE crm_tasks SET status = 'done', completed_by = ?,
      completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open' AND cancelled_at IS NULL`, [principal.id, at, at, taskId]);
    if (Number(changed.changes) !== 1) throw new CrmError('task_conflict', 409);
    await tx.batch([timeline(principal, String(row.organization_id), 'task.completed', taskId, at),
      audit(principal, 'crm.task.complete', 'task', taskId, at)]);
    return String(row.organization_id);
  }).immediate();
}

export async function reassignTask(principal: AdminPrincipal, taskId: string, assigneeId: string,
  db: Connection = getDatabase()): Promise<string> {
  if (!principal.roles.includes('owner')) throw new CrmError('forbidden', 403);
  return db.transactionAsync(async (tx) => {
    const row = await tx.get(`SELECT t.organization_id, t.status, t.cancelled_at, t.responsible_user_id,
      o.responsible_user_id AS organization_owner
      FROM crm_tasks t JOIN crm_organizations o ON o.id = t.organization_id
      WHERE t.id = ? AND o.status = ?`, [taskId, 'active']);
    if (!row) throw new CrmError('task_missing', 404);
    if (row.status !== 'open' || row.cancelled_at) throw new CrmError('task_already_done', 409);
    const assignee = await assignableUser(tx, principal, assigneeId);
    await assertAssigneeCanSeeOrganization(tx, assignee, String(row.organization_owner));
    if (row.responsible_user_id === assignee) throw new CrmError('assignee_unchanged');
    const at = nowIso();
    await tx.batch([{ sql: 'UPDATE crm_tasks SET responsible_user_id = ?, updated_at = ? WHERE id = ?',
      args: [assignee, at, taskId] },
    timeline(principal, String(row.organization_id), 'task.reassigned', taskId, at),
    audit(principal, 'crm.task.reassign', 'task', taskId, at)]);
    return String(row.organization_id);
  }).immediate();
}

const sourceColumn: Record<SourceKind, { table: string; column: string }> = {
  digital_lead: { table: 'digital_leads', column: 'digital_lead_id' },
  cards_inquiry: { table: 'consultas_tarjetas', column: 'card_inquiry_id' },
  cards_order: { table: 'pedidos_tarjetas', column: 'card_order_id' },
};
export async function linkSource(principal: AdminPrincipal, input: {
  organizationId: string; sourceKind: SourceKind; sourceId: string;
}, db: Connection = getDatabase()): Promise<string> {
  requireWrite(principal);
  return db.transactionAsync(async (tx) => {
    await writableOrganization(tx, principal, input.organizationId);
    const source = sourceColumn[input.sourceKind];
    if (!source) throw new CrmError('source_invalid');
    const existing = await tx.get(`SELECT id${input.sourceKind === 'cards_order' ? ', stripe_entorno, google_place_id' : ''}
      FROM ${source.table} WHERE id = ?`, [input.sourceId]);
    if (!existing) throw new CrmError('source_missing', 404);
    if (input.sourceKind === 'cards_order') {
      if (existing.stripe_entorno !== 'test') throw new CrmError('source_not_test', 403);
    }
    const linked = await tx.get(`SELECT id FROM crm_source_links WHERE ${source.column} = ?`, [input.sourceId]);
    if (linked) throw new CrmError('source_already_linked', 409);
    const id = randomUUID(); const at = nowIso();
    const statements: Statement[] = [{
      sql: `INSERT INTO crm_source_links
        (id, organization_id, ${source.column}, linked_by, linked_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, input.organizationId, input.sourceId, principal.id, at],
    }];
    if (input.sourceKind === 'cards_order' && existing.google_place_id) {
      const value = normalizeIdentifier('google_place_id', String(existing.google_place_id));
      const duplicate = await tx.get(`SELECT organization_id FROM crm_organization_identifiers
        WHERE kind = ? AND normalized_value = ? AND verification_status = ?`,
        ['google_place_id', value, 'verified']);
      if (duplicate && duplicate.organization_id !== input.organizationId) {
        throw new CrmError('duplicate_verified', 409);
      }
      if (!duplicate) statements.push({
        sql: `INSERT INTO crm_organization_identifiers
          (id, organization_id, kind, normalized_value, verification_status, verified_at, verified_by, created_at)
          VALUES (?, ?, 'google_place_id', ?, 'verified', ?, ?, ?)`,
        args: [randomUUID(), input.organizationId, value, at, principal.id, at],
      });
    }
    statements.push(timeline(principal, input.organizationId, 'source.linked', id, at,
      { source: input.sourceKind }),
    audit(principal, 'crm.source.link', 'source_link', id, at));
    await tx.batch(statements);
    return id;
  }).immediate();
}
