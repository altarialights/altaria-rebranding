import type { APIRoute } from 'astro';
import { hasAdminPermission } from '../../../../../lib/admin/access';
import { listLinkMetrics } from '../../../../../lib/admin/cards/links';
import { CardsError } from '../../../../../lib/admin/cards/service';
export const prerender=false;
const csv=(value:unknown)=>`"${String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`;
export const GET:APIRoute=async({locals,url})=>{
  const principal=locals.admin;
  if (!principal || !hasAdminPermission(principal,'cards:read')) return new Response(null,{status:403});
  try {
    const filters=Object.fromEntries(['orderId','organizationId','batchId','unitId','channel','campaign','destination','trafficClass','from','to']
      .map(key=>[key,url.searchParams.get(key)??'']));
    const rows=await listLinkMetrics(principal,filters);
    const fields=['day_utc','organization_id','organization_name','order_id','batch_id','unit_id','channel',
      'campaign','destination','traffic_class','openings'];
    const lines=[fields.join(',')];
    for (const row of rows) lines.push(fields.map(key=>csv(row[key])).join(','));
    return new Response(`\uFEFF${lines.join('\r\n')}\r\n`,{headers:{'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':'attachment; filename="altaria-cards-test-analytics.csv"',
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch(error) { return new Response(null,{status:error instanceof CardsError?error.status:503}); }
};
