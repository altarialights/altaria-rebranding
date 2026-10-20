import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import type { AdminPrincipal } from '../access';
import { canReadOrganization, normalizeCompanyName } from './model';

export interface CrmOrganization {
  id: string; name: string; normalized_name: string; sector: string | null;
  city: string | null; region: string | null; country_code: string;
  website_url: string | null; lead_origin: string; responsible_user_id: string;
  responsible_name?: string; status: string; created_at: string; updated_at: string;
}
const text = (value: unknown) => value == null ? null : String(value);
const orgFromRow = (row: Record<string, unknown>): CrmOrganization => ({
  id: String(row.id), name: String(row.name), normalized_name: String(row.normalized_name),
  sector: text(row.sector), city: text(row.city), region: text(row.region),
  country_code: String(row.country_code), website_url: text(row.website_url),
  lead_origin: String(row.lead_origin), responsible_user_id: String(row.responsible_user_id),
  responsible_name: text(row.responsible_name) ?? undefined, status: String(row.status),
  created_at: String(row.created_at), updated_at: String(row.updated_at),
});
const isSalesOnly = (principal: AdminPrincipal) => principal.roles.includes('sales')
  && !principal.roles.includes('owner') && !principal.roles.includes('viewer');

export async function listOrganizations(principal: AdminPrincipal, filters: {
  q?: string; sector?: string; city?: string; limit?: number; offset?: number;
} = {}, db: Connection = getDatabase()): Promise<CrmOrganization[]> {
  const where = ["o.status = 'active'"];
  const args: Array<string | number> = [];
  if (isSalesOnly(principal)) { where.push('o.responsible_user_id = ?'); args.push(principal.id); }
  const q = normalizeCompanyName(filters.q ?? '');
  if (q) {
    where.push("o.normalized_name LIKE ? ESCAPE '\\'");
    args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (filters.sector) { where.push('o.sector = ?'); args.push(filters.sector); }
  if (filters.city) { where.push('o.city = ?'); args.push(filters.city); }
  args.push(Math.min(Math.max(filters.limit ?? 50, 1), 100), Math.max(filters.offset ?? 0, 0));
  const rows = await db.all(`SELECT o.*, u.display_name AS responsible_name FROM crm_organizations o
    JOIN altaria_admin_users u ON u.id = o.responsible_user_id
    WHERE ${where.join(' AND ')} ORDER BY o.updated_at DESC, o.id DESC LIMIT ? OFFSET ?`, args);
  return rows.map((row) => orgFromRow(row));
}

export async function getOrganization(principal: AdminPrincipal, id: string,
  db: Connection = getDatabase()): Promise<CrmOrganization | null> {
  const row = await db.get(`SELECT o.*, u.display_name AS responsible_name FROM crm_organizations o
    JOIN altaria_admin_users u ON u.id = o.responsible_user_id WHERE o.id = ? AND o.status = ?`,
  [id, 'active']);
  if (!row || !canReadOrganization(principal, String(row.responsible_user_id))) return null;
  return orgFromRow(row);
}

export async function getOrganizationDetail(principal: AdminPrincipal, id: string,
  db: Connection = getDatabase()) {
  const organization = await getOrganization(principal, id, db);
  if (!organization) return null;
  const [contacts, opportunities, activities, tasks, timeline, sources] = await Promise.all([
    db.all('SELECT * FROM crm_contacts WHERE organization_id = ? ORDER BY is_primary DESC, full_name', [id]),
    db.all('SELECT * FROM crm_opportunities WHERE organization_id = ? ORDER BY updated_at DESC', [id]),
    db.all(`SELECT a.*, u.display_name AS actor_name FROM crm_activities a
      JOIN altaria_admin_users u ON u.id = a.actor_user_id
      WHERE a.organization_id = ? ORDER BY a.happened_at DESC LIMIT 100`, [id]),
    db.all(`SELECT t.*, u.display_name AS responsible_name FROM crm_tasks t
      JOIN altaria_admin_users u ON u.id = t.responsible_user_id
      WHERE t.organization_id = ? ORDER BY t.status, t.due_at, t.created_at DESC LIMIT 100`, [id]),
    db.all(`SELECT e.*, u.display_name AS actor_name FROM crm_timeline_events e
      JOIN altaria_admin_users u ON u.id = e.actor_user_id
      WHERE e.organization_id = ? ORDER BY e.occurred_at DESC LIMIT 150`, [id]),
    db.all(`SELECT l.id, l.digital_lead_id, l.card_inquiry_id, l.card_order_id, l.linked_at,
      p.numero_pedido AS order_number, p.estado AS order_status
      FROM crm_source_links l LEFT JOIN pedidos_tarjetas p ON p.id = l.card_order_id
      WHERE l.organization_id = ? ORDER BY l.linked_at DESC`, [id]),
  ]);
  return { organization, contacts, opportunities, activities, tasks, timeline, sources,
    nextAction: tasks.find((task) => task.status === 'open' && !task.cancelled_at) ?? null };
}

export async function listPipeline(principal: AdminPrincipal, db: Connection = getDatabase()) {
  const where = isSalesOnly(principal) ? 'AND o.responsible_user_id = ?' : '';
  const args = isSalesOnly(principal) ? [principal.id] : [];
  return db.all(`SELECT p.id, p.organization_id, p.title, p.stage, p.amount_cents,
    p.responsible_user_id, p.updated_at, o.name AS organization_name
    FROM crm_opportunities p JOIN crm_organizations o ON o.id = p.organization_id
    WHERE o.status = 'active' ${where} ORDER BY p.updated_at DESC LIMIT 300`, args);
}

export async function listCrmTasks(principal: AdminPrincipal, status: 'open' | 'done' = 'open',
  db: Connection = getDatabase()) {
  const where = isSalesOnly(principal) ? 'AND o.responsible_user_id = ?' : '';
  const args = isSalesOnly(principal) ? [status, principal.id] : [status];
  return db.all(`SELECT t.*, o.name AS organization_name, u.display_name AS responsible_name
    FROM crm_tasks t JOIN crm_organizations o ON o.id = t.organization_id
    JOIN altaria_admin_users u ON u.id = t.responsible_user_id
    WHERE t.status = ? AND t.cancelled_at IS NULL AND o.status = 'active' ${where}
    ORDER BY t.due_at IS NULL, t.due_at, t.created_at DESC LIMIT 100`, args);
}

export async function listAssignableUsers(db: Connection = getDatabase()) {
  return db.all(`SELECT u.id, u.display_name, u.email,
    MAX(CASE WHEN r.role_key = 'owner' THEN 1 ELSE 0 END) AS is_owner
    FROM altaria_admin_users u
    JOIN altaria_admin_user_roles r ON r.user_id = u.id
    WHERE u.status = ? AND r.role_key IN ('owner', 'sales')
    GROUP BY u.id, u.display_name, u.email ORDER BY u.display_name, u.email`, ['active']);
}

export async function getCrmSummary(principal: AdminPrincipal, db: Connection = getDatabase()) {
  const where = isSalesOnly(principal) ? 'AND o.responsible_user_id = ?' : '';
  const args = isSalesOnly(principal) ? [principal.id] : [];
  const [organizations, opportunities, tasks] = await Promise.all([
    db.get(`SELECT COUNT(*) AS n FROM crm_organizations o WHERE o.status = 'active' ${where}`, args),
    db.get(`SELECT COUNT(*) AS n FROM crm_opportunities p JOIN crm_organizations o ON o.id = p.organization_id
      WHERE o.status = 'active' AND p.stage NOT IN ('won','lost') ${where}`, args),
    db.get(`SELECT COUNT(*) AS n FROM crm_tasks t JOIN crm_organizations o ON o.id = t.organization_id
      WHERE o.status = 'active' AND t.status = 'open' AND t.cancelled_at IS NULL ${where}`, args),
  ]);
  return { organizations: Number(organizations?.n ?? 0), openOpportunities: Number(opportunities?.n ?? 0),
    openTasks: Number(tasks?.n ?? 0) };
}
