import { createHash,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect,type Connection } from '@tursodatabase/serverless';
import { describe,expect,it } from 'vitest';
import { assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv } from '../scripts/lib/test-isolation.mjs';
import type { AdminPrincipal } from '../src/lib/admin/access';
import { dispatchOutbox,claimJob,processOneJob,processOneNotification,
  prepareDailyBrief } from '../src/lib/admin/automation/engine';
import { requestWorkApproval,reviewApproval,executeApproval,expireApprovals } from '../src/lib/admin/automation/approvals';
import { completeWorkItem,listMyWork } from '../src/lib/admin/automation/work';

describe('Fase 6: TEST sintético y transacción revertida',()=>{
  it('deduplica eventos/jobs, recupera leases, protege aprobaciones y simula Telegram',async()=>{
    expect(process.env.ALTARIA_PHASE6_INTEGRATION_TEST).toBe('1');
    const production=readProjectEnv('.env'),test=readProjectEnv('.env.test');
    if(!test?.TURSO_DATABASE_URL||!test.TURSO_AUTH_TOKEN||!test.ALTARIA_TEST_DB_MARKER)
      throw new Error('Falta TEST.');
    assertTestDatabase({targetUrl:test.TURSO_DATABASE_URL,token:test.TURSO_AUTH_TOKEN,
      approvedUrl:test.ALTARIA_TEST_TURSO_URL,productionEnv:production as never});
    assertTestStripe({mode:test.STRIPE_MODE,secretKey:test.STRIPE_SECRET_KEY,
      webhookSecret:test.STRIPE_WEBHOOK_SECRET,productionEnv:production as never});
    assertStagingWorkOS({clientId:test.WORKOS_CLIENT_ID,apiKey:test.WORKOS_API_KEY,
      redirectUri:test.WORKOS_REDIRECT_URI,cookiePassword:test.WORKOS_COOKIE_PASSWORD,
      productionEnv:production as never});
    const token=JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1]||'','base64url').toString());
    expect(token.exp*1000).toBeGreaterThan(Date.now());
    const db=connect({url:test.TURSO_DATABASE_URL,authToken:test.TURSO_AUTH_TOKEN});
    await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
    const hash=createHash('sha256').update(readFileSync('migrations/017_altaria_os_automations.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
      ['017_altaria_os_automations.sql']))?.sha256).toBe(hash);
    const tables=['os_outbox','os_jobs','os_work_items','os_notifications','os_daily_briefs','os_approvals'];
    const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>
      [name,Number((await db.get(`SELECT count(*) AS n FROM ${name}`))?.n)] as const)));
    const before=await counts();
    Object.assign(process.env,{ALTARIA_TEST_ISOLATED:'1',ALTARIA_TEST_DB_MARKER:test.ALTARIA_TEST_DB_MARKER,
      ALTARIA_TEST_TURSO_URL:test.ALTARIA_TEST_TURSO_URL,TURSO_DATABASE_URL:test.TURSO_DATABASE_URL,
      STRIPE_MODE:'test',STRIPE_SECRET_KEY:test.STRIPE_SECRET_KEY});
    const rollback=new Error('ROLLBACK_SYNTHETIC_PHASE6');
    try {
      await db.transactionAsync(async tx=>{
        const wrapped={get:tx.get.bind(tx),all:tx.all.bind(tx),run:tx.run.bind(tx),
          batch:tx.batch.bind(tx),transactionAsync:(callback:(conn:typeof tx)=>Promise<unknown>)=>
            ({immediate:()=>callback(tx)})} as unknown as Connection;
        const at=new Date().toISOString();
        const ids={owner:randomUUID(),sales:randomUUID(),production:randomUUID(),viewer:randomUUID()};
        for(const [role,id] of Object.entries(ids)) {
          await tx.run(`INSERT INTO altaria_admin_users
            (id,email,workos_user_id,display_name,status,created_at,updated_at)
            VALUES (?,?,?,'Persona sintética','active',?,?)`,
            [id,`${role}.phase6@example.test`,`user_synthetic_${id}`,at,at]);
          await tx.run('INSERT INTO altaria_admin_user_roles(user_id,role_key,granted_at) VALUES (?,?,?)',
            [id,role,at]);
        }
        const principal=(role:keyof typeof ids):AdminPrincipal=>({id:ids[role],
          email:`${role}.phase6@example.test`,displayName:'Persona sintética',roles:[role],
          sessionHash:`synthetic-${role}`});
        const owner=principal('owner'),sales=principal('sales'),productionUser=principal('production'),
          viewer=principal('viewer');
        const orgId=randomUUID(),activityId=randomUUID();
        await tx.run(`INSERT INTO crm_organizations
          (id,name,normalized_name,lead_origin,responsible_user_id,created_at,updated_at)
          VALUES (?,'Empresa Sintética Fase 6','empresa sintetica fase 6','manual',?,?,?)`,
          [orgId,sales.id,at,at]);
        await tx.run(`INSERT INTO crm_activities
          (id,organization_id,kind,summary,happened_at,actor_user_id,created_at)
          VALUES (?,?,'call','Llamada sintética',?,?,?)`,[activityId,orgId,at,sales.id,at]);
        const event=await tx.get('SELECT id,dedupe_key FROM os_outbox WHERE source_id=?',[activityId]);
        expect(event?.dedupe_key).toBe(`call.next:${activityId}`);
        await expect(tx.run(`INSERT INTO os_outbox
          (id,event_type,source_type,source_id,dedupe_key,payload_json,created_at)
          VALUES (?,'call.next','crm_activity',? ,?,'{}',?)`,
          [randomUUID(),activityId,`call.next:${activityId}`,at])).rejects.toThrow();
        await dispatchOutbox(wrapped,100);
        const job=await tx.get('SELECT id FROM os_jobs WHERE event_id=?',[event?.id]);
        expect(job?.id).toBeTruthy();
        await tx.run("UPDATE os_jobs SET run_at='2000-01-01T00:00:00.000Z' WHERE id=?",[job?.id]);
        const first=await claimJob(wrapped);
        expect(first?.id).toBe(job?.id);
        const second=await claimJob(wrapped);
        expect(second?.id).not.toBe(job?.id);
        await tx.run(`UPDATE os_jobs SET leased_until='2000-01-01T00:00:00.000Z'
          WHERE id=?`,[job?.id]);
        const reclaimed=await claimJob(wrapped);
        expect(reclaimed?.id).toBe(job?.id);
        expect(Number(reclaimed?.attempts)).toBe(2);
        expect((await tx.get(`SELECT count(*) AS n FROM os_job_attempts
          WHERE job_id=? AND error_code='lease_expired'`,[job?.id]))?.n).toBe(1);
        await tx.run(`UPDATE os_jobs SET status='queued',lease_token=NULL,leased_until=NULL,
          run_at='2000-01-01T00:00:00.000Z' WHERE id=?`,[job?.id]);
        await processOneJob(wrapped);
        const suggestion=await tx.get('SELECT id FROM os_work_items WHERE source_id=?',[activityId]);
        expect(suggestion?.id).toBeTruthy();
        expect((await listMyWork(sales,wrapped)).some(item=>item.id===suggestion?.id)).toBe(true);
        expect((await listMyWork(productionUser,wrapped)).some(item=>item.id===suggestion?.id)).toBe(false);
        await expect(completeWorkItem(viewer,String(suggestion?.id),wrapped)).rejects.toMatchObject({code:'forbidden'});
        const expires=new Date(Date.now()+24*60*60_000).toISOString();
        const approval=await requestWorkApproval(sales,String(suggestion?.id),expires,wrapped);
        await expect(reviewApproval(sales,approval,'approved',wrapped)).rejects.toMatchObject({code:'forbidden'});
        expect(await reviewApproval(owner,approval,'approved',wrapped)).toBe('approved');
        await tx.run('UPDATE os_work_items SET title=? WHERE id=?',
          ['Contenido cambiado sintético',suggestion?.id]);
        expect(await executeApproval(owner,approval,wrapped)).toBe('content_changed');
        expect((await tx.get('SELECT status FROM os_work_items WHERE id=?',[suggestion?.id]))?.status).toBe('open');
        const valid=await requestWorkApproval(sales,String(suggestion?.id),expires,wrapped);
        expect(await reviewApproval(owner,valid,'approved',wrapped)).toBe('approved');
        expect(await executeApproval(owner,valid,wrapped)).toBe('executed');
        await expect(executeApproval(owner,valid,wrapped)).rejects.toMatchObject({code:'approval_not_approved'});
        expect((await tx.get('SELECT status FROM os_work_items WHERE id=?',[suggestion?.id]))?.status).toBe('done');
        const opportunityId=randomUUID(),followupId=randomUUID(),relatedCallId=randomUUID();
        await tx.run(`INSERT INTO crm_opportunities
          (id,organization_id,title,stage,responsible_user_id,created_at,updated_at)
          VALUES (?,?,'Oportunidad sintética','negotiation',?,?,?)`,
          [opportunityId,orgId,sales.id,at,at]);
        await tx.run(`INSERT INTO crm_tasks
          (id,organization_id,opportunity_id,title,due_at,responsible_user_id,
            created_by,created_at,updated_at)
          VALUES (?,?,?,'Seguimiento sintético vencido','2000-01-01T00:00:00.000Z',?,?,?,?)`,
          [followupId,orgId,opportunityId,sales.id,sales.id,at,at]);
        expect((await listMyWork(sales,wrapped)).find(item=>item.id===followupId)?.priority).toBe('urgent');
        await tx.run(`INSERT INTO crm_activities
          (id,organization_id,opportunity_id,kind,summary,happened_at,actor_user_id,created_at)
          VALUES (?,?,?,'call','Llamada vinculada',?,?,?)`,
          [relatedCallId,orgId,opportunityId,at,sales.id,at]);
        await dispatchOutbox(wrapped,100);
        await tx.run("UPDATE os_rule_config SET enabled=0 WHERE rule_key='call.next'");
        await tx.run("UPDATE os_jobs SET run_at='2000-01-01T00:00:00.000Z' WHERE rule_key='call.next' AND status='queued'");
        const pausedJob=await tx.get(`SELECT j.id FROM os_jobs j JOIN os_outbox o ON o.id=j.event_id
          WHERE o.source_id=?`,[relatedCallId]);
        expect((await claimJob(wrapped))?.id).not.toBe(pausedJob?.id);
        expect((await tx.get('SELECT status FROM os_jobs WHERE id=?',[pausedJob?.id]))?.status).toBe('queued');
        await tx.run("UPDATE os_rule_config SET enabled=1 WHERE rule_key='call.next'");
        await processOneJob(wrapped);
        const relatedWork=await tx.get('SELECT id FROM os_work_items WHERE source_id=?',[relatedCallId]);
        expect(relatedWork?.id).toBeTruthy();
        await tx.run(`UPDATE crm_opportunities SET stage='lost',closed_at=?,lost_reason=?,
          version=2,updated_at=? WHERE id=?`,[at,'Motivo sintético',at,opportunityId]);
        await tx.run(`INSERT INTO crm_opportunity_stage_events
          (id,opportunity_id,from_stage,to_stage,opportunity_version,actor_user_id,occurred_at)
          VALUES (?,?,'negotiation','lost',2,?,?)`,
          [randomUUID(),opportunityId,sales.id,at]);
        await dispatchOutbox(wrapped,100);
        await tx.run("UPDATE os_jobs SET run_at='2000-01-01T00:00:00.000Z' WHERE rule_key='opportunity.lost' AND status='queued'");
        await processOneJob(wrapped);
        expect((await tx.get('SELECT cancel_reason FROM crm_tasks WHERE id=?',[followupId]))?.cancel_reason)
          .toBe('opportunity_lost');
        expect((await tx.get('SELECT status FROM os_work_items WHERE id=?',[relatedWork?.id]))?.status)
          .toBe('cancelled');
        expect((await tx.get(`SELECT count(*) AS n FROM altaria_admin_audit_events
          WHERE action='os.rule.opportunity.lost' AND target_type='automation_job'`))?.n).toBeGreaterThan(0);
        const expiryWorkId=randomUUID();
        await tx.run(`INSERT INTO os_work_items
          (id,kind,source_type,source_id,dedupe_key,title,priority,organization_id,status,created_at)
          VALUES (?,'next_action','crm_activity',?,?,'Acción para aprobación','normal',?,'open',?)`,
          [expiryWorkId,relatedCallId,`expiry:${expiryWorkId}`,orgId,at]);
        const expiryApproval=await requestWorkApproval(sales,expiryWorkId,expires,wrapped);
        await tx.run("UPDATE os_approvals SET requested_at='1999-01-01T00:00:00.000Z' WHERE id=?",
          [expiryApproval]);
        await tx.run("UPDATE os_approvals SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
          [expiryApproval]);
        expect(await expireApprovals(wrapped)).toBeGreaterThan(0);
        expect((await tx.get('SELECT status FROM os_approvals WHERE id=?',[expiryApproval]))?.status)
          .toBe('expired');
        const exhaustedJob=randomUUID(),exhaustedLease=randomUUID();
        await tx.run(`INSERT INTO os_jobs
          (id,rule_key,event_id,idempotency_key,status,run_at,lease_token,leased_until,
            attempts,max_attempts,created_at,updated_at)
          VALUES (?,'call.next',?,?,'leased',?,?,?,1,1,?,?)`,
          [exhaustedJob,event?.id,`exhausted:${exhaustedJob}`,at,exhaustedLease,
            '2000-01-01T00:00:00.000Z',at,at]);
        await claimJob(wrapped);
        expect((await tx.get('SELECT status FROM os_jobs WHERE id=?',[exhaustedJob]))?.status)
          .toBe('dead');
        expect((await tx.get(`SELECT outcome FROM os_job_attempts WHERE job_id=?
          AND error_code='lease_exhausted'`,[exhaustedJob]))?.outcome).toBe('dead');
        const notificationId=randomUUID();
        await tx.run(`INSERT INTO os_notifications
          (id,channel,template_key,urgency,dedupe_key,payload_json,status,run_at,created_at)
          VALUES (?,'telegram_simulated','cards.paid','important',?,?,'queued','2000-01-01T00:00:00.000Z',?)`,
          [notificationId,`synthetic:${notificationId}`,JSON.stringify({resourceType:'card_order',
            resourceId:randomUUID()}),at]);
        await processOneNotification(wrapped,{async deliver(){throw Object.assign(new Error('mock'),{code:'provider_error'});}});
        expect((await tx.get('SELECT status,last_error_code FROM os_notifications WHERE id=?',
          [notificationId]))?.last_error_code).toBe('provider_error');
        await tx.run("UPDATE os_notifications SET run_at='2000-01-01T00:00:00.000Z' WHERE id=?",[notificationId]);
        await processOneNotification(wrapped);
        expect((await tx.get('SELECT status FROM os_notifications WHERE id=?',[notificationId]))?.status).toBe('delivered');
        const exhaustedNotice=randomUUID(),noticeLease=randomUUID();
        await tx.run(`INSERT INTO os_notifications
          (id,channel,template_key,urgency,dedupe_key,payload_json,status,run_at,
            lease_token,leased_until,attempts,max_attempts,created_at)
          VALUES (?,'telegram_simulated','cards.paid','important',?,'{}','leased',
            '2000-01-01T00:00:00.000Z',?,'2000-01-01T00:00:00.000Z',1,1,?)`,
          [exhaustedNotice,`exhausted:${exhaustedNotice}`,noticeLease,at]);
        await processOneNotification(wrapped);
        expect((await tx.get('SELECT status FROM os_notifications WHERE id=?',[exhaustedNotice]))?.status)
          .toBe('dead');
        expect((await tx.get(`SELECT outcome FROM os_notification_attempts
          WHERE notification_id=? AND error_code='lease_exhausted'`,[exhaustedNotice]))?.outcome)
          .toBe('dead');
        const syntheticBriefDate=new Date(Date.now()+3650*24*60*60_000);
        expect(await prepareDailyBrief(wrapped,syntheticBriefDate,true)).toBe(true);
        expect(await prepareDailyBrief(wrapped,syntheticBriefDate,true)).toBe(false);
        expect((await tx.get('SELECT count(*) AS n FROM os_daily_briefs'))?.n).toBeGreaterThan(0);
        const briefRow=await tx.get(`SELECT b.snapshot_json,n.payload_json FROM os_daily_briefs b
          JOIN os_notifications n ON n.id=b.telegram_notification_id ORDER BY b.day_madrid DESC LIMIT 1`);
        expect(JSON.parse(String(briefRow?.payload_json)).briefCounts)
          .toEqual(JSON.parse(String(briefRow?.snapshot_json)).counts);
        process.env.STRIPE_MODE='live';
        await expect(listMyWork(owner,wrapped)).rejects.toMatchObject({code:'test_required'});
        process.env.STRIPE_MODE='test';
        throw rollback;
      }).immediate();
    } catch(error) {if(error!==rollback) throw error;}
    expect(await counts()).toEqual(before);
    await assertRemoteTestMarker(db,test.ALTARIA_TEST_DB_MARKER);
  });
});
