export interface AssessmentRateLimitContext {
  request: Request;
  action: 'submit' | 'request_review';
}

// Extension point for Vercel Firewall, KV or another shared limiter.
// The anti-bot timing, honeypot and same-origin checks remain active meanwhile.
export const allowAssessmentRequest = async (
  _context: AssessmentRateLimitContext,
): Promise<boolean> => true;
