import type { Phase1Building, Phase1Data, Point2, Ring } from './phase1-types.js';

export function projection(lat: number, lon: number): Phase1Data['project'];
export function area(ring: Ring): number;
export function inside(p: Point2, ring: Ring): boolean;
export function stableRandom(key: string): () => number;
export function metres(value: unknown): number;
export function heightInfo(
  tags: Record<string, string>,
  footprintArea: number,
  id: string,
  seed?: number,
): { height: number; minHeight: number; levels: number; source: 'height' | 'levels' | 'estimated' };
export function isWaterArea(tags: Record<string, string>): boolean;
export function parseOSM(
  raw: unknown,
  seed?: number,
  options?: {
    waterMask?: Phase1Data['water'];
    onBuildingFootprints?(buildings: Phase1Building[]): void;
    mergeWater?(polygons: Phase1Data['water']): Phase1Data['water'];
    onRelationError?(id: number, incomplete: boolean): void;
  },
): Phase1Data;

export function clipSegment(a: Point2, b: Point2, bounds: [number, number, number, number]): [Point2, Point2] | null;
