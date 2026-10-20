import type { APIRoute } from 'astro';
import { recordAdminAudit, verifyAdminCsrfToken } from '../../../../../lib/admin/access';
import { createSalesEntry, createSalesFollowup, prepareSalesDraft, recordChannelReview,
  registerSalesActivity, reviewSalesEntry, reviseSalesEntry, SalesError,
  submitSalesEntry,
  type SalesCategory, type SalesInput } from '../../../../../lib/admin/sales/library';
export const prerender=false;
const field=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const optional=(form:FormData,key:string)=>field(form,key)||null;
const date=(form:FormData,key:string)=>{const value=optional(form,key);if(!value)return null;
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))throw new SalesError('invalid_input');
  return parsed.toISOString();};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages:Record<string,string>={forbidden:'Acceso denegado.',invalid_input:'Revisa los campos del formulario.',
  entry_missing:'No se encuentra el contenido.',version_conflict:'El contenido cambió. Recarga antes de guardar.',
  version_corrupt:'La versión no supera la comprobación de integridad.',entry_retired:'Este contenido está retirado.',
  resource_mismatch:'La oportunidad no pertenece a la empresa.',contact_email_missing:'El contacto necesita un email registrado.',
  channel_blocked:'Existe una oposición o bloqueo para este canal.',save_failed:'No se pudo guardar.'};
const input=(form:FormData):SalesInput=>({title:field(form,'title'),category:field(form,'category') as SalesCategory,
  product:field(form,'product'),sector:field(form,'sector')||'general',
  channel:field(form,'channel') as SalesInput['channel'],stage:field(form,'stage') as SalesInput['stage'],
  body:field(form,'body'),nextStep:field(form,'nextStep')});
export const POST:APIRoute=async context=>{
  const principal=context.locals.admin;
  if(!principal)return Response.json({error:'Acceso denegado.'},{status:403});
  if(Number(context.request.headers.get('content-length')??0)>32_000)return Response.json({error:'Formulario demasiado grande.'},{status:413});
  const form=await context.request.formData().catch(()=>null);
  if(!form)return Response.json({error:'Formulario inválido.'},{status:400});
  if(!verifyAdminCsrfToken(principal.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',field(form,'csrf'),'crm'))
    return Response.json({error:'Acceso denegado.'},{status:403});
  const action=context.params.action,entryId=field(form,'entryId'),orgId=field(form,'organizationId'),
    opportunityId=optional(form,'opportunityId');
  try{
    if(opportunityId&&!uuid.test(opportunityId))throw new SalesError('invalid_input');
    let redirect='/admin/crm/guia-comercial';
    if(action==='create'){
      const draft=field(form,'intent')==='draft';
      const id=await createSalesEntry(principal,input(form),undefined,null,draft?'draft':'review');
      redirect+=`?ficha=${id}&guardado=${draft?'borrador':'propuesto'}`;
    }else if(action==='revise'){
      await reviseSalesEntry(principal,entryId,input(form),Number(field(form,'expectedVersion')));
      redirect+=`?ficha=${entryId}&guardado=version`;
    }else if(action==='approve'||action==='retire'){
      await reviewSalesEntry(principal,entryId,action==='approve'?'approve':'retire',Number(field(form,'expectedVersion')));
      redirect+=`?ficha=${entryId}&guardado=${action}`;
    }else if(action==='submit'){
      await submitSalesEntry(principal,entryId,Number(field(form,'expectedVersion')));
      redirect+=`?ficha=${entryId}&guardado=propuesto`;
    }else if(action==='draft'){
      if(!uuid.test(orgId)||!uuid.test(field(form,'contactId')))throw new SalesError('invalid_input');
      const id=await prepareSalesDraft(principal,{entryId,organizationId:orgId,opportunityId,
        contactId:field(form,'contactId'),subject:field(form,'subject'),body:field(form,'body')});
      redirect=`/admin/crm/borradores/${id}`;
    }else if(action==='activity'){
      if(!uuid.test(orgId))throw new SalesError('invalid_input');
      if(field(form,'summary').length<2||field(form,'summary').length>240
        ||field(form,'detail').length>4000||field(form,'followupTitle').length>240)
        throw new SalesError('invalid_input');
      await registerSalesActivity(principal,{organizationId:orgId,opportunityId,
        summary:field(form,'summary'),detail:optional(form,'detail'),
        followupTitle:optional(form,'followupTitle'),followupDueAt:date(form,'followupDueAt')});
      redirect=`/admin/crm/empresas/${orgId}?saved=activity#activity`;
    }else if(action==='followup'){
      if(!uuid.test(orgId))throw new SalesError('invalid_input');
      if(field(form,'title').length<2||field(form,'title').length>240)throw new SalesError('invalid_input');
      await createSalesFollowup(principal,{organizationId:orgId,opportunityId,
        title:field(form,'title'),dueAt:date(form,'dueAt')});
      redirect=`/admin/crm/empresas/${orgId}?saved=task#tasks`;
    }else if(action==='channel-review'){
      if(!uuid.test(orgId))throw new SalesError('invalid_input');
      await recordChannelReview(principal,{organizationId:orgId,contactId:optional(form,'contactId'),
        channel:field(form,'channel') as 'email'|'phone'|'in_person',
        decision:field(form,'decision') as 'unknown'|'eligible'|'blocked'|'opposed',reason:field(form,'reason')});
      redirect+=`?empresa=${orgId}${opportunityId?`&oportunidad=${opportunityId}`:''}&guardado=canal`;
    }else return Response.json({error:'Acción desconocida.'},{status:404});
    return context.redirect(redirect,303);
  }catch(error){
    const code=error instanceof SalesError?error.code:'save_failed',status=error instanceof SalesError?error.status:503;
    if(status===403)await recordAdminAudit(principal,'sales.action.denied','denied','sales_action',action??null).catch(()=>{});
    return Response.json({error:messages[code]??messages.save_failed,code},{status});
  }
};
