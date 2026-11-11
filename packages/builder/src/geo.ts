// Coordinate plumbing between the phase-one project projection (local metres), WGS84 and the global tile grid.
import { lngLatToMercator, mercatorToLngLat, defaultExtentLog2, tileToLngLatBounds } from '@city-ink/tiles';
import type { LngLat, TileId, Bounds } from '@city-ink/tiles';
import type { Phase1Data, Point2 } from '../../../src/phase1-types.js';

export type Project = Phase1Data['project'];

export function toLngLat(project: Project, p: Point2): LngLat {
  const [lat, lon] = project.inverse(p);
  return [lon, lat];
}

export function toLocal(project: Project, p: LngLat): Point2 {
  return project.point({ lat: p[1], lon: p[0] });
}

/** Global grid coordinates (floating) of a lng/lat at a zoom: Mercator × 2^(z + extentLog2). */
export function toGrid(p: LngLat, z: number, extentLog2 = defaultExtentLog2(z)): [number, number] {
  const [mx, my] = lngLatToMercator(p);
  const k = 2 ** (z + extentLog2);
  return [mx * k, my * k];
}

export function fromGrid(g: [number, number], z: number, extentLog2 = defaultExtentLog2(z)): LngLat {
  const k = 2 ** (z + extentLog2);
  return mercatorToLngLat(g[0] / k, g[1] / k);
}

/** Tile rectangle in global grid coordinates [x0, y0, x1, y1]. */
export function tileGridRect(id: TileId, extentLog2 = defaultExtentLog2(id.z)): [number, number, number, number] {
  const e = 2 ** extentLog2;
  return [id.x * e, id.y * e, (id.x + 1) * e, (id.y + 1) * e];
}

/** Converts a global grid point to the tile's int16 grid (origin at the tile centre). */
export function gridToTile(g: [number, number], id: TileId, extentLog2 = defaultExtentLog2(id.z)): [number, number] {
  const e = 2 ** extentLog2;
  return [Math.round(g[0]) - (id.x * e + e / 2), Math.round(g[1]) - (id.y * e + e / 2)];
}

export function boundsContains(b: Bounds, p: LngLat): boolean {
  return p[0] >= b[0] && p[0] < b[2] && p[1] > b[1] && p[1] <= b[3];
}

export function expandBounds(b: Bounds, meters: number): Bounds {
  const lat = (b[1] + b[3]) / 2;
  const dLat = meters / 110540;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function ringBounds(points: LngLat[]): Bounds {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export { tileToLngLatBounds };
