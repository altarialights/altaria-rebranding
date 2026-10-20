import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { hasAdminPermission } from '../../../../../../lib/admin/access';
import { assertCardsTest, CardsError } from '../../../../../../lib/admin/cards/service';
import { getDatabase } from '../../../../../../lib/db/client';
import { localTestLink, testQrPreview } from '../../../../../../lib/admin/cards/local-link';
export const prerender=false;
export const GET:APIRoute=async({locals,params,url})=>{
  const principal=locals.admin;
  if (!principal || !hasAdminPermission(principal,'cards:write')) return new Response(null,{status:403});
  if (!/^[0-9a-f-]{36}$/i.test(params.id??'')) return new Response(null,{status:404});
  try {
    const db=getDatabase(); await assertCardsTest(db);
    const row=await db.get(`SELECT l.public_code,l.channel,p.stripe_entorno FROM cards_dynamic_links l
      JOIN pedidos_tarjetas p ON p.id=l.order_id WHERE l.id=?`,[params.id]);
    if (!row || row.stripe_entorno!=='test' || row.channel!=='qr') return new Response(null,{status:404});
    const {canonicalUrl,testUrl}=localTestLink(String(row.public_code));
    const format=url.searchParams.get('format');
    if (canonicalUrl || format!=='svg' || url.searchParams.get('inline')!=='1') {
      return new Response('El material imprimible requiere una URL canónica pública aprobada.',{status:409});
    }
    if (format==='svg') {
      const svg=testQrPreview(await QRCode.toString(testUrl,{type:'svg',errorCorrectionLevel:'H',margin:4,width:1200}));
      return new Response(svg,{headers:{'Content-Type':'image/svg+xml; charset=utf-8',
        'Content-Disposition':'inline',
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    return new Response(null,{status:400});
  } catch(error) {
    return new Response(null,{status:error instanceof CardsError?error.status:503});
  }
};
