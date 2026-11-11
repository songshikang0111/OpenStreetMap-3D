// Tile selection (04 section 5.1): visible ground footprint, screen-space error refinement between levels, coverage
// filtering, and budget-ordered priorities. Pure: no fetching, no rendering.
import { Vector3 } from 'three';
import { childTiles, lngLatToTile, tileKey, tileToLngLatBounds, tileCenterLngLat } from '@city-ink/tiles';
import type { Coverage, TileId, Tileset } from '@city-ink/tiles';
import type { Transform } from './transform.js';

export interface DesiredTile {
  key: string;
  id: TileId;
  level: number;
  /** Squared world distance from the camera, smaller loads first. */
  priority: number;
  sse: number;
}

export interface SelectionOptions {
  maximumScreenSpaceError: number;
  /** Extra screen margin around the viewport (fraction), for prefetch. */
  prefetchMargin: number;
  /** Hysteresis fraction applied to the refinement threshold for tiles already refined (prevents flicker). */
  hysteresis: number;
  /** Maximum visible distance in world units (fog limit). */
  maxDistance: number;
}

function pointInPolygon(x: number, z: number, poly: Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Vector3, b: Vector3, c: Vector3, d: Vector3): boolean {
  const o = (p: Vector3, q: Vector3, r: Vector3) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a),
    d2 = o(c, d, b),
    d3 = o(a, b, c),
    d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Axis-aligned world rectangle of a tile intersects the footprint polygon. */
export function rectIntersectsPolygon(rect: [number, number, number, number], poly: Vector3[]): boolean {
  const [x0, z0, x1, z1] = rect;
  if (poly.some((p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1)) return true;
  const corners = [new Vector3(x0, 0, z0), new Vector3(x1, 0, z0), new Vector3(x1, 0, z1), new Vector3(x0, 0, z1)];
  if (corners.some((c) => pointInPolygon(c.x, c.z, poly))) return true;
  for (let i = 0; i < poly.length; i++)
    for (let k = 0; k < 4; k++)
      if (segmentsIntersect(poly[i]!, poly[(i + 1) % poly.length]!, corners[k]!, corners[(k + 1) % 4]!)) return true;
  return false;
}

export function tileWorldRect(t: Transform, id: TileId): [number, number, number, number] {
  const [w, s, e, n] = tileToLngLatBounds(id);
  const a = t.lngLatToWorld([w, n]);
  const b = t.lngLatToWorld([e, s]);
  return [a.x, a.z, b.x, b.z];
}

/** Distance from the camera to the closest point of a tile (ground rectangle, given a height span). */
export function tileDistance(t: Transform, rect: [number, number, number, number], top = 0): number {
  const p = t.camera.position;
  const x = Math.max(rect[0], Math.min(rect[2], p.x));
  const z = Math.max(rect[1], Math.min(rect[3], p.z));
  const y = Math.max(0, Math.min(top, p.y));
  return Math.hypot(p.x - x, p.y - y, p.z - z);
}

/**
 * Chooses which tiles should be displayed. Walks the levels top-down: a tile is refined into its children at the
 * next level when its screen-space error exceeds the threshold and the children exist.
 */
export function selectTiles(
  t: Transform,
  tileset: Tileset,
  coverage: Coverage | null,
  options: SelectionOptions,
  refined: Set<string>,
): DesiredTile[] {
  const levels = [...tileset.levels].sort((a, b) => a.zoom - b.zoom);
  const root = levels[0]!;
  const footprint = t.groundFootprint(options.maxDistance, options.prefetchMargin);
  if (footprint.length < 3) return [];
  // candidate root tiles from the footprint bounds
  let w = Infinity,
    e = -Infinity,
    s = Infinity,
    n = -Infinity;
  for (const p of footprint) {
    const { lngLat } = t.worldToLngLat(p);
    w = Math.min(w, lngLat[0]);
    e = Math.max(e, lngLat[0]);
    s = Math.min(s, lngLat[1]);
    n = Math.max(n, lngLat[1]);
  }
  const [bw, bs, be, bn] = tileset.bounds;
  w = Math.max(w, bw);
  e = Math.min(e, be);
  s = Math.max(s, bs);
  n = Math.min(n, bn);
  if (!(w < e && s < n)) return [];
  const a = lngLatToTile(w, n, root.zoom);
  const b = lngLatToTile(e, s, root.zoom);
  const out: DesiredTile[] = [];
  const pixelsPerUnitAtDistance = t.height / (2 * Math.tan((t.fov * Math.PI) / 360));
  const visit = (id: TileId, levelIndex: number) => {
    const level = levels[levelIndex]!;
    if (coverage && !coverage.has(id)) return;
    const rect = tileWorldRect(t, id);
    if (!rectIntersectsPolygon(rect, footprint)) return;
    const distance = Math.max(1e-3, tileDistance(t, rect, 200));
    if (distance > options.maxDistance * 1.05) return;
    const sse = (level.geometricErrorMeters * pixelsPerUnitAtDistance) / distance;
    const key = tileKey(id);
    const next = levels[levelIndex + 1];
    const threshold = options.maximumScreenSpaceError * (refined.has(key) ? 1 - options.hysteresis : 1);
    if (next && sse > threshold) {
      const children = childTiles(id, next.zoom).filter((c) => !coverage || coverage.has(c));
      if (children.length) {
        refined.add(key);
        for (const c of children) visit(c, levelIndex + 1);
        return;
      }
    }
    refined.delete(key);
    const center = t.lngLatToWorld(tileCenterLngLat(id));
    out.push({ key, id, level: levelIndex, priority: center.distanceToSquared(t.camera.position), sse });
  };
  for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) visit({ z: root.zoom, x, y }, 0);
  out.sort((p, q) => p.priority - q.priority);
  return out;
}
