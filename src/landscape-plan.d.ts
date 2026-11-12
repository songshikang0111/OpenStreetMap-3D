// Type boundary for the phase-two packages (decision E4); the implementation stays in landscape-plan.js.
import type { Phase1Data } from './phase1-types.js';

export const LANDSCAPE_PROFILE: Readonly<Record<string, number>>;
export function planLandscape(
  data: Phase1Data,
  options?: { roadPlan?: unknown; seed?: number; profile?: Record<string, unknown> },
): { surfaces: unknown[]; trees: unknown[]; props: unknown[]; sites: unknown[]; stats: Record<string, unknown> };
