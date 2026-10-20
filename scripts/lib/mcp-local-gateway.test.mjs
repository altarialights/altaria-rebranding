import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {request as httpRequest} from 'node:http';
import {createMcpGateway,allowedMcpRoute} from './mcp-local-gateway.mjs';

const calls=[];
const upstream=vi.fn(async(url,options)=>{
  calls.push({url,method:options.method,authorization:options.headers.get('authorization'),
    cookie:options.headers.get('cookie')});
  if(url.endsWith('/mcp')&&options.headers.get('accept')==='text/event-stream')
    return new Response('event: message\ndata: {"synthetic":true}\n\n',{
      headers:{'content-type':'text/event-stream'}});
  return new Response(JSON.stringify({resource:'https://mcp-test.example.test/mcp'}),{
    status:url.endsWith('/mcp')?401:200,
    headers:{'content-type':'application/json',
      'www-authenticate':'Bearer resource_metadata="https://mcp-test.example.test/.well-known/oauth-protected-resource"'},
  });
});
const server=createMcpGateway('http://127.0.0.1:4321',upstream);
let port;
beforeAll(async()=>{
  const requestedPort=Number(process.env.ALTARIA_MCP_GATEWAY_TEST_PORT??0);
  if(![0,4331].includes(requestedPort))throw new Error('Only loopback test ports allowed');
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(requestedPort,'127.0.0.1',resolve);
  });
  port=server.address().port;
});
afterAll(async()=>new Promise(resolve=>server.close(resolve)));
function send(path,method='GET',headers={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,
      headers:{Host:'127.0.0.1:4331',...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
        body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end();
  });
}
describe('pasarela MCP local cerrada',()=>{
  it('comprueba por HTTP real la lista cerrada sin alcanzar upstream en rutas denegadas',async()=>{
    expect(server.address().address).toBe('127.0.0.1');
    const before=calls.length;
    for(const path of ['/admin','/api/admin','/private/file','/.env.test','/debug','/metrics','/ui'])
      for(const method of ['GET','POST','DELETE'])expect((await send(path,method)).status).toBe(404);
    for(const method of ['PUT','PATCH','OPTIONS','HEAD'])expect((await send('/mcp',method)).status).toBe(404);
    for(const method of ['POST','PUT','DELETE'])
      expect((await send('/.well-known/oauth-protected-resource',method)).status).toBe(404);
    expect(calls).toHaveLength(before);
    for(const method of ['GET','POST','DELETE'])expect((await send('/mcp',method)).status).toBe(401);
    expect((await send('/.well-known/oauth-protected-resource')).status).toBe(200);
  });
  it('solo admite rutas y métodos de MCP y metadata',()=>{
    expect(allowedMcpRoute('POST','/mcp','127.0.0.1:4331')).toBe(true);
    expect(allowedMcpRoute('GET','/.well-known/oauth-protected-resource',
      '127.0.0.1:4331')).toBe(true);
    for(const path of ['/admin','/api/admin','/api/admin/users','/private/file','/metrics',
      '/logs','/.env','/.env.test','/healthz','/ui','/unknown','/api/orders',
      '/debug','/mcp?next=/admin','/%61dmin','/mcp/../admin'])
      expect(allowedMcpRoute('GET',path,'127.0.0.1:4331')).toBe(false);
    expect(allowedMcpRoute('POST','/.well-known/oauth-protected-resource',
      '127.0.0.1:4331')).toBe(false);
    expect(allowedMcpRoute('GET','/mcp','evil.example')).toBe(false);
    expect(allowedMcpRoute('GET','/mcp','127.0.0.1:4331','https://evil.example'))
      .toBe(false);
  });
  it('rechaza rutas privadas y solo reenvía cabeceras permitidas a Astro loopback',async()=>{
    const before=calls.length;
    expect((await send('/admin')).status).toBe(404);
    expect((await send('/api/admin/users')).status).toBe(404);
    expect((await send('/mcp','GET',{Origin:'https://evil.example'})).status).toBe(404);
    expect((await send('/mcp','GET',{Host:'evil.example'})).status).toBe(404);
    expect(calls).toHaveLength(before);
    const meta=await send('/.well-known/oauth-protected-resource','GET',
      {Cookie:'private-session',Authorization:'Bearer synthetic'});
    expect(meta.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({url:
      'http://127.0.0.1:4321/.well-known/oauth-protected-resource',
      authorization:'Bearer synthetic',cookie:null});
    const denied=await send('/mcp');
    expect(denied.status).toBe(401);
    expect(denied.headers['www-authenticate']).toContain('resource_metadata');
    expect(denied.headers['cache-control']).toBe('no-store');
    const stream=await send('/mcp','GET',{Accept:'text/event-stream'});
    expect(stream.status).toBe(200);
    expect(stream.body).toContain('"synthetic":true');
  });
  it('corta respuestas excesivas y no sigue redirecciones ni filtra cabeceras privadas',async()=>{
    upstream.mockResolvedValueOnce(new Response('secret-location',{status:302,
      headers:{location:'https://external.example.test/private','set-cookie':'secret=1'}}));
    const redirected=await send('/mcp');
    expect(redirected.status).toBe(502);
    expect(redirected.headers.location).toBeUndefined();
    expect(redirected.headers['set-cookie']).toBeUndefined();
    let cancelled=false;
    upstream.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller){controller.enqueue(new Uint8Array(65_000));},
      cancel(){cancelled=true;},
    }),{headers:{'content-type':'application/json'}}));
    const oversized=await send('/mcp');
    expect(oversized.status).toBe(502);
    expect(oversized.body).toBe('');
    expect(cancelled).toBe(true);
  });
});
