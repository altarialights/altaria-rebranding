import type {APIRoute} from 'astro';
import {verifyAdminCsrfToken} from '../../../../lib/admin/access';
import {executeMcpAction,reviewMcpAction,setMcpGrant}
  from '../../../../lib/admin/mcp/actions';
import {McpError} from '../../../../lib/admin/mcp/auth';
export const prerender=false;
const value=(form:FormData,key:string)=>String(form.get(key)??'').trim();
export const POST:APIRoute=async({request,locals,params})=>{
  const owner=locals.admin;
  if(!owner?.roles.includes('owner'))return Response.json({error:'Acceso denegado.'},{status:403});
  if(Number(request.headers.get('content-length')??0)>16_000)
    return Response.json({error:'Solicitud demasiado grande.'},{status:413});
  const form=await request.formData().catch(()=>null);
  if(!form||!verifyAdminCsrfToken(owner.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',
    value(form,'csrf'),'automations'))
    return Response.json({error:'Solicitud no autorizada.'},{status:403});
  try{
    const action=params.action;
    if(action==='grant')await setMcpGrant(owner,value(form,'userId'),
      value(form,'read')==='1',value(form,'prepare')==='1');
    else if(action==='review')await reviewMcpAction(owner,value(form,'id'),
      value(form,'decision') as 'approved'|'rejected');
    else if(action==='execute'){
      const result=await executeMcpAction(owner,value(form,'id'));
      if(result!=='executed')throw new McpError('execution_not_completed',409);
    }
    else return Response.json({error:'Acción desconocida.'},{status:404});
    return new Response(null,{status:303,headers:{Location:'/admin/configuracion/mcp?saved=1'}});
  }catch(error){
    const status=error instanceof McpError?error.status:503;
    return Response.json({error:status===403?'Acceso denegado.':status===409
      ?'La solicitud cambió o ya se procesó. Recarga la página.'
      :'No se pudo completar la operación en TEST.'},{status});
  }
};
