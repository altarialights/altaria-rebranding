import type { APIRoute } from 'astro';
import { hasAdminPermission, verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { createProposal, createProposalResource, duplicateProposal, ProposalError,
  saveProposalVersion, transitionProposal, type ProposalContent } from '../../../../lib/admin/proposals/service';
export const prerender = false;
const value = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const messages: Record<string, string> = {
  forbidden: 'No tienes permiso para esta propuesta.', missing: 'No se encontró la propuesta.',
  invalid_input: 'Revisa los datos de la propuesta.', invalid_title: 'Escribe un título válido.',
  invalid_lines: 'Revisa partidas, importes y porcentajes.', invalid_content: 'Revisa alcance y condiciones.',
  invalid_expiry: 'La caducidad debe ser futura.', conflict: 'La propuesta cambió. Recarga antes de guardar.',
  closed: 'Esta propuesta ya tiene una decisión final. Duplícala para seguir trabajando.',
  transition_invalid: 'Este cambio de estado no es válido.', opportunity_missing: 'No existe la oportunidad.',
  note_required: 'Describe brevemente cómo se confirmó la decisión.',
  catalog_mismatch: 'El producto o servicio seleccionado no está disponible.',
  opportunity_closed: 'La oportunidad está cerrada.',
};
export const POST: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal || !hasAdminPermission(principal, 'crm:write')) return Response.json({ error: 'Acceso denegado.' }, { status: 403 });
  if (Number(context.request.headers.get('content-length') || 0) > 120_000) return Response.json({ error: 'Formulario demasiado grande.' }, { status: 413 });
  const data = await context.request.formData().catch(() => null);
  if (!data || !verifyAdminCsrfToken(principal.sessionHash, process.env.WORKOS_COOKIE_PASSWORD || '',
    value(data, 'csrf'), 'crm')) return Response.json({ error: 'Solicitud no autorizada.' }, { status: 403 });
  const action = context.params.action;
  try {
    let redirect = '/admin/crm/propuestas';
    if (action === 'create') {
      const opportunityId = value(data, 'opportunityId');
      if (!uuid(opportunityId)) throw new ProposalError('invalid_input');
      const id = await createProposal(principal, opportunityId, value(data, 'title'));
      redirect = `/admin/crm/propuestas/${id}`;
    } else if (action === 'version') {
      const id = value(data, 'proposalId');
      const expectedVersion = Number(value(data, 'expectedVersion'));
      if (!uuid(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new ProposalError('invalid_input');
      let lines: ProposalContent['lines'];
      try { lines = JSON.parse(value(data, 'linesJson')); } catch { throw new ProposalError('invalid_lines'); }
      if (!Array.isArray(lines)) throw new ProposalError('invalid_lines');
      const expiry = value(data, 'expiresAt');
      const expiresAt = expiry ? new Date(`${expiry}T23:59:59.000Z`).toISOString() : null;
      await saveProposalVersion(principal, id, { description: value(data, 'description'),
        scope: value(data, 'scope'), schedule: value(data, 'schedule'),
        terms: value(data, 'terms'), expiresAt, lines }, expectedVersion);
      redirect = `/admin/crm/propuestas/${id}?saved=version`;
    } else if (action === 'duplicate') {
      const id = value(data, 'proposalId');
      if (!uuid(id)) throw new ProposalError('invalid_input');
      redirect = `/admin/crm/propuestas/${await duplicateProposal(principal, id)}?saved=duplicate`;
    } else if (action === 'transition') {
      const id = value(data, 'proposalId');
      const target = value(data, 'transition');
      if (!uuid(id) || !['marked_sent', 'accepted', 'rejected', 'expired', 'changes_requested'].includes(target)) {
        throw new ProposalError('invalid_input');
      }
      await transitionProposal(principal, id, target as Parameters<typeof transitionProposal>[2], value(data, 'note'));
      redirect = `/admin/crm/propuestas/${id}?saved=status`;
    } else if (action === 'template' || action === 'catalog') {
      await createProposalResource(principal, action, {
        name: value(data, 'name'), kind: value(data, 'kind'), description: value(data, 'description'),
        scope: value(data, 'scope'), schedule: value(data, 'schedule'), terms: value(data, 'terms'),
        unitPrice: value(data, 'unitPrice'), taxBps: value(data, 'taxBps'),
      });
      redirect = '/admin/crm/propuestas?registrado=1';
    } else throw new ProposalError('invalid_input', 404);
    return context.request.headers.get('accept')?.includes('application/json')
      ? Response.json({ redirect }) : context.redirect(redirect, 303);
  } catch (error) {
    const status = error instanceof ProposalError ? error.status : 503;
    const code = error instanceof ProposalError ? error.code : 'unknown';
    return Response.json({ error: messages[code] || 'No se pudo guardar el cambio.', code }, { status });
  }
};
