import { captureEvent } from '../analytics/posthog';

export type AssessmentEventName =
  | 'assessment_started'
  | 'assessment_section_completed'
  | 'assessment_completed'
  | 'report_gate_viewed'
  | 'report_unlocked'
  | 'review_requested'
  | 'result_viewed';

type AssessmentEventProperties = Record<string, string | number | boolean | null>;

export const trackAssessmentEvent = async (
  eventName: AssessmentEventName,
  properties: AssessmentEventProperties = {},
): Promise<void> => {
  await captureEvent(eventName, properties);
};
