import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {createRemoteJWKSet,jwtVerify,type JWTPayload} from 'jose';
import type {Connection} from '@tursodatabase/serverless';
import {getDatabase} from '../../db/client';
import {assertCardsTest} from '../cards/service';
import type {AdminPrincipal,AdminRole,ContentGrant} from '../access';

export class McpError extends Error {
  constructor(public code:string,public status=400){super(code);}
}
const roles:AdminRole[]=['owner','sales','production','viewer'];
const workosHost=(host:string)=>host==='authkit.app'||host.endsWith('.authkit.app')
  ||host==='workos.com'||host.endsWith('.workos.com');
export interface McpConfig {
  astroOrigin:string;transport:string;issuer:string;resource:string;
  audience:string;clientId:string;
}
const exactUrl=(value:string|undefined,originOnly=false)=>{
  if(!value||value.trim()!==value)throw new Error('missing_url');
  const url=new URL(value);
  if((originOnly?url.origin:url.href)!==value
    ||url.username||url.password||url.search||url.hash)
    throw new Error('ambiguous_url');
  return url;
};
export function mcpConfig(env:NodeJS.ProcessEnv=process.env):McpConfig {
  if(env.ALTARIA_MCP_ENABLED!=='1'||env.ALTARIA_TEST_ISOLATED!=='1'
    ||env.CI||env.VERCEL||env.VERCEL_ENV
    ||!env.WORKOS_API_KEY?.startsWith('sk_test_')
    ||!/^client_[A-Za-z0-9]+$/.test(env.WORKOS_CLIENT_ID??''))
    throw new McpError('mcp_not_configured',503);
  try {
    const astro=exactUrl(env.ALTARIA_MCP_ASTRO_ORIGIN,true);
    const transport=exactUrl(env.ALTARIA_MCP_TRANSPORT_URL);
    const issuer=exactUrl(env.ALTARIA_MCP_OAUTH_ISSUER,true);
    const resource=exactUrl(env.ALTARIA_MCP_RESOURCE);
    const clientId=exactUrl(env.ALTARIA_MCP_CLIENT_ID);
    if(astro.origin!=='http://127.0.0.1:4321'
      ||transport.href!=='http://127.0.0.1:4331/mcp'
      ||issuer.protocol!=='https:'||!workosHost(issuer.hostname)
      ||issuer.pathname!=='/'||issuer.port
      ||resource.protocol!=='https:'||resource.pathname!=='/mcp'||resource.port
      ||resource.hostname==='localhost'||resource.hostname.endsWith('.local')
      ||isIP(resource.hostname.replace(/^\[|\]$/g,''))!==0
      ||resource.hostname==='altarialights.com'
      ||resource.hostname.endsWith('.altarialights.com')
      ||resource.hostname.endsWith('.vercel.app')
      ||workosHost(resource.hostname)
      ||env.ALTARIA_MCP_OAUTH_AUDIENCE!==resource.href
      ||env.ALTARIA_MCP_RESOURCE_HOST!==resource.hostname
      ||clientId.protocol!=='https:'||clientId.hostname!=='chatgpt.com'||clientId.port
      ||!/^\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(clientId.pathname))
      throw new Error('invalid_mcp_config');
    return {astroOrigin:astro.origin,transport:transport.href,
      issuer:issuer.origin,resource:resource.href,audience:resource.href,clientId:clientId.href};
  } catch {throw new McpError('mcp_not_configured',503);}
}

