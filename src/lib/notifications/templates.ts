import type { AssessmentDimension, CommercialPriority } from '../assessment/types';
import type { NewAssessmentNotificationInput } from './types';

const DIMENSION_LABELS: Record<AssessmentDimension, string> = {
  presence: 'Presencia digital',
  acquisition: 'Captación',
  brand: 'Marca',
  operations: 'Operaciones',
  technology: 'Tecnología',
};

const QUICK_READS: Record<AssessmentDimension, string> = {
  operations: 'La empresa tiene margen claro para automatizar procesos y reducir tareas manuales.',
  acquisition: 'Existe una oportunidad clara de mejorar la captación de clientes y la conversión digital.',
  presence: 'La empresa necesita reforzar su presencia digital y visibilidad online.',
  technology: 'La infraestructura tecnológica limita el crecimiento y la eficiencia.',
  brand: 'La marca necesita mayor coherencia y diferenciación digital.',
};

const PRIORITY_LABELS: Record<CommercialPriority, string> = {
  LOW: 'BAJO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
  VERY_HIGH: 'MUY ALTO',
};

export const escapeTelegramHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const getNotificationHeader = (
  priority: CommercialPriority,
  reviewRequested: boolean,
): string => {
  if (reviewRequested) return '🚨 REVISIÓN PERSONAL SOLICITADA';
  if (priority === 'VERY_HIGH') return '🔥 NUEVO LEAD MUY PRIORITARIO';
  if (priority === 'HIGH') return '🟠 NUEVO LEAD PRIORITARIO';
  if (priority === 'MEDIUM') return '🔵 NUEVO DIAGNÓSTICO';
  return '⚪ NUEVO DIAGNÓSTICO';
};

export const getDeterministicQuickRead = (dimension: AssessmentDimension): string =>
  QUICK_READS[dimension];

const formatDimensionScore = (score: number | null): string =>
  score === null ? 'Datos insuficientes' : `${score}/100`;

export const formatNewAssessmentTelegramMessage = (
  input: NewAssessmentNotificationInput,
): string => {
  const { lead, result } = input;
  const dimensions = new Map(
    result.dimensionScores.map(({ dimension, score }) => [dimension, score]),
  );
  const dimensionLines = (Object.keys(DIMENSION_LABELS) as AssessmentDimension[])
    .map((dimension) => `${DIMENSION_LABELS[dimension]}: ${formatDimensionScore(dimensions.get(dimension) ?? null)}`)
    .join('\n');
  const secondaryOpportunity = result.secondaryOpportunity
    ? DIMENSION_LABELS[result.secondaryOpportunity]
    : 'Sin oportunidad secundaria';
  const reviewLine = lead.reviewRequested
    ? '\n✅ Ha solicitado revisión personal\n'
    : '';

  return [
    `<b>${getNotificationHeader(input.commercialPriority, lead.reviewRequested)}</b>`,
    '',
    `<b>Empresa:</b> ${escapeTelegramHtml(lead.companyName)}`,
    `<b>Contacto:</b> ${escapeTelegramHtml(lead.fullName)} — ${escapeTelegramHtml(lead.jobTitle)}`,
    `<b>Email:</b> ${escapeTelegramHtml(lead.email)}`,
    `<b>Tamaño:</b> ${escapeTelegramHtml(lead.companySize)}`,
    '',
    `<b>Índice digital:</b> ${result.overallScore}/100`,
    escapeTelegramHtml(result.maturityLabel),
    '',
    '<b>📊 ÁREAS</b>',
    dimensionLines,
    '',
    `<b>Principal oportunidad:</b> ${DIMENSION_LABELS[result.primaryOpportunity]}`,
    `<b>Oportunidad secundaria:</b> ${secondaryOpportunity}`,
    '',
    `<b>Lead Score:</b> ${input.commercialScore}/100 — ${PRIORITY_LABELS[input.commercialPriority]}`,
    reviewLine,
    `<i>${getDeterministicQuickRead(result.primaryOpportunity)}</i>`,
    '',
    '<b>Ver diagnóstico:</b>',
    escapeTelegramHtml(input.resultUrl),
  ].join('\n');
};
