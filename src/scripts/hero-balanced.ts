import type { HeroTierRuntimeContext } from './hero-tier-bootstrap';
import { initPerformanceHeroTier } from './performance-hero-timeline';

export function initHeroTier(context: HeroTierRuntimeContext): void {
  if (context.tier !== 'balanced') throw new Error('Balanced runtime received another tier.');
  initPerformanceHeroTier(context);
}
