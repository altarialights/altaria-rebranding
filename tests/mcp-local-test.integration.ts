import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {Connection} from '@tursodatabase/serverless';
import type {AdminPrincipal} from '../src/lib/admin/access';
import {mcpTestPreflight} from '../scripts/lib/mcp-test-preflight.mjs';
import {seedMcpSynthetic,injection,salesInput,syntheticSubject} from './mcp-synthetic-fixture';
import {handlePrivateMcp,availableToolNames} from '../src/lib/admin/mcp/server';
import {runReadTool,type ReadToolName} from '../src/lib/admin/mcp/reads';
import {actionToolNames,prepareMcpAction,reviewMcpAction,executeMcpAction,setMcpGrant} from '../src/lib/admin/mcp/actions';
import {principalForSubject} from '../src/lib/admin/mcp/auth';
import {reviseSalesEntry} from '../src/lib/admin/sales/library';

describe('Fase 7.3A: MCP local con Turso TEST real y rollback obligatorio',()=>{
  it('comprueba 33 herramientas, aislamiento por recurso, acciones y auditoría',async()=>{
    expect(process.env.ALTARIA_MCP_LOCAL_TEST).toBe('1');
    const old={...process.env};
    const {db,test:t,report}=await mcpTestPreflight();
    // Guard every fetch: the only permitted external destination is this pinned TEST database.
    const originalFetch=globalThis.fetch;
    const hostname=new URL(t.TURSO_DATABASE_URL!).hostname;
    let blockedNetwork=0;
    vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.protocol!=='https:'||url.hostname!==hostname){
        blockedNetwork++;throw new Error('External service forbidden in MCP TEST');
      }
      return originalFetch(input,init);
    });
    Object.assign(process.env,{ALTARIA_TEST_ISOLATED:'1',ALTARIA_MCP_ENABLED:'0',
      ALTARIA_TEST_DB_MARKER:t.ALTARIA_TEST_DB_MARKER,ALTARIA_TEST_TURSO_URL:t.ALTARIA_TEST_TURSO_URL,
      TURSO_DATABASE_URL:t.TURSO_DATABASE_URL,STRIPE_MODE:'test',STRIPE_SECRET_KEY:t.STRIPE_SECRET_KEY});
    const tables=['altaria_admin_users','altaria_admin_user_roles','altaria_admin_audit_events',
      'crm_organizations','crm_contacts','crm_opportunities','crm_tasks','crm_activities',
      'crm_timeline_events','crm_opportunity_stage_events','crm_proposals','crm_proposal_events',
      'crm_sales_entries','crm_sales_entry_versions','crm_sales_entry_events','crm_gmail_drafts',
      'pedidos_tarjetas','eventos_pedido','cards_production_jobs','cards_batches','cards_units',
      'cards_destination_refs','cards_redirect_domains','cards_destination_targets','cards_dynamic_links',
      'cards_link_daily_metrics','cards_production_incidents','content_brand_memberships',
      'content_pieces','content_piece_versions','content_events','content_brand_guide_versions',
      'content_review_requests','content_review_decisions','content_publication_records',
      'content_assets','content_piece_assets','os_work_items','os_outbox','os_mcp_access_grants',
      'os_mcp_action_requests','os_mcp_action_events','os_mcp_rate_windows'];
    const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>
      [name,Number((await db.get(`SELECT count(*) AS n FROM ${name}`))?.n)])));
    const before=await counts(),rollback=new Error('ROLLBACK_P73A');
    const passed:string[]=[],executed:string[]=[];
    let auditCount=0,fixtureRun='';
    try{
      try{await db.transactionAsync(async tx=>{
        const wrapped={get:tx.get.bind(tx),all:tx.all.bind(tx),run:tx.run.bind(tx),batch:tx.batch.bind(tx),
          transactionAsync:(callback:(conn:typeof tx)=>Promise<unknown>)=>({immediate:()=>callback(tx)})} as unknown as Connection;
        const openingsBefore=Number((await tx.get('SELECT coalesce(sum(openings),0) AS n FROM cards_link_daily_metrics'))?.n);
        const f=await seedMcpSynthetic(wrapped);fixtureRun=f.run;
        expect(Number((await tx.get('SELECT coalesce(sum(openings),0) AS n FROM cards_link_daily_metrics'))?.n))
          .toBe(openingsBefore+7);
        const {owner,sales,editor,viewer,production,outsider}=f.principals;
        let callId=0;
        const rpc=async(p:AdminPrincipal,prepare:boolean,name:string,args:Record<string,unknown>)=>{
          const response=await handlePrivateMcp(new Request('http://127.0.0.1:4321/mcp',{
            method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
            body:JSON.stringify({jsonrpc:'2.0',id:++callId,method:'tools/call',params:{name,arguments:args}})}),p,prepare,wrapped);
          const raw=await response.text();
          const message=JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')
            ?raw.split('\n').find(x=>x.startsWith('data: '))!.slice(6):raw);
          return {message,raw};
        };
        const success=async(name:string,args:Record<string,unknown>,prepare=false)=>{
          const {message,raw}=await rpc(owner,prepare,name,args);
          expect(message.error,`${name}: ${raw}`).toBeUndefined();
          expect(message.result.isError,`${name}: ${raw}`).not.toBe(true);
          const envelope=JSON.parse(message.result.content[0].text);
          expect(envelope).toMatchObject({source:'altaria_os_test',untrustedBusinessData:true});
          for(const secret of ['TEST_PRIVATE_ARTWORK','TEST_PRIVATE_ASSET_',`PRIVATE-${f.run}`,
            'TEST dirección privada','https://example.test/TEST-P73A-private'])expect(raw).not.toContain(secret);
          return envelope.data;
        };
        const reads:Record<ReadToolName,Record<string,unknown>>={
          crm_search_companies:{q:'TEST P73A'},crm_get_company:{id:f.company},
          crm_list_contacts:{organizationId:f.company,limit:20},
          crm_list_opportunities:{organizationId:f.company},crm_followups_needed:{organizationId:f.company},
          crm_list_pending_proposals:{organizationId:f.company},crm_list_tasks:{organizationId:f.company},
          crm_list_timeline:{organizationId:f.company},sales_find_approved:{q:'TEST P73A'},
          sales_find_objections:{q:'TEST P73A'},sales_get_template:{id:f.approved},
          sales_suggest_materials:{organizationId:f.company},cards_list_orders:{q:`TEST-P73A-${f.run}`},
          cards_needing_production:{},cards_get_production:{orderId:f.order},
          cards_list_batches:{orderId:f.order},cards_list_incidents:{orderId:f.order},cards_aggregate_stats:{},
          content_list_brands:{},content_calendar:{brandId:'altaria-cards',from:'2026-10-12',to:'2026-10-18',dateKind:'editorial_due'},
          content_get_piece:{id:f.piece},content_list_states:{brandId:'altaria-cards',q:'TEST P73A'},
          content_list_tasks:{brandId:'altaria-cards'},content_list_approvals:{},
          content_get_approved_guide:{brandId:'altaria-cards'},
        };
        const data:Record<string,any>={};
        const baseStats=await runReadTool('cards_aggregate_stats',owner,{},wrapped) as {qrNfcOpenings:number};
        expect(baseStats.qrNfcOpenings).toBeGreaterThanOrEqual(7);
        for(const [name,args] of Object.entries(reads)){
          data[name]=await success(name,args);passed.push(name);
          if(data[name].items)expect(data[name].items.length,name).toBeGreaterThan(0);
        }
        expect(data.crm_get_company.id).toBe(f.company);
        expect(Object.keys(data.crm_get_company).sort()).toEqual(['id','name','sector','city','region','website','responsibleUserId'].sort());
        expect(data.crm_list_contacts.items).toHaveLength(20);
        expect(data.crm_list_contacts.nextOffset).toBe(20);
        const second=await success('crm_list_contacts',{organizationId:f.company,offset:20,limit:20});
        expect(second.items).toHaveLength(3);expect(second.nextOffset).toBeNull();
        expect(second.items.some((x:{id:string})=>data.crm_list_contacts.items.some((y:{id:string})=>x.id===y.id))).toBe(false);
        expect(data.crm_list_opportunities.items.some((x:{id:string})=>x.id===f.opportunity)).toBe(true);
        expect(data.crm_followups_needed.items).toEqual(expect.arrayContaining([expect.objectContaining({id:f.opportunity,reason:'due_task'})]));
        expect(data.crm_list_pending_proposals.items).toEqual(expect.arrayContaining([expect.objectContaining({id:f.proposal,pendingKind:'draft_for_review'})]));
        expect(data.crm_list_tasks.items.some((x:{title:string})=>x.title===injection)).toBe(true);
        expect(data.sales_get_template.body).toBe(salesInput.body);
        for(const name of ['sales_find_approved','sales_find_objections']){
          expect(data[name].items.some((x:{id:string})=>x.id===f.pendingSales)).toBe(false);
          expect(data[name].items.some((x:{id:string})=>x.id===(name==='sales_find_objections'?f.objection:f.approved))).toBe(true);
        }
        expect(data.sales_suggest_materials.suggestions.some((x:{id:string})=>x.id===f.approved)).toBe(true);
        expect(data.cards_list_orders.items).toHaveLength(1);
        expect(data.cards_list_orders.items[0]).toMatchObject({id:f.order,paidConfirmed:true});
        expect(data.cards_needing_production.items.some((x:{id:string})=>x.id===f.order)).toBe(true);
        expect(data.cards_get_production.production.stage).toBe('preparation');
        expect(data.cards_get_production.paidConfirmed).toBe(true);
        // A timestamp alone must never be described as a confirmed payment.
        const noPaymentEvent=randomUUID();
        await tx.run(`INSERT INTO pedidos_tarjetas
          (id,numero_pedido,clave_idempotencia,huella_solicitud,estado,google_place_id,
          negocio_nombre,negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,
          envio_centimos,total_centimos,cliente_nombre,cliente_email,cliente_telefono,
          envio_direccion,envio_codigo_postal,envio_ciudad,envio_provincia,stripe_entorno,
          creado_en,pagado_en,producto_id,producto_nombre)
          SELECT ?,?,?,huella_solicitud,estado,google_place_id,negocio_nombre,negocio_direccion,
          cantidad,precio_unitario_centimos,subtotal_centimos,envio_centimos,total_centimos,
          cliente_nombre,cliente_email,cliente_telefono,envio_direccion,envio_codigo_postal,
          envio_ciudad,envio_provincia,stripe_entorno,creado_en,pagado_en,producto_id,producto_nombre
          FROM pedidos_tarjetas WHERE id=?`,[noPaymentEvent,`TEST-NO-PAYMENT-${f.run}`,noPaymentEvent,f.order]);
        expect((await success('cards_get_production',{orderId:noPaymentEvent})).paidConfirmed).toBe(false);
        expect((await success('cards_needing_production',{})).items.some((x:{id:string})=>x.id===noPaymentEvent)).toBe(false);
        expect(data.cards_list_batches.items[0]).toMatchObject({id:f.batch,quantity:1});
        expect(data.cards_list_incidents.items[0].severity).toBe('minor');
        expect(data.cards_aggregate_stats.qrNfcOpenings).toBe(baseStats.qrNfcOpenings);
        expect(data.content_calendar.items.some((x:{id:string})=>x.id===f.piece)).toBe(true);
        expect(data.content_calendar.items.some((x:{id:string})=>x.id===f.scheduled)).toBe(false);
        const scheduled=await success('content_calendar',{...reads.content_calendar,dateKind:'publication_scheduled'});
        expect(scheduled.items).toEqual(expect.arrayContaining([expect.objectContaining({id:f.scheduled,
          dueAt:'2026-10-22T10:00:00.000Z',scheduledAt:'2026-10-16T16:00:00.000Z'})]));
        expect(scheduled.items.some((x:{id:string})=>x.id===f.piece)).toBe(false);
        expect(data.content_get_piece.script).toBe(injection);
        expect(data.content_get_piece.resources[0]).toEqual({id:f.asset,mime:'image/png',class:'original'});
        expect(data.content_list_approvals.items.some((x:{id:string})=>x.id===f.review)).toBe(true);
        expect(data.content_get_approved_guide.identity).toBe('TEST P73A guía sintética');
        const exactPage=await success('crm_search_companies',{q:'TEST P73A',limit:2});
        expect(exactPage.items).toHaveLength(2);expect(exactPage.nextOffset).toBeNull();
        const firstSuggestion=await success('sales_suggest_materials',{organizationId:f.company,limit:1});
        const nextSuggestion=await success('sales_suggest_materials',{organizationId:f.company,limit:1,offset:1});
        expect(nextSuggestion.suggestions[0].id).not.toBe(firstSuggestion.suggestions[0].id);
        expect(firstSuggestion.nextOffset).toBe(1);expect(nextSuggestion.nextOffset).toBeNull();
        // Pending edits must not influence approved search, category or sector filtering.
        await reviseSalesEntry(owner,f.approved,{...salesInput,title:'TEST P73A PENDING_UNAPPROVED',
          category:'objection',sector:'TEST another sector',body:'TEST PENDING_UNAPPROVED content'},1,wrapped);
        const approvedSearch=await success('sales_find_approved',{q:'guion sintético aprobado'});
        expect(approvedSearch.items.some((x:{id:string})=>x.id===f.approved)).toBe(true);
        expect((await success('sales_find_approved',{q:'PENDING_UNAPPROVED'})).items).toEqual([]);
        expect((await success('sales_find_objections',{q:'TEST P73A'})).items.some((x:{id:string})=>x.id===f.approved)).toBe(false);

        // Every read tool rejects strict-schema extra fields and unauthorised module access.
        for(const [name,args] of Object.entries(reads)){
          const invalid=await rpc(owner,false,name,{...args,includePrivate:true});
          expect(Boolean(invalid.message.error||invalid.message.result?.isError),name).toBe(true);
          const denied=await rpc(outsider,false,name,args);
          expect(Boolean(denied.message.error||denied.message.result?.isError),name).toBe(true);
        }
        for(const limit of [0,21,-1,1.5]){
          const r=await rpc(owner,false,'crm_list_contacts',{organizationId:f.company,limit});
          expect(Boolean(r.message.error||r.message.result?.isError)).toBe(true);
        }
        const badStatus=await rpc(owner,false,'cards_list_orders',{status:'invented-status'});
        expect(Boolean(badStatus.message.error||badStatus.message.result?.isError)).toBe(true);
        await expect(runReadTool('crm_get_company',sales,{id:f.foreignCompany},wrapped)).rejects.toThrow();
        await expect(runReadTool('content_get_approved_guide',editor,{brandId:'martin-altaria'},wrapped)).rejects.toThrow();
        await expect(runReadTool('content_calendar',editor,{...reads.content_calendar,brandId:'martin-altaria'} as never,wrapped)).rejects.toThrow();
        const visible=await runReadTool('crm_search_companies',sales,{q:'TEST P73A'},wrapped) as {items:{id:string}[]};
        expect(visible.items.map(x=>x.id)).toEqual([f.company]);
        for(const [name,args] of [['crm_get_company',{id:randomUUID()}],['cards_get_production',{orderId:randomUUID()}],
          ['content_get_piece',{id:randomUUID()}],['sales_get_template',{id:f.pendingSales}]] as const)
          await expect(runReadTool(name,owner,args,wrapped)).rejects.toThrow();
        expect(await runReadTool('crm_search_companies',owner,{q:`ABSENT-${f.run}`},wrapped)).toMatchObject({items:[]});
        expect(availableToolNames(owner,false)).toHaveLength(25);
        expect(availableToolNames(production,true).every(n=>n.startsWith('cards_'))).toBe(true);
        expect(availableToolNames(viewer,true).some(n=>n.includes('prepare'))).toBe(false);
        expect(availableToolNames(editor,true).every(n=>n.startsWith('content_'))).toBe(true);
        expect(availableToolNames(outsider,true)).toEqual([]);

        const inputs={
          sales_prepare_candidate:{...salesInput,title:'TEST P73A candidato preparado'},
          crm_prepare_activity:{organizationId:f.company,kind:'note',summary:injection},
          crm_prepare_task:{organizationId:f.company,title:'TEST P73A tarea preparada'},
          proposal_prepare_draft:{opportunityId:f.opportunity,title:'TEST P73A borrador preparado'},
          gmail_prepare_draft:{organizationId:f.company,contactId:f.contact,subject:'TEST P73A correo local',body:injection},
          content_prepare_idea:{brandId:'altaria-cards',channel:'instagram',title:'TEST P73A idea preparada',format:'Post'},
          content_prepare_script:{pieceId:f.piece,script:'TEST P73A guion nuevo exclusivamente sintético'},
          content_prepare_review:{pieceId:f.toReview,stage:'final'},
        };
        const snapshot=async()=>({
          payment:await tx.get('SELECT estado,pagado_en,stripe_payment_intent_id FROM pedidos_tarjetas WHERE id=?',[f.order]),
          target:await tx.get('SELECT * FROM cards_destination_targets WHERE destination_ref_id=?',[f.destination]),
          published:await tx.get("SELECT count(*) AS n FROM content_publication_records WHERE status='confirmed'"),
          gmail:await tx.get('SELECT count(*) AS n FROM crm_gmail_messages'),
          stripe:await tx.get('SELECT count(*) AS n FROM eventos_stripe'),
        });
        const unchanged=await snapshot();
        const requests:Record<string,string>={};
        const preparedCounts=await tx.get(`SELECT
          (SELECT count(*) FROM crm_tasks) AS tasks,(SELECT count(*) FROM crm_activities) AS activities,
          (SELECT count(*) FROM crm_proposals) AS proposals,(SELECT count(*) FROM crm_gmail_drafts) AS drafts,
          (SELECT count(*) FROM content_pieces) AS pieces,(SELECT count(*) FROM crm_sales_entries) AS sales`);
        for(const name of actionToolNames){
          const input={...inputs[name],idempotencyKey:`p73a_${name}`};
          const readonly=await rpc(owner,false,name,input);
          expect(Boolean(readonly.message.error||readonly.message.result?.isError),name).toBe(true);
          const invalid=await rpc(owner,true,name,{...input,approve:true});
          expect(Boolean(invalid.message.error||invalid.message.result?.isError),name).toBe(true);
          await expect(prepareMcpAction(name,outsider,input,wrapped)).rejects.toThrow();
          const result=await success(name,input,true);requests[name]=result.id;
          expect(result.status).toBe('pending');passed.push(name);
          expect((await prepareMcpAction(name,owner,input,wrapped)).id).toBe(result.id);
          await expect(executeMcpAction(owner,result.id,wrapped)).rejects.toMatchObject({code:'approval_not_approved'});
          await expect(reviewMcpAction(sales,result.id,'approved',wrapped)).rejects.toMatchObject({code:'forbidden'});
        }
        expect(await tx.get(`SELECT
          (SELECT count(*) FROM crm_tasks) AS tasks,(SELECT count(*) FROM crm_activities) AS activities,
          (SELECT count(*) FROM crm_proposals) AS proposals,(SELECT count(*) FROM crm_gmail_drafts) AS drafts,
          (SELECT count(*) FROM content_pieces) AS pieces,(SELECT count(*) FROM crm_sales_entries) AS sales`)).toEqual(preparedCounts);
        await expect(prepareMcpAction('crm_prepare_task',sales,{organizationId:f.foreignCompany,
          title:'TEST denegado',idempotencyKey:'p73a_foreign_company'},wrapped)).rejects.toThrow();
        await expect(prepareMcpAction('content_prepare_idea',editor,{...inputs.content_prepare_idea,
          brandId:'martin-altaria',idempotencyKey:'p73a_foreign_brand'},wrapped)).rejects.toThrow();
        await expect(prepareMcpAction('crm_prepare_task',owner,{...inputs.crm_prepare_task,
          title:'TEST cambiado',idempotencyKey:'p73a_crm_prepare_task'},wrapped)).rejects.toMatchObject({code:'idempotency_conflict'});
        // Separate synthetic owner approval and execution; no approval tool is exposed by MCP.
        for(const name of actionToolNames){
          expect(await reviewMcpAction(owner,requests[name],'approved',wrapped)).toBe('approved');
          expect(await executeMcpAction(owner,requests[name],wrapped),name).toBe('executed');
          await expect(executeMcpAction(owner,requests[name],wrapped)).rejects.toMatchObject({code:'approval_not_approved'});
          executed.push(name);
          const events=await tx.all('SELECT action FROM os_mcp_action_events WHERE request_id=?',[requests[name]]);
          expect(events.map(e=>e.action)).toEqual(expect.arrayContaining(['requested','approved','executed']));
        }
        const resultId=async(name:string)=>JSON.parse(String((await tx.get(
          'SELECT result_json FROM os_mcp_action_requests WHERE id=?',[requests[name]]))!.result_json)).resourceId;
        expect((await tx.get('SELECT status,approved_version FROM crm_sales_entries WHERE id=?',
          [await resultId('sales_prepare_candidate')]))).toMatchObject({status:'review',approved_version:null});
        expect((await tx.get('SELECT status FROM crm_gmail_drafts WHERE id=?',
          [await resultId('gmail_prepare_draft')]))?.status).toBe('review');
        expect((await tx.get('SELECT status FROM crm_proposals WHERE id=?',
          [await resultId('proposal_prepare_draft')]))?.status).toBe('draft');
        expect((await tx.get('SELECT status FROM content_review_requests WHERE id=?',
          [await resultId('content_prepare_review')]))?.status).toBe('pending');
        expect((await tx.get('SELECT current_version FROM content_pieces WHERE id=?',[f.piece]))?.current_version).toBe(2);
        expect(await snapshot()).toEqual(unchanged);

        const make=async(key:string)=>prepareMcpAction('crm_prepare_task',owner,
          {...inputs.crm_prepare_task,idempotencyKey:`p73a_${key}`},wrapped);
        const stale=await make('stale');
        await reviewMcpAction(owner,stale.id,'approved',wrapped);
        await tx.run('UPDATE crm_organizations SET updated_at=? WHERE id=?',['2099-01-01T00:00:00.000Z',f.company]);
        expect(await executeMcpAction(owner,stale.id,wrapped)).toBe('resource_changed');
        const tampered=await make('tampered');await reviewMcpAction(owner,tampered.id,'approved',wrapped);
        await tx.run('UPDATE os_mcp_action_requests SET request_json=? WHERE id=?',['{}',tampered.id]);
        await expect(executeMcpAction(owner,tampered.id,wrapped)).rejects.toMatchObject({code:'request_changed'});
        for(const alreadyApproved of [false,true]){
          const expired=await make(`expired_${alreadyApproved}`);
          if(alreadyApproved)await reviewMcpAction(owner,expired.id,'approved',wrapped);
          await tx.run('UPDATE os_mcp_action_requests SET requested_at=?,expires_at=? WHERE id=?',
            ['2000-01-01T00:00:00.000Z','2000-01-02T00:00:00.000Z',expired.id]);
          expect(await (alreadyApproved?executeMcpAction(owner,expired.id,wrapped):
            reviewMcpAction(owner,expired.id,'approved',wrapped))).toBe('expired');
        }
        const revoked=await make('revoked');await reviewMcpAction(owner,revoked.id,'approved',wrapped);
        expect((await principalForSubject(syntheticSubject(owner.id),'test',wrapped)).canPrepare).toBe(true);
        await setMcpGrant(owner,owner.id,false,false,wrapped);
        await expect(principalForSubject(syntheticSubject(owner.id),'test',wrapped)).rejects.toMatchObject({code:'mcp_access_denied'});
        await expect(executeMcpAction(owner,revoked.id,wrapped)).rejects.toThrow();
        await expect(principalForSubject(syntheticSubject(outsider.id),'test',wrapped)).rejects.toMatchObject({code:'mcp_access_denied'});
        await expect(principalForSubject('user_DOES_NOT_EXIST','test',wrapped)).rejects.toThrow();
        const audit=await tx.all('SELECT action,details_json FROM altaria_admin_audit_events WHERE actor_user_id=?',[owner.id]);
        auditCount=audit.length;
        for(const name of passed)expect(audit.some(x=>x.action===`mcp.tool.${name}`),name).toBe(true);
        expect(JSON.stringify(audit)).not.toContain(injection);
        await expect(tx.run('DELETE FROM os_mcp_action_events WHERE request_id=?',[requests.crm_prepare_task])).rejects.toThrow();
        expect(blockedNetwork).toBe(0);
        expect(await tx.all('PRAGMA foreign_key_check')).toEqual([]);
        expect(passed).toHaveLength(33);expect(executed).toHaveLength(8);
        throw rollback;
      }).immediate();}catch(error){if(error!==rollback)throw error;}
    }finally{
      // Verified after success AND failure: no DELETE cleanup, no immutable trigger bypass.
      try{expect(await counts()).toEqual(before);}
      finally{vi.unstubAllGlobals();process.env={...old};}
    }
    mkdirSync('review/altaria-os',{recursive:true});
    writeFileSync('review/altaria-os/phase73a-mcp-results.json',JSON.stringify({
      ...report,at:new Date().toISOString(),fixtureRun,tools:passed,syntheticExecutions:executed,
      auditCount,rollbackVerified:true,externalServiceCalls:blockedNetwork,
      transport:'local handler JSON-RPC; no ChatGPT or OAuth Connect',
      fixtureHash:createHash('sha256').update(JSON.stringify(salesInput)).digest('hex'),
    },null,2)+'\n');
  });
});
