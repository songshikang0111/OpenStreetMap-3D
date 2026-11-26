// Cross-cell context for structures connected by a shared OSM node. Connected approaches at another
// height are included by the buffered group extent. Oversized structures are solved in each cell halo.
import type { Bounds, Diagnostic } from '@city-ink/tiles';
import { boundsIntersect, expandBounds } from './geo.js';
import type { Phase1Data } from '../../../src/phase1-types.js';

type Road = Phase1Data['roads'][number];
type IndexedRoad = { item: Road; bounds: Bounds };
interface Group {
  roads: IndexedRoad[];
  bounds: Bounds;
  oversized: boolean;
}

export function spanKm([w, s, e, n]: Bounds): number {
  const lat = ((s + n) * Math.PI) / 360;
  return Math.hypot((e - w) * 111.32 * Math.cos(lat), (n - s) * 110.57);
}
export const MAX_GROUP_KM = 20;

export function oversizedDiagnostic(type: string, id: string, span: number): Diagnostic {
  return {
    code: 'GROUP_TOO_LARGE',
    stage: 'plan',
    featureId: id,
    message: `${type} group ${id} spans ${span.toFixed(1)} km (limit ${MAX_GROUP_KM} km). Using cell-local geometry and the planning buffer.`,
  };
}

export class GradeGroups {
  readonly groups: Group[] = [];
  readonly oversized = new Set<number>();
  readonly diagnostics: Diagnostic[] = [];
  constructor(roads: IndexedRoad[]) {
    const graded = roads.filter(({ item: r }) => r.bridge || r.layer > 0 || r.type === 'steps');
    const parent = graded.map((_, i) => i);
    const root = (i: number) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const owner = new Map<number, number>();
    for (const [i, { item }] of graded.entries()) {
      for (const endpoints of item.segmentNodes)
        for (const id of endpoints) {
          if (id === null) continue;
          const before = owner.get(id);
          if (before === undefined) owner.set(id, i);
          else parent[root(i)] = root(before);
        }
    }
    const byRoot = new Map<number, Group>();
    for (const [i, road] of graded.entries()) {
      const key = root(i);
      const group = byRoot.get(key) ?? { roads: [], bounds: [...road.bounds] as Bounds, oversized: false };
      group.roads.push(road);
      const b = group.bounds,
        r = road.bounds;
      b[0] = Math.min(b[0], r[0]);
      b[1] = Math.min(b[1], r[1]);
      b[2] = Math.max(b[2], r[2]);
      b[3] = Math.max(b[3], r[3]);
      byRoot.set(key, group);
    }
    for (const group of byRoot.values()) {
      const span = spanKm(group.bounds);
      group.oversized = span > MAX_GROUP_KM;
      if (group.oversized) {
        let id = Infinity;
        for (const { item } of group.roads) {
          this.oversized.add(item.id);
          id = Math.min(id, item.id);
        }
        this.diagnostics.push(oversizedDiagnostic('road grade', 'way/' + id, span));
      }
      this.groups.push(group);
    }
  }
  addContext(selected: Set<Road>, roads: IndexedRoad[], bounds: Bounds) {
    const local = new Set(selected);
    for (const group of this.groups) {
      if (group.oversized || !boundsIntersect(group.bounds, bounds) || !group.roads.some((r) => local.has(r.item)))
        continue;
      const [w, s, e, n] = group.bounds;
      if (w >= bounds[0] && s >= bounds[1] && e <= bounds[2] && n <= bounds[3]) continue;
      const halo = expandBounds(group.bounds, 800);
      for (const r of roads) if (boundsIntersect(r.bounds, halo)) selected.add(r.item);
    }
  }
}
