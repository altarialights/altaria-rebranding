export type Urgency = 'urgent' | 'important' | 'informational';
export interface TelegramPayload {
  resourceType: string; resourceId: string; count?: number; day?: string;
  briefCounts?: { priorities:number; followups:number; proposals:number; cards:number; incidents:number };
}
export interface TelegramAdapter {
  deliver(message: { template: string; urgency: Urgency; payload: TelegramPayload }): Promise<{ result: 'simulated' }>;
}

// Deliberately has no network client, bot token or chat identifier.
export const simulatedTelegram: TelegramAdapter = {
  async deliver() { return { result: 'simulated' }; },
};

export function renderTelegram(template: string, urgency: Urgency, payload: TelegramPayload) {
  const headings: Record<string,string> = {
    'cards.paid': 'Pedido TEST pagado pendiente de preparación',
    'cards.incident': 'Incidencia de producción TEST',
    'cards.link.alert': 'Enlace Cards TEST requiere revisión',
    'proposal.sent': 'Propuesta TEST marcada como enviada',
    'proposal.responded': 'Respuesta comercial TEST registrada',
    'daily.brief': 'Resumen diario TEST',
  };
  if (!headings[template] || !['urgent','important','informational'].includes(urgency)
    || !/^[a-z_]+$/.test(payload.resourceType)
    || !/^[a-zA-Z0-9_-]{1,80}$/.test(payload.resourceId)) throw new Error('notification_invalid');
  if(template==='daily.brief') {
    const counts=payload.briefCounts;
    if(!counts||!/^\d{4}-\d{2}-\d{2}$/.test(payload.day??'')
      ||(['priorities','followups','proposals','cards','incidents'] as const)
        .some(key=>!Number.isSafeInteger(counts[key])||counts[key]<0||counts[key]>1_000_000))
      throw new Error('notification_invalid');
    return `Resumen diario TEST · ${payload.day}. ${counts.priorities} urgentes, `+
      `${counts.followups} seguimientos, ${counts.proposals} propuestas, `+
      `${counts.cards} acciones Cards y ${counts.incidents} incidencias. `+
      'Abre Altaria OS para revisar el contexto y las acciones.';
  }
  const suffix = template === 'daily.brief' && payload.day ? ` · ${payload.day}` : '';
  return `${headings[template]}${suffix}. Revisar en Altaria OS.`;
}
