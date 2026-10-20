import type { APIRoute } from 'astro';
import { publicCodePattern, recordOpening, resolvePublicLink } from '../../lib/admin/cards/links';
export const prerender = false;

// Local TEST only. A public deployment requires its own reviewed edge rate limit and domain.
let windowStart=Date.now(), requests=0;
const headers={ 'Cache-Control':'private, no-store, max-age=0', 'Referrer-Policy':'no-referrer',
  'X-Robots-Tag':'noindex, nofollow', 'X-Content-Type-Options':'nosniff' };
const missing=()=>new Response('Enlace no disponible.',{status:404,headers});
export const GET:APIRoute=async({request,params,url})=>{
  if (process.env.ALTARIA_TEST_ISOLATED!=='1' || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV
    || !['127.0.0.1','localhost'].includes(url.hostname) || !publicCodePattern.test(params.code??'')) return missing();
  if (Date.now()-windowStart>60_000) { windowStart=Date.now(); requests=0; }
  if (++requests>600) return new Response('Temporalmente no disponible.',{status:429,headers});
  let resolved;
  try { resolved=await resolvePublicLink(params.code??''); } catch { return missing(); }
  if (!resolved) return missing();
  const agent=request.headers.get('user-agent')??'';
  const trafficClass=/(bot|crawler|spider|preview|facebookexternalhit|slackbot|whatsapp)/i.test(agent)
    ? 'suspected_bot' : 'unclassified';
  // Local TEST analytics are best effort. Do not add a fixed wait to a redirect.
  // Public activation needs a durable ingestion path before this can claim complete counts.
  void recordOpening(resolved.linkId,trafficClass,resolved.targetRevision).catch(()=>{});
  return new Response(null,{status:302,headers:{...headers,Location:resolved.url}});
};
