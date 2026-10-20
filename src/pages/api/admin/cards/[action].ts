import type { APIRoute } from 'astro';
import { hasAdminPermission, verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { advanceProduction, CardsError, createBatch, openIncident, recordCheck,
  resolveIncident, setPriority, startProduction } from '../../../../lib/admin/cards/service';
import { batchModes, checkKeys, type BatchMode, type CheckKey } from '../../../../lib/admin/cards/workflow';
export const prerender = false;

const messages: Record<string, string> = {
  forbidden: 'No tienes permiso para realizar esta acción.', test_required: 'Cards solo está disponible en TEST verificado.',
  invalid_input: 'Revisa los datos introducidos.', order_missing: 'Pedido TEST no encontrado.',
  payment_required: 'El pedido necesita un pago test confirmado.', job_missing: 'Inicia la preparación primero.',
  check_stage: 'Esta comprobación corresponde a otra etapa.', batch_stage: 'Los lotes se preparan antes de producir.',
  batch_quantity: 'La cantidad de los lotes supera la del pedido.', idempotency_conflict: 'La operación repetida tiene otros datos.',
  version_conflict: 'El pedido cambió. Recarga la ficha.', stage_blocked: 'Completa las comprobaciones requeridas antes de avanzar.',
  stage_final: 'Este pedido ya está entregado.', shipment_required: 'Indica transportista y seguimiento.',
  incident_missing: 'Incidencia abierta no encontrada.', save_failed: 'No se pudo guardar el cambio.',
};
const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
export const POST: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal || !hasAdminPermission(principal, 'cards:write')) return Response.json({ error: messages.forbidden }, { status: 403 });
  if (Number(context.request.headers.get('content-length') ?? 0) > 16_000) return Response.json({ error: messages.invalid_input }, { status: 413 });
  const data = await context.request.formData().catch(() => null);
  if (!data || !verifyAdminCsrfToken(principal.sessionHash, process.env.WORKOS_COOKIE_PASSWORD || '', field(data, 'csrf'), 'cards')) {
    return Response.json({ error: messages.forbidden }, { status: 403 });
  }
  const orderId = field(data, 'orderId');
  const action = context.params.action;
  try {
    if (action === 'start') await startProduction(principal, orderId);
    else if (action === 'check') {
      const key = field(data, 'checkKey');
      if (!checkKeys.includes(key as CheckKey)) throw new CardsError('invalid_input');
      await recordCheck(principal, orderId, key as CheckKey, field(data, 'note'));
    } else if (action === 'batch') {
      const mode = field(data, 'mode');
      if (!batchModes.includes(mode as BatchMode)) throw new CardsError('invalid_input');
      await createBatch(principal, orderId, { mode: mode as BatchMode,
        quantity: Number(field(data, 'quantity')), idempotencyKey: field(data, 'idempotencyKey') });
    } else if (action === 'advance') {
      await advanceProduction(principal, orderId, Number(field(data, 'version')),
        { carrier: field(data, 'carrier'), tracking: field(data, 'tracking') });
    } else if (action === 'priority') await setPriority(principal, orderId, field(data, 'priority'));
    else if (action === 'incident') await openIncident(principal, orderId, field(data, 'summary'), field(data, 'severity'));
    else if (action === 'resolve') await resolveIncident(principal, orderId, field(data, 'incidentId'), field(data, 'resolution'));
    else return Response.json({ error: 'Acción desconocida.' }, { status: 404 });
    return context.redirect(`/admin/cards/${orderId}?saved=${action}`, 303);
  } catch (error) {
    const code = error instanceof CardsError ? error.code : 'save_failed';
    const status = error instanceof CardsError ? error.status : 500;
    return Response.json({ error: messages[code] ?? messages.save_failed, code }, { status });
  }
};
