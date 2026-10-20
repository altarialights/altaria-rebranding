import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {connect,type Connection} from '@tursodatabase/serverless';
import {describe,expect,it} from 'vitest';
import {assertRemoteTestMarker,assertStagingWorkOS,assertTestDatabase,
  assertTestStripe,readProjectEnv} from '../scripts/lib/test-isolation.mjs';
import type {AdminPrincipal} from '../src/lib/admin/access';
import {changeOpportunityStage,createOpportunity} from '../src/lib/admin/crm/service';
import {createLocalDraft} from '../src/lib/admin/gmail/service';
import {dispatchOutbox,claimJob,processOneJob} from '../src/lib/admin/automation/engine';
import {createSalesEntry,createSalesFollowup,getSalesContext,getSalesEntry,
  listSalesEntries,prepareSalesDraft,recordChannelReview,reviewSalesEntry,
  reviseSalesEntry,submitSalesEntry,validateSalesInput} from '../src/lib/admin/sales/library';

const sample={title:'Guion sintético de prueba',category:'call' as const,product:'Producto sintético',
  sector:'general',channel:'phone' as const,stage:'new' as const,
  body:'¿Cómo se realiza actualmente este proceso en su empresa de prueba?',
  nextStep:'Acordar un paso manual si la empresa lo solicita.'};