export async function principalForSubject(subject:string,tokenId:string,
  db:Connection=getDatabase()):Promise<{principal:AdminPrincipal;canPrepare:boolean}> {
  await assertCardsTest(db);
  if(!/^user_[A-Za-z0-9]+$/.test(subject)||!tokenId||tokenId.length>200)
    throw new McpError('invalid_identity',401);
  const row=await db.get(`SELECT u.id,u.email,u.display_name,g.can_read,g.can_prepare,g.revoked_at
    FROM altaria_admin_users u JOIN os_mcp_access_grants g ON g.user_id=u.id
    WHERE u.workos_user_id=? AND u.status='active'`,[subject]);
  if(!row||Number(row.can_read)!==1||row.revoked_at)
    throw new McpError('mcp_access_denied',403);
  const id=String(row.id);
  const [roleRows,brandRows]=await Promise.all([
    db.all('SELECT role_key FROM altaria_admin_user_roles WHERE user_id=?',[id]),
    db.all(`SELECT m.brand_id,m.can_read,m.can_edit,m.can_review,
      m.can_record_publication,m.can_manage_brand FROM content_brand_memberships m
      JOIN content_brands b ON b.id=m.brand_id
      WHERE m.user_id=? AND m.revoked_at IS NULL AND b.status='active'`,[id]),
  ]);
  const assigned=roleRows.map(x=>String(x.role_key)).filter((x):x is AdminRole=>
    roles.includes(x as AdminRole));
  const contentGrants:ContentGrant[]=brandRows.map(x=>({brandId:String(x.brand_id),
    read:Number(x.can_read)===1,edit:Number(x.can_edit)===1,review:Number(x.can_review)===1,
    recordPublication:Number(x.can_record_publication)===1,
    manageBrand:Number(x.can_manage_brand)===1}));
  if(!assigned.length&&!contentGrants.some(x=>x.read))throw new McpError('mcp_access_denied',403);
  return {principal:{id,email:String(row.email),displayName:String(row.display_name??row.email),
    roles:assigned,contentGrants,
    sessionHash:createHash('sha256').update(`mcp:${tokenId}`).digest('hex')},
    canPrepare:Number(row.can_prepare)===1};
}

const jwks=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export function verifiedMcpIdentity(payload:JWTPayload,clientId:string){
  if(payload.client_id!==clientId||typeof payload.sub!=='string'
    ||!/^user_[A-Za-z0-9]+$/.test(payload.sub)
    ||typeof payload.jti!=='string'||!payload.jti.trim()||payload.jti.length>200
    ||typeof payload.sid!=='string'||!payload.sid.trim()||payload.sid.length>200
    ||typeof payload.scope!=='string'||!payload.scope.split(' ').includes('openid'))
    throw new McpError('invalid_token',401);
  return {subject:payload.sub,tokenId:payload.jti};
}
export async function verifyMcpToken(token:string,config:McpConfig,
  keys:ReturnType<typeof createRemoteJWKSet>){
  const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,
    audience:config.audience,algorithms:['RS256'],clockTolerance:5,
    requiredClaims:['exp','iat','sub','jti','sid','client_id','scope']});
  // Accept only the single configured resource, never a multi-resource token.
  if(payload.aud!==config.audience||!Number.isSafeInteger(payload.exp)
    ||!Number.isSafeInteger(payload.iat)||payload.iat!>Date.now()/1000+5
    ||payload.exp!<=payload.iat!)throw new McpError('invalid_token',401);
  return verifiedMcpIdentity(payload,config.clientId);
}
export async function authenticateMcp(request:Request,db:Connection=getDatabase()) {
  const config=mcpConfig();
  const auth=request.headers.get('authorization')??'';
  const token=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(auth)?.[1];
  if(!token||token.length>8192)throw new McpError('bearer_required',401);
  let keys=jwks.get(config.issuer);
  if(!keys){keys=createRemoteJWKSet(new URL(`${config.issuer}/oauth2/jwks`));jwks.set(config.issuer,keys);}
  try{
    const identity=await verifyMcpToken(token,config,keys);
    const actor=await principalForSubject(identity.subject,identity.tokenId,db);
    return {...actor,config};
  }catch(error){
    if(error instanceof McpError&&error.status===403)throw error;
    throw new McpError('invalid_token',401);
  }
}

export function mcpChallenge(config:McpConfig){
  return `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource',config.resource).href}", scope="openid", error="invalid_token", error_description="OAuth required"`;
}

export async function mcpAuthenticationResponse(request:Request,config:McpConfig){
  const challenge=mcpChallenge(config);
  let body:unknown={error:'OAuth requerido.'};
  if(request.method==='POST'){
    try{
      const call=await request.clone().json();
      if(call?.jsonrpc==='2.0'&&call.method==='tools/call'
        &&(typeof call.id==='string'||typeof call.id==='number')){
        body={jsonrpc:'2.0',id:call.id,result:{isError:true,
          content:[{type:'text',text:'OAuth requerido.'}],
          _meta:{'mcp/www_authenticate':[challenge]}}};
      }
    }catch{/* Keep the generic challenge for malformed JSON. */}
  }
  return Response.json(body,{status:401,headers:{
    'WWW-Authenticate':challenge,'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'}});
}
