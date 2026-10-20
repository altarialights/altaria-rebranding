import type {APIRoute} from 'astro';
import {mcpConfig} from '../../lib/admin/mcp/auth';
export const prerender=false;
export const GET:APIRoute=async()=>{
  try{
    const config=mcpConfig();
    return Response.json({resource:config.resource,authorization_servers:[config.issuer],
      bearer_methods_supported:['header'],scopes_supported:['openid']},{headers:{'Cache-Control':'no-store',
        'Access-Control-Allow-Origin':'*'}});
  }catch{return Response.json({error:'MCP no configurado.'},{status:503});}
};
