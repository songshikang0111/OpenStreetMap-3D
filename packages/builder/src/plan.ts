// Plan stage (03 sections 3-6): phase-one parsing and planning rules applied per planning cell with a buffer ring.
// Output records are JSON-serialisable and carry WGS84 geometry plus planned attributes and provenance.
import { planRoof } from '../../../src/roofs.js';
import { buildingStyle } from '../../../src/building-rules.js';
import { planRoadSurface } from '../../../src/road-surface.js';
import type { RoadSurfacePiece } from '../../../src/road-surface.js';
import { planStreetLife } from '../../../src/streetlife.js';
import type { Phase1Building, Phase1Data, Phase1Polygon, Point2 } from '../../../src/phase1-types.js';
import { phase1IdToFeatureId } from '@city-ink/generators';
import { tileToLngLatBounds, DEFAULT_KEPT_TAGS } from '@city-ink/tiles';
import type { Bounds, LngLat, Provenance, TileId } from '@city-ink/tiles';
import { boundsContains, boundsIntersect, expandBounds, ringBounds, toLngLat } from './geo.js';

/** Tags read by the phase-one building, roof and facade rules; kept so generators reproduce the same geometry. */
export const RULE_TAGS = [
  'building',
  'building:part',
  'building:material',
  'facade:material',
  'building:colour',
  'office',
  'amenity',
  'shop',
  'roof:shape',
  'roof:direction',
  'roof:orientation',
  'roof:height',
  'roof:levels',
  'roof:angle',
  'roof:colour',
  'roof:color',
];

export interface PlanOptions {
  seed: number;
  inferRoofs: boolean;
  ruleTrees: boolean;
  bufferMeters: number;
}

/** Linear height function of a graded surface, in project-local metres (phase-one roadHeightAt). */
export interface HeightFunction {
  a?: Point2;
  b?: Point2;
  yA?: number;
  yB?: number;
  y: number;
  offset: number;
}

export interface PlanRecord {
  layer: 'building' | 'road' | 'structure' | 'water' | 'green' | 'ground' | 'tree';
  id: string;
  /** Owner planning cell key (z/x/y), or "all" for a single global cell. */
  cell: string;
  /** Polygons: parts → rings → [lng, lat]. Lines: parts → [ring] → [lng, lat]. Points: [[[lng, lat]]]. */
  geometry: LngLat[][][];
  /** Per-vertex elevation for lines (same nesting as geometry). */
  elevation?: number[][][];
  /** Elevation function for graded polygons, evaluated after clipping. */
  height?: HeightFunction;
  anchor: LngLat;
  properties: Record<string, number | string | null>;
  provenance: Record<string, Provenance>;
  tags: Record<string, string>;
}

export interface CellPlan {
  cell: string;
  records: PlanRecord[];
  stats: Record<string, number>;
}

/** Phase-one heights are above a 0.45 m slab; tiles measure from the phase-two ground at y = 0. */
const GROUND = 0.45;

function keptTags(tags: Record<string, string>, extra: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...RULE_TAGS, ...DEFAULT_KEPT_TAGS, ...extra].sort())
    if (tags[k] !== undefined) out[k] = String(tags[k]);
  return out;
}

/** 52-bit FNV-style hash used for generated ids. */
export function hash52(text: string): number {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0) & 0xfffff) * 4294967296 + (h1 >>> 0);
}

function buildingProvenance(b: Phase1Building, roofSource: string | null): Record<string, Provenance> {
  const t = b.tags;
  const height: Provenance = b.source === 'height' ? 'observed' : b.source === 'levels' ? 'derived' : 'inferred';
  return {
    height,
    minHeight: t.min_height !== undefined ? 'observed' : t['building:min_level'] !== undefined ? 'derived' : 'inferred',
    levels: t['building:levels'] !== undefined ? 'observed' : height === 'inferred' ? 'inferred' : 'derived',
    roofShape: t['roof:shape'] !== undefined ? 'observed' : 'inferred',
    roofHeight: t['roof:height'] !== undefined ? 'observed' : roofSource === 'osm' ? 'derived' : 'inferred',
  };
}

