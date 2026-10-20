import type {APIRoute} from 'astro';
import {ContentError} from '../../../../../lib/admin/content/model';
import {readPrivateAsset} from '../../../../../lib/admin/content/storage';
export const prerender=false;
export const GET:APIRoute=async({locals,params,request})=>{
  if(!locals.admin)return Response.json({error:'Acceso denegado.'},{status:403});
  try{
    const asset=await readPrivateAsset(locals.admin,String(params.id??''));
    const inline=new URL(request.url).searchParams.get('preview')==='1';
    const headers=new Headers({
      'Content-Type':asset.mime,
      'Content-Disposition':inline?'inline':'attachment; filename="content-asset"',
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Accept-Ranges':'bytes',
    });
    const range=request.headers.get('range');
    if(range&&asset.mime==='video/mp4'){
      const match=/^bytes=(\d+)-(\d*)$/.exec(range);
      if(!match)return new Response(null,{status:416,headers});
      const start=Number(match[1]),end=match[2]?Number(match[2]):asset.bytes.length-1;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=asset.bytes.length)
        return new Response(null,{status:416,headers});
      headers.set('Content-Range',`bytes ${start}-${end}/${asset.bytes.length}`);
      return new Response(Buffer.from(asset.bytes.subarray(start,end+1)),{status:206,headers});
    }
    return new Response(Buffer.from(asset.bytes),{headers});
  }catch(error){
    return Response.json({error:'Recurso no disponible.'},
      {status:error instanceof ContentError?error.status:503});
  }
};
