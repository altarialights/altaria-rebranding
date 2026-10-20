import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connect, type Connection } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from '../scripts/lib/test-isolation.mjs';
import type { AdminPrincipal } from '../src/lib/admin/access';
import { createProposal, duplicateProposal, getProposal, saveProposalVersion,
  transitionProposal } from '../src/lib/admin/proposals/service';
import { createLocalDraft, getGmailThread, getLocalDraft, linkGmailThread,
  updateLocalDraft } from '../src/lib/admin/gmail/service';
import { recordGmailIncident, syncGmailConnection,
  type GmailProvider, type GmailMessage } from '../src/lib/admin/gmail/sync';
import { encryptGmailToken } from '../src/lib/admin/gmail/crypto';

describe('Fase 3: propuestas y Gmail sintéticos en Turso TEST', () => {
  it('autoriza, versiona, calcula, deduplica, reanuda y revierte sin tocar datos reales', async () => {
    expect(process.env.ALTARIA_PHASE3_INTEGRATION_TEST).toBe('1');
    const prod = readProjectEnv('.env'); const test = readProjectEnv('.env.test');
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
    const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] || '', 'base64url').toString());
    expect(payload.exp * 1000).toBeGreaterThan(Date.now());
    const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
    await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
    const hash = createHash('sha256').update(readFileSync('migrations/009_altaria_os_proposals_gmail.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?',
      ['009_altaria_os_proposals_gmail.sql']))?.sha256).toBe(hash);
    const hash010 = createHash('sha256').update(readFileSync('migrations/010_altaria_os_proposal_immutability.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?',
      ['010_altaria_os_proposal_immutability.sql']))?.sha256).toBe(hash010);
    const tables = ['crm_organizations', 'crm_opportunities', 'crm_contacts', 'crm_proposals',
      'crm_proposal_versions', 'crm_proposal_events', 'crm_tasks', 'crm_gmail_connections',
      'crm_gmail_threads', 'crm_gmail_messages', 'crm_gmail_drafts', 'crm_activities'];
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (table) =>
      [table, Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`))?.n)] as const)));
    const before = await counts();
    const rollback = new Error('ROLLBACK_SYNTHETIC_PHASE3');
    try {
      await db.transactionAsync(async (tx) => {
        const wrapped = { get: tx.get.bind(tx), all: tx.all.bind(tx), run: tx.run.bind(tx),
          batch: tx.batch.bind(tx), transactionAsync: (callback: (conn: typeof tx) => Promise<unknown>) =>
            ({ immediate: () => callback(tx) }) } as unknown as Connection;
        const at = new Date().toISOString();
        const ownerId = randomUUID(), salesId = randomUUID(), organizationId = randomUUID();
        const opportunityId = randomUUID(), contactId = randomUUID();
        for (const [id, email, role] of [[ownerId, 'owner.phase3@example.test', 'owner'],
          [salesId, 'sales.phase3@example.test', 'sales']]) {
          await tx.run(`INSERT INTO altaria_admin_users
            (id,email,workos_user_id,display_name,status,created_at,updated_at)
            VALUES (?,?,?,'Persona sintética','active',?,?)`,
          [id, email, `user_synthetic_${id}`, at, at]);
          await tx.run('INSERT INTO altaria_admin_user_roles (user_id,role_key,granted_at) VALUES (?,?,?)',
            [id, role, at]);
        }
        const owner: AdminPrincipal = { id: ownerId, email: 'owner.phase3@example.test',
          displayName: 'Propietario sintético', roles: ['owner'], sessionHash: 'synthetic-session' };
        const sales: AdminPrincipal = { ...owner, id: salesId, email: 'sales.phase3@example.test', roles: ['sales'] };
        await tx.run(`INSERT INTO crm_organizations
          (id,name,normalized_name,responsible_user_id,created_at,updated_at)
          VALUES (?,'Empresa Sintética Tres','empresa sintetica tres',?,?,?)`,
        [organizationId, ownerId, at, at]);
        await tx.run(`INSERT INTO crm_opportunities
          (id,organization_id,title,stage,responsible_user_id,created_at,updated_at)
          VALUES (?,?,'Oportunidad sintética','new',?,?,?)`,
        [opportunityId, organizationId, ownerId, at, at]);
        await tx.run(`INSERT INTO crm_contacts
          (id,organization_id,full_name,email,created_at,updated_at)
          VALUES (?,?,'Contacto Sintético','contact.phase3@example.test',?,?)`,
        [contactId, organizationId, at, at]);
        await expect(createProposal(sales, opportunityId, 'Propuesta sin permiso', wrapped))
          .rejects.toMatchObject({ code: 'forbidden' });
        const id = await createProposal(owner, opportunityId, 'Propuesta sintética', wrapped);
        const content = { description: 'Descripción sintética', scope: 'Alcance sintético',
          schedule: 'Tres semanas', terms: 'Condiciones sintéticas', expiresAt: null,
          lines: [{ kind: 'service' as const, catalogItemId: null, name: 'Servicio sintético',
            description: '', quantity: '2', unitPrice: '100.00', discountPercent: '10', taxPercent: '21' }] };
        const firstId = await saveProposalVersion(owner, id, content, 0, wrapped);
        expect((await getProposal(owner, id, wrapped)).versions).toHaveLength(1);
        await expect(saveProposalVersion(sales, id, content, 1, wrapped)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(saveProposalVersion(owner, id, content, 0, wrapped)).rejects.toMatchObject({ code: 'conflict' });
        const original = await tx.get('SELECT snapshot_sha256 FROM crm_proposal_versions WHERE id = ?', [firstId]);
        await expect(tx.run('UPDATE crm_proposal_versions SET total_cents = 0 WHERE id = ?', [firstId]))
          .rejects.toThrow();
        await expect(tx.run('DELETE FROM crm_proposal_versions WHERE id = ?', [firstId]))
          .rejects.toThrow();
        await transitionProposal(owner, id, 'marked_sent', '', wrapped);
        await expect(transitionProposal(owner, id, 'marked_sent', '', wrapped))
          .rejects.toMatchObject({ code: 'transition_invalid' });
        const firstTask = await tx.get('SELECT task_id FROM crm_proposal_followups WHERE version_id = ?', [firstId]);
        expect(firstTask).toBeTruthy();
        await saveProposalVersion(owner, id, { ...content, scope: 'Alcance corregido' }, 1, wrapped);
        expect((await tx.get('SELECT cancelled_at FROM crm_tasks WHERE id = ?', [firstTask!.task_id]))?.cancelled_at).toBeTruthy();
        expect((await tx.get('SELECT snapshot_sha256 FROM crm_proposal_versions WHERE id = ?', [firstId]))?.snapshot_sha256).toBe(original?.snapshot_sha256);
        await transitionProposal(owner, id, 'marked_sent', '', wrapped);
        const latest = await getProposal(owner, id, wrapped);
        const secondTask = await tx.get('SELECT task_id FROM crm_proposal_followups WHERE version_id = ?', [latest.versions[0].id]);
        const key = randomBytes(32).toString('hex'); const connectionId = randomUUID();
        await tx.run(`INSERT INTO crm_gmail_connections
          (id,owner_user_id,google_subject,email,refresh_token_ciphertext,token_key_version,
           scope,label_id,status,created_at,updated_at)
          VALUES (?,?,?,?,?,'v1','gmail.metadata','Label_Test','connected',?,?)`,
        [connectionId, ownerId, `google_synthetic_${ownerId}`, owner.email,
          encryptGmailToken('synthetic-refresh', key), at, at]);
        const makeMessage = (messageId: string, from: string, to: string): GmailMessage => ({
          id: messageId, threadId: 'synthetic-thread', labelIds: ['Label_Test'],
          internalDate: '1760000000000', payload: { headers: [
            { name: 'From', value: from }, { name: 'To', value: to },
            { name: 'Subject', value: 'Proyecto sintético' }] },
        });
        const messages = {
          out: makeMessage('out', owner.email, 'contact.phase3@example.test'),
          incoming: makeMessage('incoming', 'contact.phase3@example.test', owner.email),
        };
        let failOnce = true;
        const provider: GmailProvider = { profile: async () => ({ historyId: '100' }),
          list: async () => ({ messages: [{ id: 'out' }, { id: 'incoming' }] }),
          history: async () => ({ historyId: '101', history: [{ messagesAdded: [{ message: { id: 'incoming' } }] }] }),
          message: async (messageId) => {
            if (messageId === 'incoming' && failOnce) { failOnce = false; throw new Error('synthetic_interruption'); }
            return messages[messageId as keyof typeof messages];
          } };
        let connection = (await tx.get('SELECT * FROM crm_gmail_connections WHERE id = ?', [connectionId]))!;
        await expect(syncGmailConnection(wrapped, owner, connection, provider)).rejects.toThrow('synthetic_interruption');
        expect((await tx.get('SELECT history_id FROM crm_gmail_connections WHERE id = ?', [connectionId]))?.history_id).toBeNull();
        expect(Number((await tx.get('SELECT COUNT(*) AS n FROM crm_gmail_messages WHERE connection_id = ?', [connectionId]))?.n)).toBe(1);
        const thread = (await tx.get('SELECT id FROM crm_gmail_threads WHERE connection_id = ?', [connectionId]))!;
        await linkGmailThread(owner, { threadId: String(thread.id), organizationId, contactId, proposalId: id }, wrapped);
        const result = await syncGmailConnection(wrapped, owner, connection, provider);
        expect(result.imported).toBe(1);
        expect((await tx.get('SELECT cancelled_at FROM crm_tasks WHERE id = ?', [secondTask!.task_id]))?.cancelled_at).toBeTruthy();
        connection = (await tx.get('SELECT * FROM crm_gmail_connections WHERE id = ?', [connectionId]))!;
        expect((await syncGmailConnection(wrapped, owner, connection, provider)).imported).toBe(0);
        expect(Number((await tx.get('SELECT COUNT(*) AS n FROM crm_gmail_messages WHERE connection_id = ?', [connectionId]))?.n)).toBe(2);
        expect((await getGmailThread(owner, String(thread.id), wrapped)).messages).toHaveLength(2);
        const draftId = await createLocalDraft(owner, { organizationId, contactId, proposalId: id,
          threadId: String(thread.id), subject: 'Respuesta sintética', body: 'Borrador para revisión' }, wrapped);
        await updateLocalDraft(owner, draftId, { subject: 'Respuesta revisada',
          body: 'Contenido sintético aprobado internamente', status: 'approved' }, wrapped);
        expect((await getLocalDraft(owner, draftId, wrapped)).status).toBe('approved');
        await recordGmailIncident(wrapped, connectionId, new Error('gmail_provider_401'));
        expect((await tx.get('SELECT status FROM crm_gmail_connections WHERE id = ?', [connectionId]))?.status).toBe('needs_reauth');
        expect(Number((await tx.get(`SELECT COUNT(*) AS n FROM crm_gmail_sync_incidents
          WHERE connection_id = ? AND status = 'open'`, [connectionId]))?.n)).toBe(1);
        await transitionProposal(owner, id, 'accepted', 'Confirmación sintética', wrapped);
        expect((await tx.get('SELECT stage FROM crm_opportunities WHERE id = ?', [opportunityId]))?.stage).toBe('new');
        const copy = await duplicateProposal(owner, id, wrapped);
        expect((await getProposal(owner, copy, wrapped)).versions).toHaveLength(1);
        expect(Number((await tx.get(`SELECT COUNT(*) AS n FROM altaria_admin_audit_events
          WHERE actor_user_id = ? AND action LIKE 'proposal.%'`, [ownerId]))?.n)).toBeGreaterThan(3);
        throw rollback;
      }).immediate();
    } catch (error) { if (error !== rollback) throw error; }
    await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
    expect(await counts()).toEqual(before);
    expect(await db.all('PRAGMA foreign_key_check')).toHaveLength(0);
  });
});