interface Indexed<T> {
  item: T;
  bounds: Bounds;
}

/** Global, cell-independent view of the parsed input with WGS84 bounds per object. */
export class PlanContext {
  readonly buildings: Indexed<Phase1Building>[];
  readonly polygons: Indexed<Phase1Polygon>[];
  readonly water: Indexed<Phase1Polygon>[];
  readonly greens: Indexed<Phase1Polygon>[];
  readonly roads: Indexed<Phase1Data['roads'][number]>[];
  constructor(readonly data: Phase1Data) {
    const p = data.project;
    const polyBounds = (outer: Point2[]) => ringBounds(outer.map((q) => toLngLat(p, q)));
    this.buildings = data.buildings.map((item) => ({ item, bounds: polyBounds(item.outer) }));
    this.polygons = data.landscapes.map((item) => ({ item, bounds: polyBounds(item.outer) }));
    this.water = data.water.map((item) => ({ item, bounds: polyBounds(item.outer) }));
    this.greens = data.greens.map((item) => ({ item, bounds: polyBounds(item.outer) }));
    this.roads = data.roads.map((item) => ({
      item,
      bounds: ringBounds(item.segments.flat().map((q) => toLngLat(p, q))),
    }));
  }

  /** Phase-one data restricted to objects that intersect the bounds; global bounds and projection are kept. */
  crop(bounds: Bounds): Phase1Data {
    const pick = <T>(list: Indexed<T>[]) => list.filter((e) => boundsIntersect(e.bounds, bounds)).map((e) => e.item);
    const p = this.data.project;
    const inside = (q: Point2) => boundsContains(bounds, toLngLat(p, q));
    const landscapes = pick(this.polygons);
    // Street planting draws one random stream per road name (phase-one `avenue:<name>`), consumed across every way
    // sharing that name. Read the whole name group so the stream, and therefore every tree, is independent of the
    // cell boundaries (03 section 4.2: enlarge the read range instead of truncating).
    const roads = new Set(pick(this.roads));
    const names = new Set([...roads].map((r) => r.name).filter(Boolean));
    for (const r of this.data.roads) if (r.name && names.has(r.name)) roads.add(r);
    return {
      ...this.data,
      buildings: pick(this.buildings),
      roads: this.data.roads.filter((r) => roads.has(r)),
      water: pick(this.water),
      landscapes,
      greens: pick(this.greens),
      landscapeContexts: this.data.landscapeContexts.filter((l) => l.outer.some(inside)),
      trees: this.data.trees.filter((t) => inside(t.point)),
      streetNodes: this.data.streetNodes.filter((n) => inside(n.point)),
      treeRows: this.data.treeRows.filter((r) => r.points.some(inside)),
    };
  }
}

export function cellKey(cell: TileId | null): string {
  return cell ? `${cell.z}/${cell.x}/${cell.y}` : 'all';
}

