import type { Phase1Building, Point2, Ring } from './phase1-types.js';

export interface EnvelopePlan {
  wall(a: Point2, b: Point2, normal: [number, number, number]): { t0: number; t1: number; lo: number; hi: number }[];
  roof: Ring[][];
  bottom: Ring[][];
  neighbors: number;
}

export function planBuildingEnvelopes(
  buildings: Phase1Building[],
  options?: { exclude?: (b: Phase1Building) => boolean },
): Map<string, EnvelopePlan>;
