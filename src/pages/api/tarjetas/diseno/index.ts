import type { APIRoute } from 'astro';
import { assertSameOrigin, jsonResponse } from '../../../../lib/orders/http';
import { ARTWORK_MAX_BYTES } from '../../../../lib/orders/artwork';
import { validateArtwork } from '../../../../lib/orders/artwork-validation';
import { saveCardArtwork } from '../../../../lib/db/card-artwork.repository';
import { artworkOwner } from '../../../../lib/orders/artwork-session';
import type { ArtworkLayout } from '../../../../lib/orders/artwork';
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!assertSameOrigin(request)) return jsonResponse({ error: 'Origen no permitido.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return jsonResponse({ error: 'Sube un archivo de imagen.' }, 415);
  const limit = ARTWORK_MAX_BYTES + 16384;
  if (Number(request.headers.get('content-length')) > limit) return jsonResponse({ error: 'Máximo 2 MB por imagen.' }, 413);
  let file: File; let layout: ArtworkLayout = {fit:'contain',x:50,y:50};
  try {
    const reader = request.body?.getReader(); if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length;
      if (length > limit) { await reader.cancel(); return jsonResponse({ error: 'Máximo 2 MB por imagen.' }, 413); } chunks.push(part.value); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
    const input = form.get('file'); if (!(input instanceof File)) throw new Error(); file = input;
    if (form.get('layout')) layout = JSON.parse(String(form.get('layout')));
    if (!['contain','cover'].includes(layout.fit) || ![layout.x,layout.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error();
  } catch { return jsonResponse({ error: 'No se ha podido leer el archivo.' }, 400); }
  const bytes = new Uint8Array(await file.arrayBuffer()); let validation;
  try { validation = await validateArtwork(bytes, layout); } catch (error) { return jsonResponse({ error: (error as Error).message }, 400); }
  try { return jsonResponse(await saveCardArtwork(bytes, validation, file.name, artworkOwner(cookies,true,new URL(request.url).protocol === 'https:')), 201); }
  catch { return jsonResponse({ error: 'No se ha podido guardar el diseño. Inténtalo de nuevo; el archivo no se considera enviado.' }, 503); }
};
