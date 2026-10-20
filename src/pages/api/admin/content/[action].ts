import type {APIRoute} from 'astro';
import {verifyAdminCsrfToken} from '../../../../lib/admin/access';
import {ContentError} from '../../../../lib/admin/content/model';
import {contentFormError} from '../../../../lib/admin/content/http';
import {createPiece,revisePiece,changeStage,setHold,addComment,reviewPolicy,
  createProject,setMembership,saveGuide,linkCrm,setFrequency,activateBrand} from '../../../../lib/admin/content/service';
import {requestReview,decideReview,schedulePiece,confirmSyntheticPublication,
  recordMetric,archivePiece} from '../../../../lib/admin/content/workflow';
import {linkAsset,deleteAsset} from '../../../../lib/admin/content/storage';
export const prerender=false;
const val=(f:FormData,k:string)=>String(f.get(k)??'');
const maybe=(f:FormData,k:string)=>val(f,k)||null;
const bool=(f:FormData,k:string)=>f.get(k)==='1';
const messages:Record<string,string>={
  forbidden:'No tienes permiso para esta marca o acción.',version_conflict:'La pieza cambió. Recarga la ficha.',
  review_required:'Falta una aprobación vigente para avanzar.',review_stale:'La revisión ya no corresponde a esta versión.',
  self_review_requires_owner_reason:'La autoaprobación exige propietario y motivo.',
  brand_unavailable:'La marca o el canal siguen pendientes de activación.',
  publication_locked:'Esta publicación ya se registró y no admite editar la versión.',
  synthetic_evidence_required:'En TEST solo se admite evidencia sintética marcada TEST.',
  invalid_transition:'Esa transición no está permitida.',invalid_input:'Revisa los campos enviados.',
};
export const POST:APIRoute=async({request,locals,params,redirect})=>{
  const p=locals.admin;
  if(!p)return Response.json({error:'Acceso denegado.'},{status:403});
  const form=await request.formData();
  if(!verifyAdminCsrfToken(p.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',
    val(form,'csrf'),'content'))return Response.json({error:'Solicitud no válida.'},{status:403});
  const action=params.action,id=val(form,'id'),brandId=val(form,'brandId');
  const input=()=>({brandId,channel:val(form,'channel'),projectId:maybe(form,'projectId'),
    title:val(form,'title'),format:val(form,'format'),objective:val(form,'objective'),
    brief:val(form,'brief'),hook:val(form,'hook'),script:val(form,'script'),
    copy:val(form,'copy'),cta:val(form,'cta'),referencesText:val(form,'referencesText'),
    dueAt:maybe(form,'dueAt'),assignedUserId:maybe(form,'assignedUserId')});
  try{
    let destination=id?`/admin/contenido/piezas/${encodeURIComponent(id)}`
      :'/admin/contenido/produccion';
    if(action==='create'){
      const created=await createPiece(p,input());
      destination=`/admin/contenido/piezas/${created}`;
    }else if(action==='revise')await revisePiece(p,id,input(),Number(val(form,'expectedVersion')));
    else if(action==='stage')await changeStage(p,id,val(form,'to') as never,
      Number(val(form,'expectedRevision')));
    else if(action==='hold')await setHold(p,id,val(form,'reason'));
    else if(action==='resume')await setHold(p,id,null);
    else if(action==='comment')await addComment(p,id,val(form,'body'));
    else if(action==='request-review')await requestReview(p,id,val(form,'stage') as never,
      maybe(form,'reviewerUserId'));
    else if(action==='decide-review')await decideReview(p,val(form,'requestId'),
      val(form,'decision') as never,val(form,'reason'));
    else if(action==='schedule')await schedulePiece(p,id,val(form,'scheduledAt'));
    else if(action==='publish-test')await confirmSyntheticPublication(p,id,val(form,'evidence'));
    else if(action==='metric')await recordMetric(p,id,val(form,'metricKey'),val(form,'value'),
      val(form,'unit'),val(form,'sourceNote'));
    else if(action==='archive')await archivePiece(p,id);
    else if(action==='project'){await createProject(p,brandId,val(form,'name'),
      (maybe(form,'reviewMode') as 'simple'|'staged'|null));destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='policy'){await reviewPolicy(p,brandId,maybe(form,'projectId'),
      val(form,'mode') as never);destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='member'){await setMembership(p,brandId,val(form,'userId'),{
      read:bool(form,'read'),edit:bool(form,'edit'),review:bool(form,'review'),
      recordPublication:bool(form,'recordPublication'),manageBrand:bool(form,'manageBrand'),
    },bool(form,'revoke'));destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='guide'){await saveGuide(p,brandId,Object.fromEntries(
      ['identity','objectives','audience','tone','colors','typography','visualRules',
        'formats','approvedExamples','restrictions'].map(k=>[k,val(form,k)])),
      bool(form,'approve'));destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='frequency'){await setFrequency(p,brandId,val(form,'channel'),
      val(form,'period') as never,Number(val(form,'targetCount')));
      destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='activate-brand'){await activateBrand(p,brandId,val(form,'evidence'));
      destination=`/admin/contenido/marcas?marca=${encodeURIComponent(brandId)}`;}
    else if(action==='link-crm')await linkCrm(p,id,val(form,'organizationId'),maybe(form,'opportunityId'));
    else if(action==='link-asset')await linkAsset(p,id,val(form,'assetId'),val(form,'purpose') as never);
    else if(action==='delete-asset'){await deleteAsset(p,id);destination='/admin/contenido/biblioteca';}
    else return Response.json({error:'Acción no encontrada.'},{status:404});
    return redirect(`${destination}${destination.includes('?')?'&':'?'}guardado=1`,303);
  }catch(error){
    const code=error instanceof ContentError?error.code:'content_error';
    const status=error instanceof ContentError?error.status:503;
    return contentFormError(request,code,status,messages[code]??'No se pudo completar la acción.');
  }
};
