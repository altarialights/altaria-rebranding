import type {APIRoute} from 'astro';
import {verifyAdminCsrfToken} from '../../../../lib/admin/access';
import {ContentError} from '../../../../lib/admin/content/model';
import {contentFormError} from '../../../../lib/admin/content/http';
import {createAsset} from '../../../../lib/admin/content/storage';
export const prerender=false;
export const POST:APIRoute=async({request,locals,redirect})=>{
  const p=locals.admin;
  if(!p)return Response.json({error:'Acceso denegado.'},{status:403});
  const length=Number(request.headers.get('content-length')??'0');
  const limit=21*1024*1024;
  if(!Number.isFinite(length)||length>limit||!request.body)
    return contentFormError(request,'media_too_large',413,'Archivo demasiado grande o vacío para TEST.');
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();return contentFormError(request,'media_too_large',413,
        'Archivo demasiado grande para TEST.');}
      chunks.push(value);
    }
  }catch{return contentFormError(request,'storage_error',400,'No se pudo leer el archivo.');}
  let form:FormData;
  try{
    const headers=new Headers();
    headers.set('content-type',request.headers.get('content-type')??'');
    form=await new Request(request.url,{method:'POST',headers,body:Buffer.concat(chunks)}).formData();
  }catch{return contentFormError(request,'invalid_input',400,'Formulario inválido.');}
  if(!verifyAdminCsrfToken(p.sessionHash,process.env.WORKOS_COOKIE_PASSWORD||'',
    String(form.get('csrf')??''),'content'))return contentFormError(request,'forbidden',403,
      'Solicitud no válida.');
  const file=form.get('file');
  if(!(file instanceof File))return contentFormError(request,'invalid_input',400,
    'Selecciona un archivo.');
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const brandId=String(form.get('brandId')??'');
    const pieceId=String(form.get('pieceId')??'');
    await createAsset(p,brandId,file.name,file.type,bytes,
      String(form.get('assetClass')??'') as never,String(form.get('sourceRef')??''),
      String(form.get('rightsNote')??''),undefined,undefined,
      String(form.get('requestKey')??''),pieceId||undefined);
    return redirect(pieceId
      ?`/admin/contenido/piezas/${encodeURIComponent(pieceId)}?guardado=1`
      :`/admin/contenido/biblioteca?marca=${encodeURIComponent(brandId)}&guardado=1`,303);
  }catch(error){
    const code=error instanceof ContentError?error.code:'storage_error';
    return contentFormError(request,code,error instanceof ContentError?error.status:503,
      'No se pudo guardar el archivo en TEST. Puedes reintentar.');
  }
};
