export const originLabels: Record<string, string> = {
  manual: 'Alta manual', digital_lead: 'Diagnóstico digital', cards_inquiry: 'Consulta Cards',
  cards_order: 'Pedido Cards', other: 'Otro origen',
};
export const activityLabels: Record<string, string> = {
  call: 'Llamada', visit: 'Visita', meeting: 'Reunión', note: 'Nota',
};
export const timelineLabels: Record<string, string> = {
  'organization.created': 'Empresa creada', 'organization.updated': 'Ficha actualizada',
  'contact.created': 'Contacto añadido', 'opportunity.created': 'Oportunidad creada',
  'opportunity.stage': 'Etapa actualizada', 'activity.created': 'Actividad registrada',
  'task.created': 'Tarea creada', 'task.completed': 'Tarea completada',
  'task.reassigned': 'Responsable de tarea cambiado', 'source.linked': 'Fuente vinculada',
  'organization.merged': 'Empresas fusionadas',
};
export const formatCrmDate = (value: unknown): string => {
  if (!value) return 'Sin fecha';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(date);
};
export const formatCrmMoney = (cents: unknown): string => cents == null ? 'Sin importe'
  : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
