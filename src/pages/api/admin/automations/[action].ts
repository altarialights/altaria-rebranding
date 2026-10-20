import type { APIRoute } from 'astro';
import { verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { completeTask,CrmError } from '../../../../lib/admin/crm/service';
import { requestWorkApproval,reviewApproval,executeApproval } from '../../../../lib/admin/automation/approvals';
import { prepareDailyBrief,runAutomationTick } from '../../../../lib/admin/automation/engine';
import { retryDeadJob,setRuleConfig } from '../../../../lib/admin/automation/settings';
import { completeWorkItem,WorkError } from '../../../../lib/admin/automation/work';
import { getDatabase } from '../../../../lib/db/client';
export const prerender=false;
const field=(data:FormData,key:string)=>String(data.get(key)??'').trim();
export const POST:APIRoute=async({locals,params,request})=>{
  const principal=locals.admin;
  if(!principal) return Response.json({error:'Acceso denegado.'},{status:403});
  if(Number(request.headers.get('content-length')??0)>16_000) return Response.json({error:'Solicitud demasiado grande.'},{status:413});
  const form=await request.formData().catch(()=>null);
  if(!form||!verifyAdminCsrfToken(principal.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',
    field(form,'csrf'),'automations')) return Response.json({error:'Solicitud no autorizada.'},{status:403});
  const action=params.action,db=getDatabase();
  try {
    let returnTo='/admin';
    if(action==='run') {
      if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
      await runAutomationTick(db);
      returnTo='/admin/configuracion';
    } else if(action==='complete-work') await completeWorkItem(principal,field(form,'id'),db);
    else if(action==='complete-crm') await completeTask(principal,field(form,'id'),db);
    else if(action==='rule') {
      await setRuleConfig(principal,field(form,'key'),field(form,'enabled')==='1',
        field(form,'localTime')||null,db);
      returnTo='/admin/configuracion';
    } else if(action==='retry-job') {
      await retryDeadJob(principal,field(form,'id'),db);
      returnTo='/admin/configuracion';
    } else if(action==='brief-now') {
      if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
      await prepareDailyBrief(db,new Date(),true);
    } else if(action==='approval-request') {
      await requestWorkApproval(principal,field(form,'id'),field(form,'expiresAt'),db);
    } else if(action==='approval-review') {
      await reviewApproval(principal,field(form,'id'),field(form,'decision') as 'approved'|'rejected',db);
    } else if(action==='approval-execute') await executeApproval(principal,field(form,'id'),db);
    else return Response.json({error:'Acción no encontrada.'},{status:404});
    return new Response(null,{status:303,headers:{Location:`${returnTo}?saved=1`}});
  } catch(error) {
    const status=error instanceof WorkError||error instanceof CrmError?error.status:503;
    return Response.json({error:status===403?'No tienes permiso para esta acción.':
      status===409?'La acción cambió o ya se completó. Recarga la página.':
      status===503?'La operación no está disponible en TEST.':'Revisa la acción y vuelve a intentarlo.'},
    {status});
  }
};
