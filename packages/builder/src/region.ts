// GeoJSON build masks use [longitude, latitude]. Closed objects keep a single owner; roads and surfaces are clipped.
import clipping from 'polygon-clipping';
import type { LngLat, Bounds } from '@city-ink/tiles';
import type { PlanRecord } from './plan.js';

type Coordinates = ReadonlyArray<ReadonlyArray<readonly number[]>>;
export type BuildRegion =
  | { type: 'Polygon'; coordinates: Coordinates; bbox?: readonly number[] }
  | { type: 'MultiPolygon'; coordinates: readonly Coordinates[]; bbox?: readonly number[] };
export type BuildRegionInput =
  | BuildRegion
  | {
      type: 'Feature';
      geometry: BuildRegion;
      properties?: Record<string, unknown> | null;
      id?: string | number;
      bbox?: readonly number[];
    };

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: 'BUILD_REGION_INVALID' });
}

function inRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1]!,
      [bx, by] = ring[i]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by))
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export class RegionMask {
  readonly polygons: LngLat[][][];
  readonly bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  constructor(input: BuildRegionInput) {
    const geom = input?.type === 'Feature' ? input.geometry : input;
    if (!geom || !['Polygon', 'MultiPolygon'].includes(geom.type))
      invalid('Expected a GeoJSON Polygon or MultiPolygon, optionally wrapped in a Feature.');
    const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    this.polygons = [];
    if (!Array.isArray(polygons) || !polygons.length) invalid('Build region is empty.');
    for (const polygon of polygons) {
      const part: LngLat[][] = [];
      this.polygons.push(part);
      if (!Array.isArray(polygon) || !polygon.length) invalid('Build region has an empty polygon.');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) invalid('Each polygon ring needs at least four positions.');
        const boundary: LngLat[] = [];
        part.push(boundary);
        for (const p of ring) {
          if (
            !Array.isArray(p) ||
            p.length < 2 ||
            !p.every(Number.isFinite) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 80
          )
            invalid('Build region coordinates must be finite WGS84 longitude and latitude within ±80° latitude.');
          boundary.push([p[0], p[1]]);
          this.bounds[0] = Math.min(this.bounds[0], p[0]);
          this.bounds[1] = Math.min(this.bounds[1], p[1]);
          this.bounds[2] = Math.max(this.bounds[2], p[0]);
          this.bounds[3] = Math.max(this.bounds[3], p[1]);
        }
        const first = ring[0]!,
          last = ring.at(-1)!;
        if (first[0] !== last[0] || first[1] !== last[1]) invalid('Each polygon ring must be closed.');
      }
    }
    const [w, s, e, n] = this.bounds;
    if (s === n || w === e || e - w > 180) invalid('The region must have positive area inside one longitude interval.');
  }

  contains(point: LngLat): boolean {
    return this.polygons.some(
      ([shell, ...holes]) => inRing(point, shell!) && !holes.some((hole) => inRing(point, hole)),
    );
  }

  private line(record: PlanRecord): PlanRecord[] {
    const geometry: LngLat[][][] = [],
      elevation: number[][][] = [];
    record.geometry.forEach(([points], part) => {
      if (!points) return;
      const heights = record.elevation?.[part]?.[0];
      let current: LngLat[] | undefined;
      let currentHeights: number[] = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        if (dx === 0 && dy === 0) continue;
        const ts = [0, 1];
        for (const polygon of this.polygons)
          for (const ring of polygon)
            for (let j = 1; j < ring.length; j++) {
              const c = ring[j - 1]!,
                d = ring[j]!,
                ex = d[0] - c[0],
                ey = d[1] - c[1];
              const den = dx * ey - dy * ex,
                cx = c[0] - a[0],
                cy = c[1] - a[1];
              if (den === 0) continue; // endpoints of collinear edges are also endpoints of adjacent crossing edges
              const t = (cx * ey - cy * ex) / den,
                u = (cx * dy - cy * dx) / den;
              if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
            }
        ts.sort((x, y) => x - y);
        const point = (t: number): LngLat => (t === 0 ? a : t === 1 ? b : [a[0] + t * dx, a[1] + t * dy]);
        for (let k = 1; k < ts.length; k++) {
          const lo = ts[k - 1]!,
            hi = ts[k]!;
          if (hi - lo < 1e-12 || !this.contains(point((hi + lo) / 2))) continue;
          const start = point(lo),
            stop = point(hi);
          const last = current?.at(-1);
          if (!current || !last || last[0] !== start[0] || last[1] !== start[1]) {
            current = [start];
            geometry.push([current]);
            if (heights) {
              currentHeights = [heights[i - 1]! + lo * (heights[i]! - heights[i - 1]!)];
              elevation.push([currentHeights]);
            }
          }
          current.push(stop);
          if (heights) {
            const low = heights[i - 1]!,
              change = heights[i]! - low;
            currentHeights.push(low + hi * change);
          }
        }
      }
    });
    return geometry.length
      ? [{ ...record, geometry, anchor: geometry[0]![0]![0]!, ...(record.elevation ? { elevation } : {}) }]
      : [];
  }

  clip(record: PlanRecord): PlanRecord[] {
    if (
      ['building', 'landmark', 'detail', 'tree'].includes(record.layer) ||
      (record.layer === 'structure' && ['stairs', 'pier'].includes(String(record.properties.kind)))
    )
      return this.contains(record.anchor) ? [record] : [];
    if (record.layer === 'road' || record.layer === 'structure') return this.line(record);
    const geometry = clipping.intersection(record.geometry, this.polygons);
    return geometry.length ? [{ ...record, geometry, anchor: geometry[0]![0]![0]! }] : [];
  }
}
