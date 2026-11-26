// Region-scale water masks. Union within fixed metre-grid squares instead of sweeping every polygon
// in a province through one priority queue. Used identically for every planning cell.
import clipping from 'polygon-clipping';
import { area } from '../../../../src/osm.js';
import type { Phase1Polygon, Point2 } from '../../../../src/phase1-types.js';
import type { Diagnostic } from '@city-ink/tiles';

const SQUARE = 2048;
type Polygon = Point2[][];
function union(pieces: Polygon[]) {
  let layer: Polygon[][] = pieces.map((p) => [p]);
  while (layer.length > 1) {
    const next: Polygon[][] = [];
    for (let i = 0; i < layer.length; i += 16) {
      const [first, ...rest] = layer.slice(i, i + 16);
      next.push(clipping.union(first!, ...rest));
    }
    layer = next;
  }
  return layer[0] ?? [];
}

export function regionalWater(polygons: Phase1Polygon[], diagnostics: Diagnostic[]): Phase1Polygon[] {
  const buckets = new Map<string, { ids: Set<string>; pieces: Polygon[] }>();
  for (const p of polygons) {
    let west = Infinity,
      north = Infinity,
      east = -Infinity,
      south = -Infinity;
    for (const [x, z] of p.outer) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      north = Math.min(north, z);
      south = Math.max(south, z);
    }
    const span = Math.hypot(east - west, south - north);
    if (span > 20000)
      diagnostics.push({
        code: 'GROUP_TOO_LARGE',
        stage: 'plan',
        featureId: p.id,
        message: `Water group ${p.id} spans ${(span / 1000).toFixed(1)} km. Its intersections and unions are bounded to ${SQUARE} m squares.`,
      });
    const poly = [p.outer, ...p.holes];
    for (let x = Math.floor(west / SQUARE); x <= Math.floor(east / SQUARE); x++)
      for (let z = Math.floor(north / SQUARE); z <= Math.floor(south / SQUARE); z++) {
        const x0 = x * SQUARE,
          z0 = z * SQUARE,
          x1 = x0 + SQUARE,
          z1 = z0 + SQUARE;
        const pieces =
          west >= x0 && east <= x1 && north >= z0 && south <= z1
            ? [poly]
            : clipping.intersection(poly, [
                [
                  [x0, z0],
                  [x1, z0],
                  [x1, z1],
                  [x0, z1],
                  [x0, z0],
                ],
              ]);
        if (!pieces.length) continue;
        const key = x + '/' + z;
        const group = buckets.get(key) ?? { ids: new Set<string>(), pieces: [] as Polygon[] };
        group.ids.add(p.id);
        group.pieces.push(...pieces);
        buckets.set(key, group);
      }
  }
  const out: Phase1Polygon[] = [];
  for (const [key, { ids, pieces }] of buckets) {
    const sourceIds = [...ids].sort();
    for (const [i, [outer, ...holes]] of union(pieces).entries()) {
      if (!outer) continue;
      out.push({
        id: `water:${key}:${i}`,
        outer,
        holes,
        tags: { natural: 'water' },
        source: 'osm',
        sourceIds,
        area: area(outer) - holes.reduce((sum, h) => sum + area(h), 0),
      });
    }
  }
  return out;
}
