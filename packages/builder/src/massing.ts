// Level-zero building aggregates are constructed on the same integer grid used by the tile codec.
import clipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { gridStepMeters, lngLatToTile, tileKey } from '@city-ink/tiles';
import type { LngLat, Provenance, TileFeature, TileId } from '@city-ink/tiles';
import { gridToTile, toGrid } from './geo.js';
import type { G } from './clip.js';
import { ringArea, simplifyRing } from './clip.js';
import { hash52 } from './plan.js';
import type { PlanRecord } from './plan.js';

/** Regular metric cells anchored to the NW corner, using the tile's one latitude scale throughout. */
export function metricCell(anchor: LngLat, tile: TileId, e: number, meters: number) {
  const g = toGrid(anchor, tile.z, e);
  const extent = 2 ** e;
  const size = meters / gridStepMeters(tile, e);
  const x = Math.floor((g[0] - tile.x * extent) / size);
  const y = Math.floor((g[1] - tile.y * extent) / size);
  const center = (index: number) => (index * size + Math.min((index + 1) * size, extent)) / 2;
  return { key: `${tileKey(tile)}:${x}:${y}`, center: [tile.x * extent + center(x), tile.y * extent + center(y)] as G };
}

function footprint(r: PlanRecord, tile: TileId, e: number): MultiPolygon {
  return r.geometry.map((poly) => poly.map((ring) => ring.map((p) => gridToTile(toGrid(p, tile.z, e), tile, e))));
}

/** Polygon-clipping emits closed rings. Quantize intersections and discard collapsed rings without promoting a hole. */
function geometry(polys: MultiPolygon): number[][][] {
  const parts: number[][][] = [];
  for (const poly of polys) {
    const rings: number[][] = [];
    for (const [index, ring] of poly.entries()) {
      const points: G[] = [];
      for (const [x, y] of ring) {
        const p: G = [Math.round(x), Math.round(y)];
        if (!points.length || points.at(-1)![0] !== p[0] || points.at(-1)![1] !== p[1]) points.push(p);
      }
      if (points.length && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1]) points.pop();
      if (points.length < 3 || Math.abs(ringArea(points)) < 0.5) {
        if (index === 0) break;
      } else rings.push(points.flat());
    }
    if (rings.length) parts.push(rings);
  }
  return parts;
}

interface Solid {
  polygon: MultiPolygon;
  bottom: number;
  top: number;
  record: PlanRecord;
}

function union(polygons: MultiPolygon[]): MultiPolygon {
  return polygons.length ? clipping.union(polygons[0]!, ...polygons.slice(1)) : [];
}

/** Prefer cuts at large changes in cross section. Distinct source limits stay exact when at most three slabs suffice. */
function tierBounds(solids: Solid[]) {
  const weights = new Map<number, number>();
  for (const solid of solids) {
    const area = solid.polygon.reduce(
      (sum, [outer, ...holes]) =>
        sum + Math.abs(ringArea(outer!)) - holes.reduce((s, ring) => s + Math.abs(ringArea(ring)), 0),
      0,
    );
    for (const h of [solid.bottom, solid.top]) weights.set(h, (weights.get(h) ?? 0) + area);
  }
  const heights = [...weights.keys()].sort((a, b) => a - b);
  if (heights.length <= 4) return heights;
  // Preserve the highest silhouette (including an elevated tower base). Spend the remaining
  // boundary on the largest footprint change below it, with a stable tie break.
  const shoulder = heights.at(-2)!;
  const middle = heights.slice(1, -2).sort((a, b) => weights.get(b)! - weights.get(a)! || a - b)[0]!;
  return [heights[0]!, middle, shoulder, heights.at(-1)!];
}

interface Mass {
  tile: TileId;
  feature: TileFeature;
}

// An exact surviving source boundary keeps its confidence. Extending a shorter prism to a common
// height (or lowering an elevated base) makes that aggregate boundary inferred.
function boundarySource(solids: Solid[], field: 'top' | 'bottom', limit: number): Provenance {
  const key = field === 'top' ? 'height' : 'minHeight';
  if (solids.some((s) => (field === 'top' ? s.top < limit : s.bottom > limit))) return 'inferred';
  const sources = solids.filter((s) => s[field] === limit).map((s) => s.record.provenance[key] ?? 'inferred');
  if (!sources.length) return 'derived';
  if (sources.includes('inferred')) return 'inferred';
  return sources.includes('derived') ? 'derived' : 'observed';
}

function aggregate(
  id: string,
  parent: string | null,
  parts: MultiPolygon,
  bottom: number,
  top: number,
  solids: Solid[],
): TileFeature {
  return {
    id,
    renderId: 0,
    geometry: geometry(parts),
    properties: { height: top, minHeight: bottom, partOf: parent, roofShape: 'flat' },
    provenance: {
      height: boundarySource(solids, 'top', top),
      minHeight: boundarySource(solids, 'bottom', bottom),
      roofShape: 'inferred',
      ...(parent
        ? { partOf: solids.every((s) => s.record.provenance.partOf === 'observed') ? 'observed' : 'derived' }
        : {}),
    },
    tags: {},
  };
}

