// Type boundary for the phase-two packages (decision E4); the implementation stays in road-structures.js.
import type { Phase1Data, Point2 } from './phase1-types.js';
import type { RoadSurfacePlan } from './road-surface.js';

export interface PlainWriter {
  positions: number[];
  normals: number[];
  colors: number[];
}

export interface BridgeRail {
  a: Point2;
  b: Point2;
  y: number;
  yA: number;
  yB: number;
  width: number;
  walk: boolean;
  roadId: number;
  source: string;
}

export interface BridgePier {
  point: Point2;
  radius: number;
  top: number;
  deckBottom: number;
  width: number;
  angle: number;
  slope: number;
  roadId: number;
  walk: boolean;
  source: string;
}

export interface RoadStructurePlan {
  decks: unknown[];
  rails: BridgeRail[];
  piers: BridgePier[];
  stats: Record<string, unknown>;
}

export function planRoadStructures(data: Phase1Data, roadPlan: RoadSurfacePlan): RoadStructurePlan;
export function writeRoadStructures(plan: Pick<RoadStructurePlan, 'decks' | 'rails' | 'piers'>): {
  deck: PlainWriter;
  rail: PlainWriter;
  pier: PlainWriter;
};
export function roadStructureDimensions(segment: Record<string, unknown>): { thickness: number; railTop: number };
export function segmentDistance(p: Point2, a: Point2, b: Point2): number;