/** Plans one cell. `cell = null` plans the whole input as one cell. */
export function planCell(ctx: PlanContext, cell: TileId | null, options: PlanOptions): CellPlan {
  const key = cellKey(cell);
  const project = ctx.data.project;
  const ll = (q: Point2) => toLngLat(project, q);
  const cellBounds: Bounds = cell ? tileToLngLatBounds(cell) : [-180, -85, 180, 85];
  const owns = (p: LngLat) => !cell || boundsContains(cellBounds, p);
  const data = cell ? ctx.crop(expandBounds(cellBounds, options.bufferMeters)) : ctx.data;
  const intersects = (b: Bounds) => !cell || boundsIntersect(b, cellBounds);
  const records: PlanRecord[] = [];
  const stats: Record<string, number> = {};
  const count = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

  // Buildings: owned by the cell containing the centre of their outline bounds.
  for (const b of data.buildings) {
    const anchor = ll(b.center);
    if (!owns(anchor)) continue;
    const roof = planRoof(b, { inferRoofs: options.inferRoofs });
    const style = buildingStyle(b, options.seed);
    records.push({
      layer: 'building',
      id: phase1IdToFeatureId(b.id),
      cell: key,
      geometry: [[b.outer.map(ll), ...b.holes.map((h) => h.map(ll))]],
      anchor,
      properties: {
        height: b.height,
        minHeight: b.minHeight,
        levels: b.levels,
        roofShape: roof.supported ? roof.shape : (b.tags['roof:shape'] ?? 'flat'),
        roofHeight: roof.supported ? Math.max(0, b.height + GROUND - roof.eave) : null,
        roofDirection:
          b.tags['roof:direction'] !== undefined ? Number.parseFloat(b.tags['roof:direction']) || null : null,
        facade: style.family,
        facadeSeed: options.seed,
        usage: b.tags.building ?? b.tags['building:part'] ?? null,
        partOf: null,
        materialHint: b.tags['building:material'] ?? null,
        colour: b.tags['building:colour'] ?? null,
        roofColour: b.tags['roof:colour'] ?? b.tags['roof:color'] ?? null,
        area: b.area,
      },
      provenance: buildingProvenance(b, roof.supported ? roof.source : null),
      tags: keptTags(b.tags, ['height', 'min_height', 'building:levels', 'building:min_level']),
    });
    count('buildings');
  }

  // Water and green polygons: clipped later to tile ∩ owner cell.
  const polygonRecord = (p: Phase1Polygon, layer: 'water' | 'green', id: string, kind: string) => {
    const rings = [p.outer.map(ll), ...p.holes.map((h) => h.map(ll))];
    if (!intersects(ringBounds(rings[0]!))) return;
    records.push({
      layer,
      id,
      cell: key,
      geometry: [rings],
      anchor: rings[0]![0]!,
      properties: { kind },
      provenance: {},
      tags: keptTags(p.tags ?? {}),
    });
    count(layer);
  };
  data.water.forEach((w) => {
    const source = (w.sourceIds?.[0] ?? w.id) as string;
    const m = /^(?:way\/|w)(\d+)/.exec(source) ?? /^(?:relation\/|r)(\d+)/.exec(source);
    const type = /^(?:relation\/|r)/.test(source) ? 'relation' : 'way';
    polygonRecord(w, 'water', `${type}/${m?.[1] ?? hash52(source)}#${hash52(String(w.id)) % 100000}`, 'water');
  });
  for (const l of data.landscapes) {
    const m = /^([wr])(\d+)(?:-(\d+))?(?::clip:(\d+))?/.exec(String(l.id));
    const seq = Number(m?.[3] ?? 0) * 1000 + Number(m?.[4] ?? 0);
    const id = m ? `${m[1] === 'w' ? 'way' : 'relation'}/${m[2]}#${seq}` : `generated/${hash52(String(l.id))}`;
    polygonRecord(l, 'green', id, String(l.kind ?? 'park'));
  }

  // Roads: graded centrelines, road and pavement surfaces, paint, bridge decks.
  const road = data.roads.length ? planRoadSurface(data) : null;
  if (road) {
    const segmentsByRoad = new Map<number, typeof road.grades.segments>();
    for (const s of road.grades.segments) {
      if (!segmentsByRoad.has(s.road.id)) segmentsByRoad.set(s.road.id, []);
      segmentsByRoad.get(s.road.id)!.push(s);
    }
    for (const [roadId, segments] of [...segmentsByRoad].sort((a, b) => a[0] - b[0])) {
      const r = segments[0]!.road;
      const geometry = segments.map((s) => [[ll(s.a), ll(s.b)]]);
      if (!geometry.some((g) => intersects(ringBounds(g[0]!)))) continue;
      const elevation = segments.map((s) => [[s.yA - GROUND, s.yB - GROUND]]);
      const t = r.tags;
      const properties = {
        class: r.type,
        width: r.width,
        lanes: Number(t.lanes) > 0 ? Math.round(Number(t.lanes)) : null,
        surface: t.surface ?? null,
        bridge: r.bridge ? 1 : 0,
        tunnel: 0,
        layer: r.layer,
        oneway: t.oneway === 'yes' ? 1 : 0,
      };
      const provenance: Record<string, Provenance> = {
        width: t.width !== undefined ? 'observed' : t.lanes !== undefined ? 'derived' : 'inferred',
        elevation: 'inferred',
      };
      records.push({
        layer: 'road',
        id: `way/${roadId}`,
        cell: key,
        geometry,
        elevation,
        anchor: geometry[0]![0]![0]!,
        properties,
        provenance,
        tags: keptTags(t),
      });
      count('roads');
      if (r.bridge) {
        records.push({
          layer: 'structure',
          id: `way/${roadId}#0`,
          cell: key,
          geometry,
          elevation: segments.map((s) => [[s.yA - GROUND - 0.05, s.yB - GROUND - 0.05]]),
          anchor: geometry[0]![0]![0]!,
          properties: { kind: 'deck', width: r.width + 1, thickness: 1.1, source: 'road-grade' },
          provenance: { elevation: 'inferred' },
          tags: {},
        });
        count('structures');
      }
    }
    const surfaceRecord = (s: RoadSurfacePiece, kind: string, n: number) => {
      const ring = s.polygon.map(ll);
      if (ring.length < 3 || !intersects(ringBounds(ring))) return;
      const height: HeightFunction = { y: s.y - GROUND, offset: Number(s.heightOffset ?? 0) };
      if (s.a && s.b && Number.isFinite(s.yA))
        Object.assign(height, { a: s.a, b: s.b, yA: s.yA! - GROUND, yB: s.yB! - GROUND });
      records.push({
        layer: 'ground',
        id: s.roadId ? `way/${s.roadId}#${n}` : `generated/${hash52(JSON.stringify(s.polygon[0]))}#${n}`,
        cell: key,
        geometry: [[ring]],
        height,
        anchor: ring[0]!,
        properties: { kind },
        provenance: {},
        tags: {},
      });
      count('groundPieces');
    };
    // Sequence numbers are derived from geometry so they do not depend on the cell's processing order.
    const seq = (s: RoadSurfacePiece) =>
      hash52(`${s.roadId}:${s.polygon.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(';')}`) % 1e9;
    for (const s of road.surfaces) surfaceRecord(s, s.kind === 'drive' || !s.kind ? 'drive' : String(s.kind), seq(s));
    for (const m of road.markings) surfaceRecord(m, 'marking', seq(m));
  }

  // Trees: observed nodes and rule-planted trees, owned by their position.
  if (options.ruleTrees || data.trees.length) {
    const life = planStreetLife(data, { seed: options.seed, maxTrees: 1e9, roadPlan: road });
    for (const t of life.trees) {
      if (!options.ruleTrees && t.source !== 'osm') continue;
      const anchor = ll([t.x, t.z]);
      if (!owns(anchor)) continue;
      const osm = /^osm:(\d+)$/.exec(t.key);
      records.push({
        layer: 'tree',
        id: osm ? `node/${osm[1]}` : `generated/${hash52(t.key)}`,
        cell: key,
        geometry: [[[anchor]]],
        anchor,
        properties: {
          shape: t.shape,
          height: t.h,
          crown: t.radius,
          leafType: /conifer|cypress/.test(t.shape) ? 'needleleaved' : 'broadleaved',
          species: null,
        },
        provenance: {
          position: osm ? 'observed' : 'inferred',
          height: osm ? 'observed' : 'inferred',
          shape: 'inferred',
        },
        tags: {},
      });
      count(osm ? 'treesObserved' : 'treesInferred');
    }
  }
  records.sort((a, b) => (a.layer + a.id < b.layer + b.id ? -1 : a.layer + a.id > b.layer + b.id ? 1 : 0));
  return { cell: key, records, stats };
}
