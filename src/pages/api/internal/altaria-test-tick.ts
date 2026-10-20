import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { runAutomationTick } from '../../../lib/admin/automation/engine';
export const prerender=false;
export const POST:APIRoute=async({request,url})=>{
  const expected=process.env.ALTARIA_LOCAL_WORKER_SECRET??'';
  const supplied=request.headers.get('x-altaria-worker-secret')??'';
  if(process.env.ALTARIA_TEST_ISOLATED!=='1'||process.env.CI||process.env.VERCEL
    ||process.env.VERCEL_ENV||!['127.0.0.1','localhost'].includes(url.hostname)
    ||expected.length!==64||supplied.length!==64
    ||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))) {
    return new Response(null,{status:404});
  }
  try {
    const result=await runAutomationTick();
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  } catch {
    return Response.json({error:'El trabajador TEST reintentará.'},{status:503});
  }
};
