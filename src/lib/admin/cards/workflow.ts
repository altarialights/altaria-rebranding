export const productionStages = ['preparation', 'production', 'verification', 'ready_to_ship', 'shipped', 'delivered'] as const;
export type ProductionStage = typeof productionStages[number];
export const stageLabels: Record<ProductionStage, string> = {
  preparation: 'Preparación', production: 'Producción', verification: 'Verificación',
  ready_to_ship: 'Listo para envío', shipped: 'Enviado', delivered: 'Entregado',
};
export const checkKeys = ['preparation', 'artwork_review', 'print_record', 'nfc_programmed',
  'qr_verified', 'nfc_verified', 'physical_control'] as const;
export type CheckKey = typeof checkKeys[number];
export const checkLabels: Record<CheckKey, string> = {
  preparation: 'Preparación revisada', artwork_review: 'Diseño revisado',
  print_record: 'Impresión registrada', nfc_programmed: 'NFC programado',
  qr_verified: 'QR verificado', nfc_verified: 'NFC verificado',
  physical_control: 'Control físico superado',
};
export const batchModes = ['shared_batch', 'individual', 'identified_shared'] as const;
export type BatchMode = typeof batchModes[number];
export const modeLabels: Record<BatchMode, string> = {
  shared_batch: 'Código compartido por lote', individual: 'Código individual por tarjeta',
  identified_shared: 'Unidades identificadas · destino compartido',
};

export function nextStage(stage: ProductionStage): ProductionStage | null {
  const index = productionStages.indexOf(stage);
  return productionStages[index + 1] ?? null;
}

export function stageBlockers(stage: ProductionStage, checks: ReadonlySet<string>,
  allocated: number, ordered: number, blockingIncidents: number): string[] {
  if (stage === 'preparation') {
    return [
      ...(['preparation', 'artwork_review'] as const).filter((key) => !checks.has(key)).map((key) => checkLabels[key]),
      ...(allocated !== ordered ? [`Asignar ${ordered - allocated} unidades restantes a lotes`] : []),
    ];
  }
  if (stage === 'production') return (['print_record', 'nfc_programmed'] as const)
    .filter((key) => !checks.has(key)).map((key) => checkLabels[key]);
  if (stage === 'verification') return [
    ...(['qr_verified', 'nfc_verified', 'physical_control'] as const)
      .filter((key) => !checks.has(key)).map((key) => checkLabels[key]),
    ...(blockingIncidents ? ['Resolver las incidencias bloqueantes'] : []),
  ];
  if ((stage === 'ready_to_ship' || stage === 'shipped') && blockingIncidents) {
    return ['Resolver las incidencias bloqueantes'];
  }
  return [];
}
