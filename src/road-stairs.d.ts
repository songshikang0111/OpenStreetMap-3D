// Type boundary for the phase-two packages (decision E4); the implementation stays in road-stairs.js.
import type { Point2 } from './phase1-types.js';
import type { PlainWriter } from './road-structures.js';

export interface StairFlight {
  key: string;
  points: Point2[];
  y0: number;
  y1: number;
  width: number;
  roadIds?: number[];
  [key: string]: unknown;
}

export function writeRoadStairs(flights: StairFlight[]): {
  treads: PlainWriter;
  shell: PlainWriter;
  rails: PlainWriter;
  stats: Record<string, number | string>;
  metadata: unknown[];
};
