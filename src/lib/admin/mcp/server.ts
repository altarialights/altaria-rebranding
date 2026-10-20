import {randomUUID} from 'node:crypto';
import {createMcpHandler,McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type {Connection} from '@tursodatabase/serverless';
import type {AdminPrincipal} from '../access';
import {assertCardsTest} from '../cards/service';
import {actionSchemas,actionToolNames,canPrepareTool,prepareMcpAction} from './actions';
import {McpError} from './auth';
import {canListReadTool,readToolNames,runReadTool} from './reads';

const pagination={limit:z.number().int().min(1).max(20).optional(),
  offset:z.number().int().min(0).max(200).optional()};
const search={q:z.string().trim().max(100).optional(),...pagination};
const uuid=z.string().uuid();
const readSchemas={
  crm_search_companies:z.object(search).strict(),
  crm_get_company:z.object({id:uuid}).strict(),
  crm_list_contacts:z.object({organizationId:uuid,...pagination}).strict(),
  crm_list_opportunities:z.object({organizationId:uuid.optional(),...pagination}).strict(),
  crm_followups_needed:z.object({organizationId:uuid.optional(),...pagination}).strict(),
  crm_list_pending_proposals:z.object({organizationId:uuid.optional(),...pagination}).strict(),
  crm_list_tasks:z.object({organizationId:uuid.optional(),...pagination}).strict(),
  crm_list_timeline:z.object({organizationId:uuid,...pagination}).strict(),
  sales_find_approved:z.object(search).strict(),
  sales_find_objections:z.object(search).strict(),
  sales_get_template:z.object({id:uuid}).strict(),
  sales_suggest_materials:z.object({organizationId:uuid,...pagination}).strict(),
  cards_list_orders:z.object({...search,status:z.enum(['pending','preparation','production',
    'verification','ready_to_ship','shipped','delivered']).optional()}).strict(),
  cards_needing_production:z.object(pagination).strict(),
  cards_get_production:z.object({orderId:uuid}).strict(),
  cards_list_batches:z.object({orderId:uuid,...pagination}).strict(),
  cards_list_incidents:z.object({orderId:uuid,...pagination}).strict(),
  cards_aggregate_stats:z.object({}).strict(),
  content_list_brands:z.object({}).strict(),
  content_calendar:z.object({brandId:z.string().max(80).optional(),
    from:z.iso.date(),to:z.iso.date(),
    dateKind:z.enum(['editorial_due','publication_scheduled']),...pagination}).strict(),
  content_get_piece:z.object({id:uuid}).strict(),
  content_list_states:z.object({brandId:z.string().max(80).optional(),
    status:z.enum(['idea','script','visuals','editing','review','ready']).optional(),
    q:z.string().max(80).optional(),...pagination}).strict(),
  content_list_tasks:z.object({brandId:z.string().max(80).optional(),...pagination}).strict(),
  content_list_approvals:z.object(pagination).strict(),
  content_get_approved_guide:z.object({brandId:z.string().max(80)}).strict(),
} as const;
const descriptions:Record<string,string>={
  crm_search_companies:'Busca empresas del CRM autorizadas para este usuario; devuelve campos mínimos y paginación.',
  crm_get_company:'Consulta una empresa CRM autorizada por identificador estable.',
  crm_list_contacts:'Consulta contactos de una empresa autorizada; nunca accede a otras empresas.',
  crm_list_opportunities:'Lista oportunidades comerciales autorizadas con límite y paginación.',
  crm_followups_needed:'Oportunidades abiertas con tarea vencida o sin seguimiento programado; distingue ambos motivos.',
  crm_list_pending_proposals:'Propuestas borrador o enviadas sin decisión; distingue caducidad pasada.',
  crm_list_tasks:'Lista tareas CRM autorizadas, sin tareas canceladas.',
  crm_list_timeline:'Consulta eventos de cronología de una empresa autorizada, sin detalles sensibles.',
  sales_find_approved:'Busca exclusivamente guiones y plantillas con versión aprobada y hash válido.',
  sales_find_objections:'Busca respuestas a objeciones aprobadas; los textos pendientes no aparecen.',
  sales_get_template:'Lee una versión aprobada concreta de la biblioteca comercial.',
  sales_suggest_materials:'Sugiere materiales aprobados por sector conocido; no inventa datos ni envía mensajes.',
  cards_list_orders:'Lista pedidos Stripe TEST y estado operativo sin diseños ni datos de pago privados.',
  cards_get_production:'Consulta estado de producción de un pedido TEST, sin diseños originales.',
  cards_list_batches:'Consulta lotes de un pedido TEST sin códigos de unidad ni destinos.',
  cards_list_incidents:'Consulta incidencias de producción de un pedido TEST.',
  cards_aggregate_stats:'Consulta estadísticas agregadas de Cards TEST; las aperturas no son personas.',
  content_list_brands:'Lista marcas y canales que este usuario editorial puede consultar.',
  content_calendar:'Consulta el calendario editorial autorizado, sin afirmar publicaciones no verificadas.',
  content_get_piece:'Consulta una pieza editorial y su versión íntegra, sin descargar originales.',
  content_list_states:'Lista estados editoriales de las marcas autorizadas.',
  content_list_tasks:'Lista tareas editoriales de marcas autorizadas en Mi trabajo.',
  content_list_approvals:'Lista revisiones editoriales pendientes que el usuario puede consultar.',
  content_get_approved_guide:'Consulta solo la última guía de marca aprobada e íntegra.',
  sales_prepare_candidate:'Prepara un candidato comercial en revisión; requiere aprobación humana en Altaria OS.',
  crm_prepare_activity:'Prepara una actividad comercial; requiere aprobación humana, no envía comunicaciones.',
  crm_prepare_task:'Prepara una tarea CRM; requiere aprobación humana y evita duplicados.',
  proposal_prepare_draft:'Prepara una propuesta vacía vinculada a oportunidad; revisión humana antes de crearla.',
  gmail_prepare_draft:'Prepara un borrador local revisable; nunca envía correo.',
  content_prepare_idea:'Prepara una idea editorial en una marca autorizada; no publica.',
  content_prepare_script:'Prepara una versión nueva de guion; no sobrescribe la versión anterior.',
  content_prepare_review:'Prepara solicitud de revisión editorial; nunca aprueba en nombre de nadie.',
};
descriptions.cards_needing_production='Pedidos TEST pagados que necesitan producción, sin datos personales.';
descriptions.content_calendar='Consulta fechas editoriales o publicaciones programadas, separadas en Europe/Madrid; no afirma publicación.';
const safeResult=(data:unknown)=>{
  const text=JSON.stringify({source:'altaria_os_test',untrustedBusinessData:true,data});
  if(text.length>36_000)throw new McpError('result_too_large',413);
  return {content:[{type:'text' as const,text}]};
};
async function rate(db:Connection,p:AdminPrincipal,kind:'read'|'prepare'){
  await assertCardsTest(db);
  const hour=new Date();hour.setUTCMinutes(0,0,0);
  const cap=kind==='read'?60:10;
  const result=await db.run(`INSERT INTO os_mcp_rate_windows(user_id,window_start,kind,call_count)
    VALUES(?,?,?,1) ON CONFLICT(user_id,window_start,kind)
    DO UPDATE SET call_count=call_count+1 WHERE call_count<?`,
    [p.id,hour.toISOString(),kind,cap]);
  if(Number(result.changes)!==1)throw new McpError('rate_limited',429);
}
async function audit(db:Connection,p:AdminPrincipal,name:string,outcome:'success'|'denied'|'failure'){
  await db.run(`INSERT INTO altaria_admin_audit_events
    (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
    VALUES(?,?,?,?,?,'mcp_tool',?,?,'{}')`,
    [randomUUID(),new Date().toISOString(),p.id,p.sessionHash,`mcp.tool.${name}`,name,outcome]);
}
const toolError=(error:unknown)=>({content:[{type:'text' as const,
  text:JSON.stringify({error:error instanceof McpError?error.code:'operation_failed'})}],isError:true});

export function buildMcpServer(p:AdminPrincipal,canPrepare:boolean,db:Connection){
  const server=new McpServer({name:'altaria-os-test',version:'0.1.0'},
    {capabilities:{tools:{listChanged:false}}});
  for(const name of readToolNames){
    if(!canListReadTool(name,p))continue;
    server.registerTool(name,{description:descriptions[name],inputSchema:readSchemas[name],
      annotations:{readOnlyHint:true,openWorldHint:false}},async (args:unknown)=>{
      try{
        await rate(db,p,'read');
        const result=await runReadTool(name,p,args as Parameters<typeof runReadTool>[2],db);
        await audit(db,p,name,'success');
        return safeResult(result);
      }catch(error){await audit(db,p,name,error instanceof McpError&&error.status===403?'denied':'failure');
        return toolError(error);}
    });
  }
  if(canPrepare)for(const name of actionToolNames){
    if(!canPrepareTool(name,p))continue;
    server.registerTool(name,{description:descriptions[name],inputSchema:actionSchemas[name],
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async (args:unknown)=>{
      try{
        await rate(db,p,'prepare');
        const result=await prepareMcpAction(name,p,args,db);
        await audit(db,p,name,'success');
        return safeResult(result);
      }catch(error){await audit(db,p,name,error instanceof McpError&&error.status===403?'denied':'failure');
        return toolError(error);}
    });
  }
  return server;
}

export async function handlePrivateMcp(request:Request,p:AdminPrincipal,
  canPrepare:boolean,db:Connection){
  const handler=createMcpHandler(()=>buildMcpServer(p,canPrepare,db),{responseMode:'json'});
  try{
    const inspection=request.method==='POST'?request.clone():null;
    const response=await handler.fetch(request);
    // SDK 2.3.1 accepts tool annotations but does not yet emit securitySchemes.
    // Add the MCP tool-level declaration to the JSON-RPC listing for ChatGPT.
    if(request.method!=='POST'||!response.ok)return response;
    let call:unknown;
    try{call=await inspection!.json();}catch{return response;}
    if(!call||typeof call!=='object'||(call as {method?:unknown}).method!=='tools/list')
      return response;
    const sse=response.headers.get('content-type')?.includes('text/event-stream')??false;
    if(!sse&&!response.headers.get('content-type')?.includes('application/json'))
      return response;
    const raw=await response.text();
    const line=sse?raw.split('\n').find(part=>part.startsWith('data: ')):null;
    if(sse&&!line)return response;
    const message=JSON.parse(sse?line!.slice(6):raw);
    if(!message?.result?.tools||!Array.isArray(message.result.tools))
      return new Response(raw,{status:response.status,headers:response.headers});
    message.result.tools=message.result.tools.map((tool:Record<string,unknown>)=>({
      ...tool,securitySchemes:[{type:'oauth2',scopes:['openid']}],
      _meta:{...(tool._meta as Record<string,unknown>|undefined),
        securitySchemes:[{type:'oauth2',scopes:['openid']}]},
    }));
    const changed=sse?raw.replace(line!,`data: ${JSON.stringify(message)}`)
      :JSON.stringify(message);
    const headers=new Headers(response.headers);headers.delete('content-length');
    return new Response(changed,{status:response.status,headers});
  }finally{await handler.close();}
}
export function availableToolNames(p:AdminPrincipal,canPrepare:boolean){
  return [...readToolNames.filter(name=>canListReadTool(name,p)),
    ...(canPrepare?actionToolNames.filter(name=>canPrepareTool(name,p)):[])];
}