function individual(r: PlanRecord, tile: TileId, e: number): TileFeature {
  const tolerance = 2 / gridStepMeters(tile, e);
  const polygons = footprint(r, tile, e).map((poly) => simplifyFootprint(poly, tolerance));
  return {
    id: r.id,
    renderId: 0,
    geometry: geometry(polygons),
    properties: {
      ...r.properties,
      facade: null,
      facadeSeed: null,
      roofShape: 'flat',
      roofHeight: null,
      roofDirection: null,
    },
    provenance: {
      ...r.provenance,
      roofShape: r.properties.roofShape === 'flat' ? (r.provenance.roofShape ?? 'inferred') : 'inferred',
    },
    tags: r.tags,
  };
}

// Keep courtyards inside the simplified shell. A narrow cutout can otherwise cross a new
// Douglas–Peucker chord even when the rings themselves still have three distinct vertices.
function simplifyFootprint(poly: G[][], tolerance: number) {
  const simplified = poly.map((ring) => simplifyRing(ring, tolerance));
  if (poly.length > 1 && simplified.slice(1).some((hole) => clipping.difference([hole], [simplified[0]!]).length))
    return poly;
  return simplified;
}

export function* massingBuildings(records: PlanRecord[], z: number, e: number): Generator<Mass> {
  const compounds = new Map<string, PlanRecord[]>();
  const blocks = new Map<string, PlanRecord[]>();
  for (const r of records) {
    if (r.layer !== 'building') continue;
    const tile = lngLatToTile(...r.anchor, z);
    if (r.compoundId) {
      const group = compounds.get(r.compoundId) ?? [];
      group.push(r);
      compounds.set(r.compoundId, group);
    } else if (Number(r.properties.area) < 30 && Number(r.properties.height) < 6 && r.properties.area != null) {
      const key = metricCell(r.anchor, tile, e, 50).key;
      const group = blocks.get(key) ?? [];
      group.push(r);
      blocks.set(key, group);
    } else {
      yield { tile, feature: individual(r, tile, e) };
    }
  }
  const byId = (a: PlanRecord, b: PlanRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const solid = (r: PlanRecord, tile: TileId): Solid => ({
    polygon: footprint(r, tile, e),
    bottom: Number(r.properties.minHeight),
    top: Number(r.properties.height),
    record: r,
  });
  for (const [key, members] of blocks) {
    members.sort(byId);
    const tile = lngLatToTile(...members[0]!.anchor, z);
    if (members.length === 1) {
      yield { tile, feature: individual(members[0]!, tile, e) };
      continue;
    }
    const solids = members.map((r) => solid(r, tile));
    const top = solids.reduce((max, s) => Math.max(max, s.top), -Infinity);
    const bottom = solids.reduce((min, s) => Math.min(min, s.bottom), Infinity);
    const merged = union(solids.map((s) => s.polygon));
    yield { tile, feature: aggregate(`generated/${hash52('building:' + key)}`, null, merged, bottom, top, solids) };
  }
  for (const [parent, members] of compounds) {
    members.sort(byId);
    const tile = lngLatToTile(...members[0]!.anchor, z);
    const tolerance = 2 / gridStepMeters(tile, e);
    const parts = members.filter((r) => r.properties.partOf === parent);
    const outlines = members.filter((r) => r.properties.partOf !== parent);
    const solids = parts.map((r) => solid(r, tile));
    // Keep only uncovered outline geometry; an outline height is commonly the height of its tallest tower.
    const partsUnion = union(solids.map((s) => s.polygon));
    for (const outline of outlines) {
      const s = solid(outline, tile);
      s.polygon = partsUnion.length ? clipping.difference(s.polygon, partsUnion) : s.polygon;
      if (s.polygon.length) solids.push(s);
    }
    const bounds = tierBounds(solids);
    for (let i = 1; i < bounds.length; i++) {
      const bottom = bounds[i - 1]!,
        top = bounds[i]!;
      const covered = solids.filter((s) => s.bottom < top && s.top > bottom);
      if (!covered.length) continue;
      const polygons = union(covered.map((s) => s.polygon)).map((poly) =>
        simplifyFootprint(
          poly.map((ring) => ring.slice(0, -1)),
          tolerance,
        ),
      );
      yield {
        tile,
        feature: aggregate(
          `${parent.includes('#') ? `generated/${hash52(parent)}` : parent}#${i - 1}`,
          parent,
          polygons,
          bottom,
          top,
          covered,
        ),
      };
    }
  }
}
