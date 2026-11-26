import type { Phase1Data, Point2, Ring } from './phase1-types.js';

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
export function parseOSM(raw: unknown, seed?: number): Phase1Data;

export function clipSegment(a: Point2, b: Point2, bounds: [number, number, number, number]): [Point2, Point2] | null;
