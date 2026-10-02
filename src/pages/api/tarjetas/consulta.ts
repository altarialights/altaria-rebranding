import type { APIRoute } from 'astro';
import { cardInquirySchema } from '../../../lib/contact/cards-inquiry';
import { saveCardInquiry, InquiryConflictError } from '../../../lib/db/card-inquiries.repository';
import { hasTursoConfiguration } from '../../../lib/db/client';
import { acceptsJsonBody, assertSameOrigin, jsonResponse } from '../../../lib/orders/http';
import { artworkOwner } from '../../../lib/orders/artwork-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!assertSameOrigin(request)) return jsonResponse({ error: 'Origen no permitido.' }, 403);
  if (!acceptsJsonBody(request)) return jsonResponse({ error: 'La petición no es válida.' }, 415);
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 20_000) return jsonResponse({ error: 'La consulta es demasiado larga.' }, 413);
    body = JSON.parse(raw);
  } catch { return jsonResponse({ error: 'No hemos podido leer la consulta.' }, 400); }
  const result = cardInquirySchema.safeParse(body);
  if (!result.success) return jsonResponse({ error: 'Revisa tu nombre, el email o teléfono, la idea y la aceptación de privacidad.' }, 400);
  const elapsed = Date.now() - result.data.startedAt;
  if (elapsed < 2000 || elapsed > 86_400_000) return jsonResponse({ error: 'Vuelve a intentarlo en unos segundos. Si la página lleva abierta más de un día, recárgala.' }, 400);
  if (!hasTursoConfiguration()) return jsonResponse({ error: 'No podemos guardar tu consulta ahora. Inténtalo más tarde o contacta por WhatsApp o email.' }, 503);
  try {
    const id = await saveCardInquiry(result.data, artworkOwner(cookies));
    return jsonResponse({ saved: true, id }, 201);
  } catch (error) {
    if (error instanceof InquiryConflictError) return jsonResponse({ error: 'La consulta ha cambiado. Vuelve a enviarla.' }, 409);
    console.error('[cards] No se pudo guardar la consulta.', { type: error instanceof Error ? error.name : 'UnknownError' });
    return jsonResponse({ error: 'No hemos podido guardar tu consulta. Tus datos siguen en el formulario para reintentarlo.' }, 500);
  }
};