describe('Sales OS — TEST aislado y sintético',()=>{
  it('valida contenido sin acceso remoto',()=>{
    expect(validateSalesInput(sample).title).toBe(sample.title);
    expect(()=>validateSalesInput({...sample,category:'unknown' as never})).toThrow();
    expect(()=>validateSalesInput({...sample,body:'corto'})).toThrow();
  });

  it('protege permisos, versiones, contexto, tareas, oposiciones y automatización con rollback',async()=>{
    expect(process.env.ALTARIA_PHASE65B_INTEGRATION_TEST).toBe('1');
    const t=readProjectEnv('.env.test'),p=readProjectEnv('.env');
    if(!t?.TURSO_DATABASE_URL||!t.TURSO_AUTH_TOKEN)throw new Error('Falta TEST.');
    assertTestDatabase({targetUrl:t.TURSO_DATABASE_URL,token:t.TURSO_AUTH_TOKEN,
      approvedUrl:t.ALTARIA_TEST_TURSO_URL,productionEnv:p as never});
    assertTestStripe({mode:t.STRIPE_MODE,secretKey:t.STRIPE_SECRET_KEY,
      webhookSecret:t.STRIPE_WEBHOOK_SECRET,productionEnv:p as never});
    assertStagingWorkOS({clientId:t.WORKOS_CLIENT_ID,apiKey:t.WORKOS_API_KEY,
      redirectUri:t.WORKOS_REDIRECT_URI,cookiePassword:t.WORKOS_COOKIE_PASSWORD,productionEnv:p as never});
    const token=JSON.parse(Buffer.from(t.TURSO_AUTH_TOKEN.split('.')[1]??'','base64url').toString());
    expect(token.exp*1000).toBeGreaterThan(Date.now());
    const db=connect({url:t.TURSO_DATABASE_URL,authToken:t.TURSO_AUTH_TOKEN});
    await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
    const hash=createHash('sha256').update(readFileSync('migrations/018_altaria_os_sales.sql')).digest('hex');
    expect((await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name=?',
      ['018_altaria_os_sales.sql']))?.sha256).toBe(hash);
    const original=await db.get(`SELECT COUNT(*) AS n FROM crm_sales_entries WHERE seed_key IS NOT NULL`);
    expect(Number(original?.n)).toBe(29);
    Object.assign(process.env,{ALTARIA_TEST_ISOLATED:'1',ALTARIA_TEST_DB_MARKER:t.ALTARIA_TEST_DB_MARKER,
      ALTARIA_TEST_TURSO_URL:t.ALTARIA_TEST_TURSO_URL,TURSO_DATABASE_URL:t.TURSO_DATABASE_URL,
      STRIPE_MODE:'test',STRIPE_SECRET_KEY:t.STRIPE_SECRET_KEY});
    const rollback=new Error('ROLLBACK_SYNTHETIC_PHASE65B');
    try{await db.transactionAsync(async tx=>{
      const wrapped={get:tx.get.bind(tx),all:tx.all.bind(tx),run:tx.run.bind(tx),batch:tx.batch.bind(tx),
        transactionAsync:(callback:(conn:typeof tx)=>Promise<unknown>)=>({immediate:()=>callback(tx)})} as unknown as Connection;
      const date=new Date().toISOString();
      const ids={owner:randomUUID(),sales:randomUUID(),other:randomUUID(),viewer:randomUUID(),production:randomUUID()};
      for(const [role,id] of Object.entries(ids)){
        await tx.run(`INSERT INTO altaria_admin_users(id,email,workos_user_id,display_name,status,created_at,updated_at)
          VALUES (?,?,?,'Persona sintética','active',?,?)`,[id,`${role}.phase65b@example.test`,`user_synthetic_${id}`,date,date]);
        await tx.run('INSERT INTO altaria_admin_user_roles(user_id,role_key,granted_at) VALUES (?,?,?)',
          [id,role==='other'?'sales':role,date]);
      }
      const principal=(role:keyof typeof ids):AdminPrincipal=>({id:ids[role],
        email:`${role}.phase65b@example.test`,displayName:'Persona sintética',
        roles:[role==='other'?'sales':role] as AdminPrincipal['roles'],sessionHash:`synthetic-${role}`});
      const owner=principal('owner'),sales=principal('sales'),other=principal('other'),viewer=principal('viewer'),
        production=principal('production');
      const orgId=randomUUID(),contactId=randomUUID();
      await tx.run(`INSERT INTO crm_organizations(id,name,normalized_name,lead_origin,responsible_user_id,created_at,updated_at)
        VALUES (?,'Empresa Sintética Sales','empresa sintetica sales','manual',?,?,?)`,[orgId,sales.id,date,date]);
      await tx.run(`INSERT INTO crm_contacts(id,organization_id,full_name,email,created_at,updated_at)
        VALUES (?,?,'Contacto Sintético','contacto@example.test',?,?)`,[contactId,orgId,date,date]);
      await expect(createSalesEntry(production,sample,wrapped)).rejects.toMatchObject({code:'forbidden'});
      const draftEntry=await createSalesEntry(sales,{...sample,title:'Borrador sintético'},wrapped,null,'draft');
      await expect(reviewSalesEntry(owner,draftEntry,'approve',1,wrapped)).rejects.toMatchObject({code:'version_conflict'});
      await submitSalesEntry(sales,draftEntry,1,wrapped);
      await reviewSalesEntry(owner,draftEntry,'approve',1,wrapped);
      const entryId=await createSalesEntry(sales,sample,wrapped);
      expect((await getSalesEntry(sales,entryId,wrapped)).current.version).toBe(1);
      await expect(getSalesEntry(other,entryId,wrapped)).rejects.toMatchObject({code:'forbidden'});
      await expect(reviewSalesEntry(sales,entryId,'approve',1,wrapped)).rejects.toMatchObject({code:'forbidden'});
      expect((await listSalesEntries(viewer,{q:'sintético'},wrapped)).some(e=>e.id===entryId)).toBe(false);
      const version2=await reviseSalesEntry(sales,entryId,{...sample,body:'Texto revisado para una conversación sintética sin afirmaciones comerciales.'},1,wrapped);
      expect(version2).toBe(2);
      await expect(reviseSalesEntry(sales,entryId,sample,1,wrapped)).rejects.toMatchObject({code:'version_conflict'});
      await expect(tx.run('UPDATE crm_sales_entry_versions SET body=? WHERE entry_id=? AND version=1',['Cambio indebido',entryId])).rejects.toThrow();
      await reviewSalesEntry(owner,entryId,'approve',2,wrapped);
      expect((await listSalesEntries(viewer,{category:'call',q:'sintético'},wrapped)).some(e=>e.id===entryId)).toBe(true);
      expect((await listSalesEntries(viewer,{category:'email'},wrapped)).some(e=>e.id===entryId)).toBe(false);
      const next=await reviseSalesEntry(owner,entryId,{...sample,title:'Guion en revisión posterior'},2,wrapped);
      expect(next).toBe(3);
      expect((await getSalesEntry(viewer,entryId,wrapped)).current.version).toBe(2);
      expect((await getSalesEntry(viewer,entryId,wrapped,2)).current.version).toBe(2);
      await expect(getSalesEntry(viewer,entryId,wrapped,1)).rejects.toMatchObject({code:'forbidden'});
      await expect(getSalesEntry(viewer,entryId,wrapped,3)).rejects.toMatchObject({code:'forbidden'});
      const historical=await getSalesEntry(owner,entryId,wrapped,2);
      expect(historical.current.version).toBe(2);
      expect(historical.history.map(v=>Number(v.version))).toEqual([3,2,1]);
      expect(historical.events.some(e=>e.kind==='approved'&&Number(e.version)===2)).toBe(true);
      await expect(reviseSalesEntry(sales,entryId,sample,3,wrapped)).rejects.toMatchObject({code:'forbidden'});
      await expect(getSalesContext(other,orgId,null,wrapped)).rejects.toMatchObject({code:'forbidden'});
      expect((await getSalesContext(sales,orgId,null,wrapped)).org.id).toBe(orgId);
      const opportunityId=await createOpportunity(sales,{organizationId:orgId,title:'Oportunidad sintética',
        amountEuros:null,responsibleUserId:null},wrapped);
      const outbox=await tx.get(`SELECT id FROM os_outbox WHERE event_type='sales.opportunity.guide' AND source_id=?`,[opportunityId]);
      expect(outbox?.id).toBeTruthy();
      await dispatchOutbox(wrapped,100);
      const job=await tx.get('SELECT id FROM os_jobs WHERE event_id=?',[outbox?.id]);
      expect(job?.id).toBeTruthy();
      const claimed=await claimJob(wrapped);
      expect(claimed).not.toBeNull();
      await tx.run(`UPDATE os_jobs SET status='queued',lease_token=NULL,leased_until=NULL,
        run_at='2000-01-01T00:00:00.000Z' WHERE id=?`,[job?.id]);
      await processOneJob(wrapped);
      const work=await tx.get(`SELECT id FROM os_work_items WHERE source_type='crm_opportunity' AND source_id=?
        AND dedupe_key LIKE 'sales.opportunity.guide:%'`,[opportunityId]);
      expect(work?.id).toBeTruthy();
      await changeOpportunityStage(sales,{opportunityId,toStage:'contacted',lostReason:null},wrapped);
      const nextOutbox=await tx.get(`SELECT id FROM os_outbox WHERE event_type='sales.opportunity.guide'
        AND source_id=? AND id<>?`,[opportunityId,outbox?.id]);
      expect(nextOutbox?.id).toBeTruthy();
      await dispatchOutbox(wrapped,100);
      const nextJob=await tx.get('SELECT id FROM os_jobs WHERE event_id=?',[nextOutbox?.id]);
      for(let i=0;i<20;i++){
        if((await tx.get('SELECT status FROM os_jobs WHERE id=?',[nextJob?.id]))?.status==='done')break;
        await processOneJob(wrapped);
      }
      expect((await tx.get('SELECT status FROM os_jobs WHERE id=?',[nextJob?.id]))?.status).toBe('done');
      expect(Number((await tx.get(`SELECT COUNT(*) AS n FROM os_work_items WHERE source_id=?
        AND dedupe_key LIKE 'sales.opportunity.guide:%' AND status='open'`,[opportunityId]))?.n)).toBe(1);
      expect((await tx.get('SELECT status FROM os_work_items WHERE id=?',[work?.id]))?.status).toBe('cancelled');
      const taskId=await createSalesFollowup(sales,{organizationId:orgId,opportunityId,
        title:'Seguimiento sintético acordado',dueAt:null},wrapped);
      expect((await tx.get('SELECT opportunity_id FROM crm_tasks WHERE id=?',[taskId]))?.opportunity_id).toBe(opportunityId);
      await expect(createSalesFollowup(other,{organizationId:orgId,opportunityId,
        title:'No autorizado',dueAt:null},wrapped)).rejects.toMatchObject({code:'forbidden'});
      const campaignId=randomUUID();
      await tx.run(`INSERT INTO crm_prospect_campaigns(id,title,status,created_by,created_at)
        VALUES (?,'Campaña sintética limitada','draft',?,?)`,[campaignId,owner.id,date]);
      const members=[] as {sql:string;args:string[]}[];
      for(let i=0;i<21;i++){
        const id=randomUUID();
        members.push({sql:`INSERT INTO crm_organizations(id,name,normalized_name,lead_origin,responsible_user_id,created_at,updated_at)
          VALUES (?,?,?,'manual',?,?,?)`,args:[id,`Empresa TEST ${i+1}`,`empresa test ${i+1}`,sales.id,date,date]});
        if(i<20)members.push({sql:`INSERT INTO crm_prospect_campaign_members(campaign_id,organization_id,added_by,added_at)
          VALUES(?,?,?,?)`,args:[campaignId,id,owner.id,date]});
        else{
          await tx.batch(members);members.length=0;
          await expect(tx.run(`INSERT INTO crm_prospect_campaign_members(campaign_id,organization_id,added_by,added_at)
            VALUES(?,?,?,?)`,[campaignId,id,owner.id,date])).rejects.toThrow();
        }
      }
      expect(Number((await tx.get('SELECT COUNT(*) AS n FROM crm_prospect_campaign_members WHERE campaign_id=?',[campaignId]))?.n)).toBe(20);
      await recordChannelReview(sales,{organizationId:orgId,contactId,channel:'email',
        decision:'opposed',reason:'Oposición sintética registrada'},wrapped);
      await expect(prepareSalesDraft(owner,{entryId,organizationId:orgId,opportunityId,contactId,
        subject:'Prueba sintética',body:'Contenido local sintético sin envío.'},wrapped)).rejects.toMatchObject({code:'channel_blocked'});
      await expect(createLocalDraft(owner,{organizationId:orgId,contactId,proposalId:null,threadId:null,
        subject:'Prueba sintética',body:'Contenido local sintético sin envío.'},wrapped)).rejects.toMatchObject({code:'channel_blocked'});
      await expect(recordChannelReview(sales,{organizationId:orgId,contactId,channel:'email',
        decision:'eligible',reason:'Intento de levantar oposición'},wrapped)).rejects.toMatchObject({code:'forbidden'});
      await recordChannelReview(owner,{organizationId:orgId,contactId,channel:'email',
        decision:'eligible',reason:'Revisión explícita sintética'},wrapped);
      const draft=await prepareSalesDraft(owner,{entryId,organizationId:orgId,opportunityId,contactId,
        subject:'Prueba sintética',body:'Contenido local sintético sin envío.'},wrapped);
      expect((await tx.get('SELECT version_id FROM crm_sales_draft_sources WHERE draft_id=?',[draft]))?.version_id).toBeTruthy();
      expect((await tx.get('SELECT status FROM crm_gmail_drafts WHERE id=?',[draft]))?.status).toBe('review');
      expect((await tx.get(`SELECT COUNT(*) AS n FROM altaria_admin_audit_events WHERE target_id=?`,[entryId]))?.n).toBeGreaterThan(0);
      throw rollback;
    }).immediate();}catch(error){if(error!==rollback)throw error;}
    expect(Number((await db.get(`SELECT COUNT(*) AS n FROM crm_sales_entries WHERE seed_key IS NOT NULL`))?.n)).toBe(29);
    expect((await db.get(`SELECT id FROM altaria_admin_users WHERE email='sales.phase65b@example.test'`))).toBeUndefined();
    await assertRemoteTestMarker(db,t.ALTARIA_TEST_DB_MARKER);
  },120_000);
});
