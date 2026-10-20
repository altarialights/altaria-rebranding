import {createServer} from 'node:http';

export const MCP_GATEWAY_HOST='127.0.0.1';
export const MCP_GATEWAY_PORT=4331;
const requestHeaders=['authorization','content-type','accept','mcp-session-id',
  'mcp-protocol-version','last-event-id'];
const responseHeaders=['content-type','www-authenticate','mcp-session-id',
  'mcp-protocol-version'];

export function allowedMcpRoute(method,rawUrl,host,origin){
  if(host!==`${MCP_GATEWAY_HOST}:${MCP_GATEWAY_PORT}`||origin
    ||typeof rawUrl!=='string'||!rawUrl.startsWith('/')||rawUrl.includes('?')
    ||rawUrl.includes('#')||rawUrl.includes('%')||rawUrl.includes('\\'))return false;
  return rawUrl==='/mcp'&&['GET','POST','DELETE'].includes(method)
    ||rawUrl==='/.well-known/oauth-protected-resource'&&method==='GET';
}

async function boundedBody(request){
  const chunks=[];let size=0;
  for await(const chunk of request){
    size+=chunk.length;
    if(size>128_000)throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createMcpGateway(upstream='http://127.0.0.1:4321',fetcher=fetch){
  if(upstream!=='http://127.0.0.1:4321')throw new Error('upstream_not_test_loopback');
  return createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    if(!allowedMcpRoute(request.method,request.url,request.headers.host,
      request.headers.origin)){
      response.writeHead(404);response.end();return;
    }
    if(Number(request.headers['content-length']??0)>128_000){
      response.writeHead(413);response.end();return;
    }
    try{
      const headers=new Headers();
      for(const key of requestHeaders){
        const value=request.headers[key];
        if(typeof value==='string')headers.set(key,value);
      }
      const body=request.method==='POST'?await boundedBody(request):undefined;
      const upstreamResponse=await fetcher(`${upstream}${request.url}`,{
        method:request.method,headers,body,redirect:'manual',
        signal:AbortSignal.timeout(request.method==='GET'&&request.url==='/mcp'
          ?300_000:30_000),
      });
      if(upstreamResponse.status>=300&&upstreamResponse.status<400){
        response.writeHead(502);response.end();return;
      }
      for(const key of responseHeaders){
        const value=upstreamResponse.headers.get(key);
        if(value)response.setHeader(key,value);
      }
      if(upstreamResponse.headers.get('content-type')?.includes('text/event-stream')){
        response.writeHead(upstreamResponse.status);
        let size=0;
        for await(const chunk of upstreamResponse.body??[]){
          size+=chunk.byteLength;
          if(size>1_000_000){response.destroy();return;}
          response.write(chunk);
        }
        response.end();return;
      }
      // Enforce the cap while reading, before allocating an unbounded response.
      const chunks=[];let size=0;
      for await(const chunk of upstreamResponse.body??[]){
        size+=chunk.byteLength;
        if(size>128_000){response.writeHead(502);response.end();return;}
        chunks.push(Buffer.from(chunk));
      }
      response.writeHead(upstreamResponse.status);
      response.end(Buffer.concat(chunks));
    }catch{
      response.writeHead(502);response.end();
    }
  });
}
