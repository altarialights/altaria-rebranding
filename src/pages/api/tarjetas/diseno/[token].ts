import type { APIRoute } from 'astro';
import { findCardArtwork, removeCardArtwork } from '../../../../lib/db/card-artwork.repository';
import { artworkOwner } from '../../../../lib/orders/artwork-session';
import { assertSameOrigin, jsonResponse } from '../../../../lib/orders/http';
export const prerender = false;
export const GET: APIRoute = async ({ params, cookies, url }) => {
  try {
    const owner = artworkOwner(cookies);
    if (!owner) return new Response('Archivo no encontrado', {status:404});
    const file = await findCardArtwork(params.token ?? '', owner);
    if (!file) return new Response('Archivo no encontrado', { status: 404 });
    if (url.searchParams.has('metadata')) return jsonResponse({token:params.token,filename:file.filename,width:file.width,height:file.height,status:file.status,warnings:file.warnings,layout:file.layout});
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': file.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch { return new Response('Archivo no disponible', { status: 503 }); }
};
export const DELETE: APIRoute = async ({ params,cookies,request }) => {
  if (!assertSameOrigin(request)) return jsonResponse({error:'Origen no permitido.'},403);
  try { return await removeCardArtwork(params.token ?? '', artworkOwner(cookies)) ? new Response(null,{status:204}) : jsonResponse({error:'No se puede eliminar: no está en tu sesión o ya pertenece a un pedido o consulta.'},409); }
  catch { return jsonResponse({error:'No se ha podido eliminar el diseño.'},503); }
};
