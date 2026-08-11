import type { HeroTierRuntimeContext } from './hero-tier-bootstrap';
import { initFlowInteractions } from './flow-interactions';
import { initHero } from './hero-timeline';

export function initHeroTier(context: HeroTierRuntimeContext): void {
  if (context.tier !== 'full') throw new Error('Full runtime received another tier.');
  initHero();
  initFlowInteractions();
}
