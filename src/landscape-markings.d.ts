// Type boundary for the phase-two packages (decision E4); the implementation stays in landscape-markings.js.
import type { Phase1Data, Point2 } from './phase1-types.js';
export function planLandscapeMarkings(
  data: Phase1Data,
  plan: unknown,
  options?: { maxStrips?: number },
): { featureId: string; outer: Point2[]; holes: Point2[][]; kind?: string }[];
