// Run locally, never as a public HTTP route. User supplies an OAuth WEB client.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const file = '.env.bookings.local';
const existing = readFileSync(file,'utf8');
const env = parseEnv(existing);
if(!env.BOOKING_GOOGLE_CLIENT_ID || !env.BOOKING_GOOGLE_CLIENT_SECRET)throw new Error('Configura primero el Client ID y Client Secret en .env.bookings.local.');
const redirect = 'http://127.0.0.1:8765/callback';
const state = randomBytes(32).toString('hex');
const verifier = randomBytes(48).toString('base64url');
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({client_id:env.BOOKING_GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',
  scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
  access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
let accepting=true;
const server=createServer(async(req,res)=>{
  const callback=new URL(req.url || '/',redirect);
  if(!accepting || callback.pathname!=='/callback' || callback.searchParams.get('state')!==state){res.writeHead(400);res.end('Solicitud no valida.');return;}
  accepting=false;
  try {
    const code=callback.searchParams.get('code');if(!code)throw new Error('Authorization declined');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
      client_id:env.BOOKING_GOOGLE_CLIENT_ID,client_secret:env.BOOKING_GOOGLE_CLIENT_SECRET,code,code_verifier:verifier,
      redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
    const data=await response.json();if(!response.ok || !data.refresh_token)throw new Error('No refresh token');
    const updated=existing.replace(/^BOOKING_GOOGLE_REFRESH_TOKEN=.*\r?\n?/gm,'');
    writeFileSync(file,`${updated.trimEnd()}\nBOOKING_GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`,{mode:0o600});
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    res.end('Autorización guardada en .env.bookings.local. Puedes cerrar esta pestaña.');
    console.log('Autorización guardada. No se han creado eventos ni enviado invitaciones.');
  }catch{res.writeHead(502);res.end('No se pudo completar la autorizacion. Repite el comando.');process.exitCode=1;}
  finally{server.close();clearTimeout(timeout);}
});
server.listen(8765,'127.0.0.1',()=>console.log('Abre esta URL y autoriza la cuenta del organizador:\n'+url.href));
const timeout=setTimeout(()=>{server.close();console.error('Autorización caducada. Repite el comando.');},10*60_000);
