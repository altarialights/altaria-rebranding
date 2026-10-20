import type {APIRoute} from 'astro';
import {getDatabase} from '../lib/db/client';
import {authenticateMcp,mcpAuthenticationResponse,mcpConfig,McpError} from '../lib/admin/mcp/auth';
import {handlePrivateMcp} from '../lib/admin/mcp/server';
export const prerender=false;

const respond:APIRoute=async({request})=>{
  let config;
  try{config=mcpConfig();}
  catch{return Response.json({error:'MCP no disponible en TEST.'},{status:503});}
  if(new URL(request.url).href!==`${config.astroOrigin}/mcp`
    ||request.headers.get('origin')
      &&request.headers.get('origin')!==new URL(config.resource).origin)
    return Response.json({error:'Origen no autorizado.'},{status:403});
  if(Number(request.headers.get('content-length')??0)>128_000)
    return Response.json({error:'Solicitud demasiado grande.'},{status:413});
  if(request.method==='POST'){
    if(!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({error:'Se requiere JSON.'},{status:415});
    try{if((await request.clone().arrayBuffer()).byteLength>128_000)
      return Response.json({error:'Solicitud demasiado grande.'},{status:413});}
    catch{return Response.json({error:'Solicitud inválida.'},{status:400});}
  }
  try{
    const db=getDatabase();
    const actor=await authenticateMcp(request,db);
    const response=await handlePrivateMcp(request,actor.principal,actor.canPrepare,db);
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('X-Content-Type-Options','nosniff');
    return response;
  }catch(error){
    const status=error instanceof McpError?error.status:503;
    if(status===401)return mcpAuthenticationResponse(request,config);
    return Response.json({error:status===403
      ?'Acceso denegado.':'MCP no disponible en TEST.'},{status,
      headers:{'Cache-Control':'private, no-store'}});
  }
};
export const GET=respond;
export const POST=respond;
export const DELETE=respond;
