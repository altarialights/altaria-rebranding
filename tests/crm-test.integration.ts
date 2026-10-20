import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connect, type Connection } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from '../scripts/lib/test-isolation.mjs';
import type { AdminPrincipal } from '../src/lib/admin/access';
import { getOrganizationDetail, listOrganizations, listPipeline } from '../src/lib/admin/crm/queries';
import { changeOpportunityStage, classifyOrganizationCandidate, completeTask,
  createActivity, createContact, createOpportunity, createOrganization, createTask,
  linkSource, reassignTask } from '../src/lib/admin/crm/service';

describe('CRM: operaciones integradas en Turso TEST con rollback', () => {
  it('guarda, consulta, autoriza, audita y revierte datos exclusivamente sintéticos', async () => {
    expect(process.env.ALTARIA_CRM_INTEGRATION_TEST).toBe('1');
    const prod = readProjectEnv('.env');
    const test = readProjectEnv('.env.test');
    if (!test?.TURSO_DATABASE_URL || !test.TURSO_AUTH_TOKEN || !test.ALTARIA_TEST_DB_MARKER) {
      throw new Error('Falta la configuración Turso TEST.');
    }
    assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
      approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod as never });
    assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
      webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod as never });
    assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
      redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
      productionEnv: prod as never });
    const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
    expect(payload.exp * 1000).toBeGreaterThan(Date.now());
    const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
    await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
    expect(Number((await db.get('PRAGMA foreign_keys'))?.foreign_keys)).toBe(1);
    const tables = ['altaria_admin_users', 'crm_organizations', 'crm_contacts', 'crm_opportunities',
      'crm_activities', 'crm_tasks', 'crm_source_links', 'crm_timeline_events',
      'altaria_admin_audit_events', 'digital_assessments', 'digital_leads'];
    const counts = async () => {
      const output: Record<string, number> = {};
      for (const table of tables) output[table] = Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`))?.n);
      return output;
    };
    const before = await counts();
    // TEST may include the staging identity used to prove unauthorized access.
    expect(before.altaria_admin_users).toBeGreaterThanOrEqual(1);
    // Existing TEST fixtures are preserved; rollback is checked against this baseline.
    const rollback = new Error('ROLLBACK_CRM_SERVICE_TEST');
    try {
      await db.transactionAsync(async (tx) => {
        const wrapped = {
          get: tx.get.bind(tx), all: tx.all.bind(tx), run: tx.run.bind(tx), batch: tx.batch.bind(tx),
          transactionAsync: (callback: (conn: typeof tx) => Promise<unknown>) => ({ immediate: () => callback(tx) }),
        } as unknown as Connection;
        const at = new Date().toISOString();
        const ownerId = randomUUID();
        await tx.run(`INSERT INTO altaria_admin_users
          (id,email,workos_user_id,display_name,status,created_at,updated_at)
          VALUES (?,?,?,?,'active',?,?)`,
        [ownerId, 'owner.synthetic@example.test', `user_synthetic_${ownerId}`, 'Propietario sintético', at, at]);
        await tx.run('INSERT INTO altaria_admin_user_roles (user_id,role_key,granted_at) VALUES (?,?,?)',
          [ownerId, 'owner', at]);
        const unrelatedSalesId = randomUUID();
        await tx.run(`INSERT INTO altaria_admin_users
          (id,email,workos_user_id,display_name,status,created_at,updated_at)
          VALUES (?,?,?,?,'active',?,?)`,
        [unrelatedSalesId, 'sales.synthetic@example.test', `user_synthetic_${unrelatedSalesId}`,
          'Comercial sintético', at, at]);
        await tx.run('INSERT INTO altaria_admin_user_roles (user_id,role_key,granted_at) VALUES (?,?,?)',
          [unrelatedSalesId, 'sales', at]);
        const owner: AdminPrincipal = { id: ownerId, roles: ['owner'], email: 'owner.synthetic@example.test',
          displayName: 'Propietario sintético', sessionHash: 'synthetic-session-hash' };
        const orgInput = { name: 'Empresa Sintética de Integración', sector: 'Pruebas', city: 'Madrid',
          region: null, countryCode: 'ES', websiteUrl: `https://${ownerId}.example.test`, leadOrigin: 'manual',
          responsibleUserId: null, identifierKind: 'domain', identifierValue: `${ownerId}.example.test`,
          confirmPossibleDuplicate: false };
        const org = await createOrganization(owner, orgInput, wrapped);
        const found = await listOrganizations(owner, { q: 'sintetica' }, wrapped);
        expect(found.some((item) => item.id === org)).toBe(true);
        const duplicate = await classifyOrganizationCandidate(orgInput, wrapped);
        expect(duplicate.kind).toBe('possible');
        await expect(createOrganization(owner, orgInput, wrapped)).rejects.toMatchObject({ code: 'duplicate_review' });
        const contact = await createContact(owner, { organizationId: org, fullName: 'Contacto Sintético',
          email: 'contacto@example.test', phone: null, jobTitle: null, isPrimary: true }, wrapped);
        const opp = await createOpportunity(owner, { organizationId: org, title: 'Proyecto sintético',
          amountEuros: 1200, responsibleUserId: null }, wrapped);
        await expect(createOpportunity(owner, { organizationId: org, title: 'Sin acceso',
          amountEuros: null, responsibleUserId: unrelatedSalesId }, wrapped))
          .rejects.toMatchObject({ code: 'assignee_outside_org' });
        await expect(changeOpportunityStage(owner,
          { opportunityId: opp, toStage: 'proposal', lostReason: null }, wrapped))
          .rejects.toMatchObject({ code: 'stage_invalid' });
        await changeOpportunityStage(owner, { opportunityId: opp, toStage: 'contacted', lostReason: null }, wrapped);
        const activity = await createActivity(owner, { organizationId: org, opportunityId: opp,
          contactId: contact, kind: 'call', summary: 'Llamada sintética', detail: null,
          happenedAt: at, followupTitle: 'Seguimiento sintético', followupDueAt: null }, wrapped);
        expect(activity).toBeTruthy();
        const task = await createTask(owner, { organizationId: org, opportunityId: opp, contactId: contact,
          title: 'Otra tarea sintética', dueAt: null, responsibleUserId: null }, wrapped);
        await expect(createTask(owner, { organizationId: org, opportunityId: opp, contactId: contact,
          title: 'Tarea sin acceso', dueAt: null, responsibleUserId: unrelatedSalesId }, wrapped))
          .rejects.toMatchObject({ code: 'assignee_outside_org' });
        await expect(reassignTask(owner, task, unrelatedSalesId, wrapped))
          .rejects.toMatchObject({ code: 'assignee_outside_org' });
        await completeTask(owner, task, wrapped);
        const assessment = randomUUID(), lead = randomUUID();
        await tx.run(`INSERT INTO digital_assessments
          (id,questionnaire_version,result_token_hash,overall_score,maturity_level,primary_opportunity,created_at)
          VALUES (?,'synthetic-v1',?,50,'FRAGMENTED_DIGITIZATION','presence',?)`,
        [assessment, randomUUID(), at]);
        await tx.run(`INSERT INTO digital_leads
          (id,assessment_id,full_name,email,job_title,company_name,company_url,company_size,
           privacy_consent_at,commercial_score,commercial_priority,created_at)
          VALUES (?,?,'Lead sintético','lead@example.test','Prueba','Empresa Sintética de Integración',
           'https://example.test','1',?,50,'MEDIUM',?)`, [lead, assessment, at, at]);
        await linkSource(owner, { organizationId: org, sourceKind: 'digital_lead', sourceId: lead }, wrapped);
        const detail = await getOrganizationDetail(owner, org, wrapped);
        expect(detail?.contacts.length).toBe(1);
        expect(detail?.activities.length).toBe(1);
        expect(detail?.tasks.length).toBe(2);
        expect(detail?.sources.length).toBe(1);
        expect(detail?.timeline.length).toBeGreaterThanOrEqual(8);
        expect((await listPipeline(owner, wrapped)).some((item) => item.id === opp && item.stage === 'contacted')).toBe(true);
        expect(Number((await tx.get('SELECT COUNT(*) AS n FROM altaria_admin_audit_events WHERE actor_user_id = ?',
          [ownerId]))?.n)).toBeGreaterThanOrEqual(8);
        const stranger: AdminPrincipal = { ...owner, id: '00000000-0000-4000-8000-000000000000', roles: ['sales'] };
        await expect(createContact(stranger, { organizationId: org, fullName: 'Sin permiso',
          email: null, phone: null, jobTitle: null, isPrimary: false }, wrapped))
          .rejects.toMatchObject({ code: 'forbidden' });
        throw rollback;
      }).immediate();
    } catch (error) {
      if (error !== rollback) throw error;
    }
    await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
    expect(await counts()).toEqual(before);
  });
});
