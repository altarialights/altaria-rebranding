import type { HeroTierRuntimeContext } from './hero-tier-bootstrap';
import { initPerformanceHeroTier } from './performance-hero-timeline';

export function initHeroTier(context: HeroTierRuntimeContext): void {
  if (context.tier !== 'lite') throw new Error('Lite runtime received another tier.');
  initPerformanceHeroTier(context);
}
