import type { APIRoute } from 'astro';
import { hasAdminPermission, verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { approveDestinationDomain, changeDestination, generateBatchLinks, pruneAnalytics,
  replaceRetiredLink, revertDestination, setLinkStatus, setRetention } from '../../../../lib/admin/cards/links';
import { CardsError } from '../../../../lib/admin/cards/service';
export const prerender=false;
const field=(data:FormData,key:string)=>String(data.get(key)??'').trim();
export const POST:APIRoute=async(context)=>{
  const principal=context.locals.admin;
  if (!principal || !hasAdminPermission(principal,'cards:write')) return Response.json({error:'Acceso denegado.'},{status:403});
  if (Number(context.request.headers.get('content-length')??0)>12000) return Response.json({error:'Solicitud demasiado grande.'},{status:413});
  const data=await context.request.formData().catch(()=>null);
  if (!data || !verifyAdminCsrfToken(principal.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',
    field(data,'csrf'),'cards')) return Response.json({error:'Solicitud no autorizada.'},{status:403});
  const orderId=field(data,'orderId'), action=field(data,'action');
  try {
    if (action==='domain') await approveDestinationDomain(principal,orderId,field(data,'hostname'));
    else if (action==='generate') await generateBatchLinks(principal,orderId,{batchId:field(data,'batchId'),
      destination:field(data,'destination'),idempotencyKey:field(data,'idempotencyKey'),campaign:field(data,'campaign')});
    else if (action==='destination') await changeDestination(principal,orderId,field(data,'refId'),
      field(data,'destination'),field(data,'reason'),Number(field(data,'revision')));
    else if (action==='revert') await revertDestination(principal,orderId,field(data,'refId'),
      Number(field(data,'historicalRevision')),field(data,'reason'),Number(field(data,'revision')));
    else if (action==='status') await setLinkStatus(principal,orderId,field(data,'linkId'),
      field(data,'status') as 'active'|'paused'|'retired',field(data,'reason'),Number(field(data,'revision')));
    else if (action==='replace') await replaceRetiredLink(principal,orderId,field(data,'linkId'),
      field(data,'reason'),field(data,'idempotencyKey'));
    else if (action==='retention') await setRetention(principal,Number(field(data,'rawDays')),
      Number(field(data,'aggregateDays')));
    else if (action==='prune') await pruneAnalytics(principal);
    else return Response.json({error:'Acción no encontrada.'},{status:404});
    return context.redirect(action==='retention'||action==='prune'?'/admin/cards/analitica?saved=1':
      `/admin/cards/${orderId}/enlaces?saved=1`,303);
  } catch(error) {
    const code=error instanceof CardsError?error.code:'save_failed';
    const status=error instanceof CardsError?error.status:500;
    return Response.json({error:code},{status});
  }
};
