import type { Phase1Building, Ring } from './phase1-types.js';
import type { MeshWriter } from './generators/mesh-tools.js';
import type { RoofPlan } from './roofs.js';
import type { EnvelopePlan } from './building-envelope.js';

export const WALL_TRIM_MIN: number;
export const ENTRANCE_TIE: number;
export const ENTRANCE_MIN: number;

export interface BuildingCounts {
  familyCounts?: Record<string, number>;
  surfaceCounts?: Record<string, number>;
  grammarCounts?: Record<string, number>;
  roofStats?: { tagged: number; inferred: number; unsupported: number };
  nearWalls?: unknown[];
  roofDetails?: { start: number; end: number; anchor: number[]; size: number; weight: number }[];
}

export function writeBuildingBody(
  building: Phase1Building,
  options: {
    renderId: number;
    seed?: number;
    roofPlan: RoofPlan;
    envelopePlan: EnvelopePlan;
    writer?: MeshWriter;
    roofWriter?: MeshWriter;
    counts?: BuildingCounts;
    nearWalls?: unknown[];
  },
): {
  writer: MeshWriter;
  style: { family: string; code: number; surfaceName: string; grammar?: string };
  profile: unknown;
  roofWriter: MeshWriter;
};

export type { Ring };
