import type { Phase1Data } from './phase1-types.js';
import type { RoadSurfacePlan } from './road-surface.js';

export interface PlannedTree {
  x: number;
  z: number;
  h: number;
  radius: number;
  key: string;
  source: string;
  shape: string;
  crownBottom: number;
  crownTop: number;
  roadId?: number;
  [key: string]: unknown;
}

export function planStreetLife(
  data: Phase1Data,
  options?: {
    treeMode?: 'all' | 'observed';
    seed?: number;
    maxTrees?: number | null;
    roadPlan?: RoadSurfacePlan | null;
    landscapeTrees?: unknown[];
  },
): { trees: PlannedTree[]; stats: Record<string, number>; [key: string]: unknown };
