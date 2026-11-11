import type { Phase1Data, Point2, Phase1Road } from './phase1-types.js';

export interface GradedSegment {
  a: Point2;
  b: Point2;
  yA: number;
  yB: number;
  y: number;
  road: Phase1Road;
  ramp: boolean;
  stairFlight?: unknown;
  gradient: number;
  source: string;
}

export interface RoadSurfacePiece {
  polygon: Point2[];
  y: number;
  a?: Point2;
  b?: Point2;
  yA?: number;
  yB?: number;
  heightOffset?: number;
  kind?: string;
  roadId?: number;
  source?: string;
  bridge?: boolean;
  level?: string;
  [key: string]: unknown;
}

export interface RoadSurfacePlan {
  surfaces: RoadSurfacePiece[];
  markings: RoadSurfacePiece[];
  grades: { segments: GradedSegment[]; stairs: unknown[]; stats: Record<string, number> };
  stats: Record<string, number>;
}

export function planRoadSurface(data: Phase1Data, options?: Record<string, unknown>): RoadSurfacePlan;
export function inlayRoadPaint(plan: RoadSurfacePlan): { surfaces: RoadSurfacePiece[]; markings: RoadSurfacePiece[] };
