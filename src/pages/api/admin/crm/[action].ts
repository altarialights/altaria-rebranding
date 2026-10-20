import type { APIRoute } from 'astro';
import { hasAdminPermission, recordAdminAudit, verifyAdminCsrfToken } from '../../../../lib/admin/access';
import { activitySchema, contactSchema, opportunitySchema, organizationSchema,
  sourceLinkSchema, stageChangeSchema, taskActionSchema, taskSchema } from '../../../../lib/admin/crm/model';
import { changeOpportunityStage, classifyOrganizationCandidate, completeTask, createActivity, createContact,
  createOpportunity, createOrganization, createTask, CrmError, linkSource,
  reassignTask, updateOrganization } from '../../../../lib/admin/crm/service';
export const prerender = false;

const string = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const flag = (data: FormData, key: string) => data.get(key) === '1' || data.get(key) === 'on';
const toIso = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CrmError('invalid_date');
  return date.toISOString();
};
const errorMessages: Record<string, string> = {
  forbidden: 'No tienes permiso para realizar esta acción.',
  invalid_input: 'Revisa los campos e inténtalo de nuevo.',
  invalid_date: 'Introduce una fecha válida.',
  invalid_name: 'El nombre de la empresa necesita letras o números.',
  invalid_identifier: 'Revisa el identificador de la empresa.',
  duplicate_verified: 'Ese identificador verificado ya pertenece a otra empresa.',
  duplicate_review: 'Hay una posible empresa duplicada. Revisa la ficha y confirma expresamente si deseas crear o guardar ésta.',
  organization_missing: 'No se ha encontrado la empresa.',
  opportunity_missing: 'No se ha encontrado la oportunidad.',
  task_missing: 'No se ha encontrado la tarea.',
  resource_mismatch: 'El contacto o la oportunidad no pertenece a esta empresa.',
  assignee_invalid: 'El responsable elegido no está activo o no tiene un rol comercial.',
  assignee_outside_org: 'Ese responsable no tiene acceso a la empresa. Elige al responsable de la ficha o al propietario.',
  assignee_unchanged: 'La tarea ya está asignada a esa persona.',
  stage_invalid: 'Esa transición no está permitida. Avanza una etapa cada vez o marca la oportunidad como perdida.',
  stage_conflict: 'Otra persona modificó la oportunidad. Recarga la ficha.',
  lost_reason_required: 'Indica un motivo breve al marcar una oportunidad como perdida.',
  activity_future: 'Registra la actividad después de que ocurra; usa una tarea para programar el seguimiento.',
  task_already_done: 'La tarea ya está completada.', task_conflict: 'La tarea cambió. Recarga la ficha.',
  source_invalid: 'El tipo de fuente no es válido.', source_missing: 'No se encontró ese registro de origen en TEST.',
  source_not_test: 'Sólo se pueden vincular pedidos Stripe test en el entorno local.',
  source_already_linked: 'Esa fuente ya está vinculada a una empresa.',
  duplicate_contact: 'Ya existe un contacto con ese correo o un contacto principal para la empresa.',
  save_failed: 'No se pudo guardar. Vuelve a intentarlo.',
};
const safeHtml = (message: string) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRM · Altaria OS</title><main style="max-width:560px;margin:12vh auto;padding:28px;font:16px system-ui;color:#102d55"><h1>No se guardó el cambio</h1><p>${message}</p><button onclick="history.back()" style="padding:12px 18px;border:0;border-radius:8px;background:#075bd0;color:#fff">Volver al formulario</button></main></html>`;

export const POST: APIRoute = async (context) => {
  const principal = context.locals.admin;
  if (!principal) return Response.json({ error: 'Acceso denegado.' }, { status: 403 });
  const wantsJson = context.request.headers.get('accept')?.includes('application/json') ?? false;
  const fail = (code: string, status: number) => {
    const message = errorMessages[code] ?? errorMessages.save_failed;
    return wantsJson ? Response.json({ error: message, code }, { status })
      : new Response(safeHtml(message), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  if (!hasAdminPermission(principal, 'crm:write')) return fail('forbidden', 403);
  if (Number(context.request.headers.get('content-length') ?? 0) > 64_000) return fail('invalid_input', 413);
  const data = await context.request.formData().catch(() => null);
  if (!data) return fail('invalid_input', 400);
  const csrf = string(data, 'csrf');
  if (!verifyAdminCsrfToken(principal.sessionHash, process.env.WORKOS_COOKIE_PASSWORD || '', csrf, 'crm')) {
    return fail('forbidden', 403);
  }
  const action = context.params.action;
  try {
    if (action === 'dedup') {
      const result = await classifyOrganizationCandidate({
        name: string(data, 'name'), city: string(data, 'city') || null,
        identifierKind: string(data, 'identifierKind'), identifierValue: string(data, 'identifierValue'),
      });
      return Response.json({ kind: result.kind,
        matches: principal.roles.includes('owner')
          ? result.matches.map((match) => ({ id: String(match.id), name: String(match.name) })) : [] });
    }
    let redirect = '/admin/crm';
    if (action === 'organizations' || action === 'organization-update') {
      const parsed = organizationSchema.safeParse({
        name: string(data, 'name'), sector: string(data, 'sector'), city: string(data, 'city'),
        region: string(data, 'region'), countryCode: string(data, 'countryCode') || 'ES',
        websiteUrl: string(data, 'websiteUrl'), leadOrigin: string(data, 'leadOrigin') || 'manual',
        responsibleUserId: string(data, 'responsibleUserId'),
        identifierKind: string(data, 'identifierKind'), identifierValue: string(data, 'identifierValue'),
        confirmPossibleDuplicate: flag(data, 'confirmPossibleDuplicate'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      if (action === 'organizations') {
        const id = await createOrganization(principal, parsed.data);
        redirect = `/admin/crm/empresas/${id}?saved=organization`;
      } else {
        const id = string(data, 'organizationId');
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CrmError('invalid_input');
        await updateOrganization(principal, id, parsed.data);
        redirect = `/admin/crm/empresas/${id}?saved=organization`;
      }
    } else if (action === 'contacts') {
      const parsed = contactSchema.safeParse({
        organizationId: string(data, 'organizationId'), fullName: string(data, 'fullName'),
        email: string(data, 'email'), phone: string(data, 'phone'),
        jobTitle: string(data, 'jobTitle'), isPrimary: flag(data, 'isPrimary'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      await createContact(principal, parsed.data);
      redirect = `/admin/crm/empresas/${parsed.data.organizationId}?saved=contact#contacts`;
    } else if (action === 'opportunities') {
      const parsed = opportunitySchema.safeParse({
        organizationId: string(data, 'organizationId'), title: string(data, 'title'),
        amountEuros: string(data, 'amountEuros'), responsibleUserId: string(data, 'responsibleUserId'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      await createOpportunity(principal, parsed.data);
      redirect = `/admin/crm/empresas/${parsed.data.organizationId}?saved=opportunity#opportunities`;
    } else if (action === 'stage') {
      const parsed = stageChangeSchema.safeParse({
        opportunityId: string(data, 'opportunityId'), toStage: string(data, 'toStage'),
        lostReason: string(data, 'lostReason'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      const id = await changeOpportunityStage(principal, parsed.data);
      redirect = `/admin/crm/empresas/${id}?saved=stage#opportunities`;
    } else if (action === 'activities') {
      const parsed = activitySchema.safeParse({
        organizationId: string(data, 'organizationId'), opportunityId: string(data, 'opportunityId'),
        contactId: string(data, 'contactId'), kind: string(data, 'kind'),
        summary: string(data, 'summary'), detail: string(data, 'detail'),
        happenedAt: toIso(string(data, 'happenedAt') || new Date().toISOString()),
        followupTitle: string(data, 'followupTitle'),
        followupDueAt: toIso(string(data, 'followupDueAt')),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      await createActivity(principal, parsed.data);
      redirect = `/admin/crm/empresas/${parsed.data.organizationId}?saved=activity#activity`;
    } else if (action === 'tasks') {
      const parsed = taskSchema.safeParse({
        organizationId: string(data, 'organizationId'), opportunityId: string(data, 'opportunityId'),
        contactId: string(data, 'contactId'), title: string(data, 'title'),
        dueAt: toIso(string(data, 'dueAt')), responsibleUserId: string(data, 'responsibleUserId'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      await createTask(principal, parsed.data);
      redirect = `/admin/crm/empresas/${parsed.data.organizationId}?saved=task#tasks`;
    } else if (action === 'task-complete' || action === 'task-reassign') {
      const parsed = taskActionSchema.safeParse({
        taskId: string(data, 'taskId'), responsibleUserId: string(data, 'responsibleUserId'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      const id = action === 'task-complete'
        ? await completeTask(principal, parsed.data.taskId)
        : await reassignTask(principal, parsed.data.taskId, parsed.data.responsibleUserId || '');
      redirect = `/admin/crm/empresas/${id}?saved=task#tasks`;
    } else if (action === 'source-links') {
      const parsed = sourceLinkSchema.safeParse({
        organizationId: string(data, 'organizationId'), sourceKind: string(data, 'sourceKind'),
        sourceId: string(data, 'sourceId'),
      });
      if (!parsed.success) throw new CrmError('invalid_input');
      await linkSource(principal, parsed.data);
      redirect = `/admin/crm/empresas/${parsed.data.organizationId}?saved=source#sources`;
    } else return fail('invalid_input', 404);
    return wantsJson ? Response.json({ redirect }) : context.redirect(redirect, 303);
  } catch (error) {
    if (error instanceof CrmError) {
      if (error.status === 403) {
        try { await recordAdminAudit(principal, 'crm.action.denied', 'denied', 'action', action ?? null); }
        catch { return fail('save_failed', 503); }
      }
      return fail(error.code, error.status);
    }
    // Unique indices reject duplicate contact emails and multiple primary contacts.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('UNIQUE constraint failed: crm_contacts')) return fail('duplicate_contact', 409);
    return fail('save_failed', 503);
  }
};
