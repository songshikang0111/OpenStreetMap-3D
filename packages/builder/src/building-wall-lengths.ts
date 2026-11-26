// L1 geometry uses quantized tile metres. Keep original metrics only where that rounding changes a wall rule.
import type { LngLat } from '@city-ink/tiles';
import type { Ring } from '../../../src/phase1-types.js';
import { normalizedRing } from '../../../src/generators/mesh-tools.js';
import { WALL_TRIM_MIN, ENTRANCE_TIE, ENTRANCE_MIN } from '../../../src/building-mesh.js';
import { toLocal } from './geo.js';
import type { Project } from './geo.js';

function lengths(ring: Ring, hole: boolean): number[] {
  const points = normalizedRing(ring, hole);
  return points.map(([x, z], i) => {
    const b = points[(i + 1) % points.length]!;
    return Math.hypot(b[0] - x, b[1] - z);
  });
}

function entrance(lengths: number[]): number {
  let best = 0;
  for (let i = 1; i < lengths.length; i++) if (lengths[i]! > lengths[best]! + ENTRANCE_TIE) best = i;
  return best;
}

export function buildingWallLengths(
  rings: LngLat[][],
  quantized: number[][],
  step: number,
  project: Project,
  height: number,
  minHeight: number,
): string | null {
  if (!(height > 6)) return null;
  const entries: [number, number, number][] = [];
  for (const [r, ring] of rings.entries()) {
    const grid = quantized[r]!;
    const source = lengths(
      ring.map((p) => toLocal(project, p)),
      r > 0,
    );
    const tile = lengths(
      ring.map((_, i) => [grid[i * 2]! * step, grid[i * 2 + 1]! * step]),
      r > 0,
    );
    const canPlaceEntrance = r === 0 && height > 10 && minHeight === 0 && source.length > 0;
    const original = canPlaceEntrance ? entrance(source) : 0;
    const rounded = canPlaceEntrance ? entrance(tile) : 0;
    const sourceDoor = canPlaceEntrance && source[original]! > ENTRANCE_MIN;
    const tileDoor = canPlaceEntrance && tile[rounded]! > ENTRANCE_MIN;
    // Exposed spans can be shorter than a whole edge. Preserve the ranking inputs, letting the runtime
    // still choose among the ground-level spans that the envelope has actually left exposed.
    const entranceChanged = sourceDoor !== tileDoor || (sourceDoor && original !== rounded);
    for (const [i, length] of source.entries()) {
      if (entranceChanged || length > WALL_TRIM_MIN !== tile[i]! > WALL_TRIM_MIN) entries.push([r, i, length]);
    }
  }
  return entries.length ? JSON.stringify(entries) : null;
}
