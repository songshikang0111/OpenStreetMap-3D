import type { Phase1Building } from './phase1-types.js';

export interface RoofPlan {
  shape: string;
  source: 'osm' | 'inferred';
  supported: boolean;
  eave: number;
  dimensionsInferred?: boolean;
  [key: string]: unknown;
}

export function planRoof(building: Phase1Building, options?: { inferRoofs?: boolean }): RoofPlan;
export function writeRoof(...args: unknown[]): void;
