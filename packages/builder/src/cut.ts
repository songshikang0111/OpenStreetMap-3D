// Cut stage (03 section 5): ownership, clipping and quantisation of plan records into per-tile layers.
import {
  LAYER_SCHEMAS,
  defaultExtentLog2,
  lngLatToTile,
  tileKey,
  tileToLngLatBounds,
  fitsInt16,
} from '@city-ink/tiles';
import type {
  Diagnostic,
  FeatureLayerInput,
  LngLat,
  MeshLayerInput,
  TileFeature,
  TileId,
  TileInput,
} from '@city-ink/tiles';
import { lngLatToTileMeters } from '@city-ink/tiles';
import type { Phase1Data, Point2 } from '../../../src/phase1-types.js';
import { clipRing, clipSegment, ringArea, simplifyRing } from './clip.js';
import type { G, Rect } from './clip.js';
import { fromGrid, gridToTile, tileGridRect, toGrid, toLocal } from './geo.js';
import type { HeightFunction, PlanRecord } from './plan.js';
import { hash52 } from './plan.js';
import { mergeFlatGround } from './ground.js';

export interface LevelSpec {
  id: string;
  zoom: number;
  profile: 'massing' | 'full';
}

export interface CutResult {
  tiles: Map<string, TileInput>;
  diagnostics: Diagnostic[];
  fallbacks: { id: string; tile: string; reason: string }[];
}

const MASSING_ROADS = /^(motorway|trunk|primary|secondary)(_link)?$/;

function parseKey(key: string): TileId | null {
  if (key === 'all') return null;
  const [z, x, y] = key.split('/').map(Number);
  return { z: z!, x: x!, y: y! };
}

/** Rectangle of a tile in the grid of zoom z (works for coarser and finer cells). */
function rectAt(cell: TileId, z: number, extentLog2: number): Rect {
  const scale = 2 ** (z - cell.z + extentLog2);
  return [cell.x * scale, cell.y * scale, (cell.x + 1) * scale, (cell.y + 1) * scale];
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const r: Rect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
}

function heightAt(h: HeightFunction, p: Point2): number {
  if (!h.a || !h.b || !Number.isFinite(h.yA)) return h.y + h.offset;
  const dx = h.b[0] - h.a[0],
    dz = h.b[1] - h.a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - h.a[0]) * dx + (p[1] - h.a[1]) * dz) / len2));
  return h.yA! + (h.yB! - h.yA!) * t + h.offset;
}

function emptyLayers(profile: 'massing' | 'full'): Record<string, FeatureLayerInput> {
  const names =
    profile === 'full'
      ? ['building', 'buildingContext', 'road', 'structure', 'water', 'green', 'ground', 'tree', 'detail', 'landscape']
      : ['building', 'road', 'water', 'green', 'treeDensity'];
  const out: Record<string, FeatureLayerInput> = {};
  for (const name of names) {
    const schema = LAYER_SCHEMAS[name === 'buildingContext' ? 'building' : name]!;
    out[name] = {
      type: 'features',
      geometry: schema.geometry,
      elevation: schema.elevation,
      attributes: name.startsWith('building')
        ? [...schema.attributes, { name: 'area', type: 'f32' }]
        : [...schema.attributes],
      provenanceKeys: [...schema.provenance],
      features: [],
    };
  }
  return out;
}

export interface CutOptions {
  levels: LevelSpec[];
  /** Restrict output to these tile keys (used by incremental and resumed builds). */
  only?: Set<string>;
  data: Phase1Data;
}

/**
 * Builds every tile of every level from the plan records of all cells. Pure and order-independent: records are
 * processed in sorted order and features are sorted by id inside each layer.
 */
export function cutTiles(records: PlanRecord[], options: CutOptions): CutResult {
  const tiles = new Map<string, TileInput>();
  const diagnostics: Diagnostic[] = [];
  const fallbacks: CutResult['fallbacks'] = [];
  const project = options.data.project;
  const tileOf = (id: TileId, profile: 'massing' | 'full') => {
    const key = tileKey(id);
    let t = tiles.get(key);
    if (!t) {
      t = { id, profile, extentLog2: defaultExtentLog2(id.z), layers: emptyLayers(profile) };
      tiles.set(key, t);
    }
    return t;
  };
  const push = (t: TileInput, layer: string, f: TileFeature) => (t.layers[layer] as FeatureLayerInput).features.push(f);

  for (const level of options.levels) {
    const z = level.zoom;
    const e = defaultExtentLog2(z);
    const full = level.profile === 'full';
    const wanted = (id: TileId) => !options.only || options.only.has(tileKey(id));
    const smallBlocks = new Map<string, { tile: TileId; rings: G[][]; height: number; ids: string[] }>();

    for (const r of records) {
      if (!full && (r.layer === 'ground' || r.layer === 'structure' || r.layer === 'detail' || r.layer === 'landscape'))
        continue;
      if (!full && r.layer === 'road' && !MASSING_ROADS.test(String(r.properties.class))) continue;
      const base: Omit<TileFeature, 'geometry'> = {
        id: r.id,
        renderId: 0,
        properties: r.properties,
        provenance: r.provenance,
        tags: r.tags,
      };

      if (r.layer === 'landmark') {
        if (!full || !r.mesh) continue;
        const id = lngLatToTile(r.anchor[0], r.anchor[1], z);
        if (!wanted(id)) continue;
        appendLandmark(tileOf(id, level.profile), r, project);
        continue;
      }
      if (full && r.layer === 'building' && r.properties.landmark === 'claimed') continue;
      if (r.layer === 'detail') {
        const id = lngLatToTile(r.anchor[0], r.anchor[1], z);
        if (!wanted(id)) continue;
        push(tileOf(id, level.profile), 'detail', { ...base, geometry: [[gridToTile(toGrid(r.anchor, z, e), id, e)]] });
        continue;
      }
      if (r.layer === 'building' || r.layer === 'tree') {
        const id = lngLatToTile(r.anchor[0], r.anchor[1], z);
        if (!wanted(id)) continue;
        const t = tileOf(id, level.profile);
        if (r.layer === 'tree') {
          if (!full) continue; // L0 trees become density cells below
          const q = gridToTile(toGrid(r.anchor, z, e), id, e);
          push(t, 'tree', { ...base, geometry: [[q]] });
          continue;
        }
        const tol = full ? 0 : 2 / (2 ** -(z + e) * 40075016.686 * Math.cos((r.anchor[1] * Math.PI) / 180));
        let rings = r.geometry[0]!.map((ring) => ring.map((p) => toGrid(p, z, e)));
        if (!full) {
          const area =
            Math.abs(ringArea(rings[0]!)) *
            (2 ** -(z + e) * 40075016.686 * Math.cos((r.anchor[1] * Math.PI) / 180)) ** 2;
          if (area < 30 && Number(r.properties.height) < 6) {
            // Small low buildings are merged per 50 m block cell (02 section 2).
            const cellSize = 50 / (2 ** -(z + e) * 40075016.686 * Math.cos((r.anchor[1] * Math.PI) / 180));
            const c = toGrid(r.anchor, z, e);
            const k = `${tileKey(id)}:${Math.floor(c[0] / cellSize)}:${Math.floor(c[1] / cellSize)}`;
            const block = smallBlocks.get(k) ?? { tile: id, rings: [], height: 0, ids: [] };
            block.rings.push(rings[0]!);
            block.height = Math.max(block.height, Number(r.properties.height));
            block.ids.push(r.id);
            smallBlocks.set(k, block);
            continue;
          }
          rings = rings.map((ring) => simplifyRing(ring, tol));
        }
        const q = rings.map((ring) => ring.flatMap((p) => gridToTile(p, id, e)));
        if (q.some((ring) => ring.some((v) => !fitsInt16(v)))) {
          diagnostics.push({
            code: 'TILE_COORD_RANGE',
            stage: 'cut',
            message: `${r.id} extends beyond the int16 range of tile ${tileKey(id)}.`,
            featureId: r.id,
            tileId: tileKey(id),
            hint: 'The object is listed in the build report and omitted from this level.',
          });
          fallbacks.push({ id: r.id, tile: tileKey(id), reason: 'coordinate range' });
          continue;
        }
        const props = full
          ? r.properties
          : {
              ...r.properties,
              facade: null,
              facadeSeed: null,
              roofShape: 'flat',
              roofHeight: null,
              roofDirection: null,
            };
        push(t, 'building', { ...base, properties: props, geometry: [q] });
        continue;
      }

      // Piers and stair flights are owned by one tile (anchor) and kept whole, like buildings.
      if (r.layer === 'structure' && (r.properties.kind === 'pier' || r.properties.kind === 'stairs')) {
        const id = lngLatToTile(r.anchor[0], r.anchor[1], z);
        if (!wanted(id)) continue;
        const q = r.geometry.map((part) => part.map((ring) => ring.flatMap((p) => gridToTile(toGrid(p, z, e), id, e))));
        if (q.some((part) => part.some((ring) => ring.some((v) => !fitsInt16(v))))) {
          fallbacks.push({ id: r.id, tile: tileKey(id), reason: 'coordinate range' });
          continue;
        }
        push(tileOf(id, level.profile), 'structure', { ...base, geometry: q, elevation: r.elevation! });
        continue;
      }

      // Clipped layers: polygons and lines, restricted to tile ∩ owner cell.
      const owner = parseKey(r.cell);
      const allPoints = r.geometry.flat(2);
      const grid = allPoints.map((p) => toGrid(p, z, e));
      const xs = grid.map((g) => g[0]),
        ys = grid.map((g) => g[1]);
      const span = 2 ** e;
      const tx0 = Math.floor(Math.min(...xs) / span),
        tx1 = Math.floor(Math.max(...xs) / span),
        ty0 = Math.floor(Math.min(...ys) / span),
        ty1 = Math.floor(Math.max(...ys) / span);
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const id = { z, x: tx, y: ty };
          if (!wanted(id)) continue;
          const rect = owner ? intersectRect(tileGridRect(id, e), rectAt(owner, z, e)) : tileGridRect(id, e);
          if (!rect) continue;
          if (r.layer === 'road' || r.layer === 'structure') {
            const parts: number[][][] = [];
            const elevation: number[][][] = [];
            r.geometry.forEach((part, pi) => {
              const line = part[0]!;
              const ys = r.elevation?.[pi]?.[0] ?? line.map(() => 0);
              let current: number[] | null = null;
              let currentE: number[] = [];
              for (let v = 0; v + 1 < line.length; v++) {
                const a = toGrid(line[v]!, z, e),
                  b = toGrid(line[v + 1]!, z, e);
                const c = clipSegment(a, b, rect);
                if (!c) {
                  current = null;
                  continue;
                }
                const ya = ys[v]! + (ys[v + 1]! - ys[v]!) * c.ta,
                  yb = ys[v]! + (ys[v + 1]! - ys[v]!) * c.tb;
                const qa = gridToTile(c.a, id, e),
                  qb = gridToTile(c.b, id, e);
                if (current && current[current.length - 2] === qa[0] && current[current.length - 1] === qa[1]) {
                  current.push(...qb);
                  currentE.push(full ? yb : 0);
                } else {
                  current = [...qa, ...qb];
                  currentE = full ? [ya, yb] : [0, 0];
                  parts.push([current]);
                  elevation.push([currentE]);
                }
              }
            });
            const kept = parts
              .map((p, i) => [p, elevation[i]!] as const)
              .filter(
                ([p]) => p[0]!.length >= 4 && !(p[0]!.length === 4 && p[0]![0] === p[0]![2] && p[0]![1] === p[0]![3]),
              );
            if (!kept.length) continue;
            const t = tileOf(id, level.profile);
            const props = full ? r.properties : { ...r.properties, bridge: 0, layer: 0 };
            push(t, r.layer, {
              ...base,
              properties: props,
              geometry: kept.map(([p]) => p),
              elevation: kept.map(([, el]) => el),
            });
            continue;
          }
          // polygons
          const out: number[][][] = [];
          const heights: number[][][] = [];
          for (const part of r.geometry) {
            const rings: number[][] = [];
            const ringHeights: number[][] = [];
            for (const [k, ring] of part.entries()) {
              let clipped = clipRing(
                ring.map((p) => toGrid(p, z, e)),
                rect,
              );
              if (!full)
                clipped = simplifyRing(
                  clipped,
                  2 / (2 ** -(z + e) * 40075016.686 * Math.cos((r.anchor[1] * Math.PI) / 180)),
                );
              const dedup: number[][] = [];
              const dedupG: G[] = [];
              for (const g of clipped) {
                const p = gridToTile(g, id, e);
                const last = dedup.at(-1);
                if (last && last[0] === p[0] && last[1] === p[1]) continue;
                dedup.push(p);
                dedupG.push(g);
              }
              if (dedup.length > 1 && dedup[0]![0] === dedup.at(-1)![0] && dedup[0]![1] === dedup.at(-1)![1]) {
                dedup.pop();
                dedupG.pop();
              }
              if (dedup.length < 3 || Math.abs(ringArea(dedup as G[])) < 0.5) {
                if (k === 0) break;
                continue;
              }
              rings.push(dedup.flat());
              const h = r.height;
              ringHeights.push(
                r.layer === 'ground' && h
                  ? dedupG.map((g) => heightAt(h, toLocal(project, fromGrid(g, z, e))))
                  : dedup.map(() => 0),
              );
            }
            if (rings.length) {
              out.push(rings);
              heights.push(ringHeights);
            }
          }
          if (!out.length) continue;
          const t = tileOf(id, level.profile);
          const f: TileFeature = { ...base, geometry: out };
          if (r.layer === 'ground') f.elevation = heights;
          push(t, r.layer, f);
        }
    }

    // L0 small-building blocks: one low prism per block cell (bounding union of the members).
    for (const [k, block] of [...smallBlocks].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const t = tileOf(block.tile, level.profile);
      for (const [i, ring] of block.rings.entries()) {
        const q = ring.flatMap((p) => gridToTile(p, block.tile, e));
        if (q.some((v) => !fitsInt16(v))) continue;
        push(t, 'building', {
          id: `generated/${hash52(k)}#${i}`,
          renderId: 0,
          geometry: [[q]],
          properties: { height: block.height, minHeight: 0, levels: 1, roofShape: 'flat' },
          provenance: { height: 'inferred' },
          tags: {},
        });
      }
    }

    // L0 tree density on a 100 m grid.
    if (!full) {
      const cells = new Map<string, { tile: TileId; g: G; n: number }>();
      for (const r of records) {
        if (r.layer !== 'tree') continue;
        const id = lngLatToTile(r.anchor[0], r.anchor[1], z);
        if (!wanted(id)) continue;
        const metersPerGrid = 2 ** -(z + e) * 40075016.686 * Math.cos((r.anchor[1] * Math.PI) / 180);
        const size = 100 / metersPerGrid;
        const g = toGrid(r.anchor, z, e);
        const cx = (Math.floor(g[0] / size) + 0.5) * size,
          cy = (Math.floor(g[1] / size) + 0.5) * size;
        const key = `${tileKey(id)}:${Math.floor(g[0] / size)}:${Math.floor(g[1] / size)}`;
        const c = cells.get(key) ?? { tile: id, g: [cx, cy], n: 0 };
        c.n++;
        cells.set(key, c);
      }
      for (const [key, c] of [...cells].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const t = tileOf(c.tile, level.profile);
        push(t, 'treeDensity', {
          id: `generated/${hash52(key)}`,
          renderId: 0,
          geometry: [[gridToTile(c.g, c.tile, e)]],
          properties: { density: c.n, cellSize: 100 },
          provenance: {},
          tags: {},
        });
      }
    }
  }

  // Flat ground fragments of the same kind and elevation are unioned per tile (phase-one road planning emits one
  // fragment per segment; tens of thousands per tile otherwise dominate the tile size).
  for (const t of tiles.values()) mergeFlatGround(t);

  // Building context: neighbours owned by other tiles whose bounds touch a tile building (full profile only).
  addBuildingContext(tiles, records, options);

  // Deterministic order and renderIds (1..n across layers in name order).
  for (const t of tiles.values()) {
    let renderId = 1;
    for (const name of Object.keys(t.layers).sort()) {
      const layer = t.layers[name] as FeatureLayerInput;
      if ((t.layers[name] as { type: string }).type === 'mesh') {
        for (const f of (t.layers[name] as MeshLayerInput).features) f.renderId = renderId++;
        continue;
      }
      layer.features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      mergeDuplicateIds(layer);
      for (const f of layer.features) f.renderId = renderId++;
      if (!layer.features.length) delete t.layers[name];
    }
  }
  return { tiles, diagnostics, fallbacks };
}

/** Features of the same id in one tile (e.g. a road clipped by two owner cells) become one multi-part feature. */
function mergeDuplicateIds(layer: FeatureLayerInput) {
  const out: TileFeature[] = [];
  for (const f of layer.features) {
    const prev = out.at(-1);
    if (prev && prev.id === f.id) {
      prev.geometry.push(...f.geometry);
      if (prev.elevation && f.elevation) prev.elevation.push(...f.elevation);
    } else out.push({ ...f, geometry: [...f.geometry], ...(f.elevation ? { elevation: [...f.elevation] } : {}) });
  }
  layer.features = out;
}

function addBuildingContext(tiles: Map<string, TileInput>, records: PlanRecord[], options: CutOptions) {
  const full = options.levels.find((l) => l.profile === 'full');
  if (!full) return;
  const z = full.zoom;
  const e = defaultExtentLog2(z);
  const buildings = records.filter((r) => r.layer === 'building' && r.properties.landmark !== 'claimed');
  const boxes = buildings.map((r) => {
    const g = r.geometry[0]![0]!.map((p) => toGrid(p, z, e));
    const xs = g.map((p) => p[0]),
      ys = g.map((p) => p[1]);
    return {
      r,
      owner: tileKey(lngLatToTile(r.anchor[0], r.anchor[1], z)),
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as Rect,
    };
  });
  const bucket = 2 ** (e - 3);
  const index = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let x = Math.floor(b.box[0] / bucket); x <= Math.floor(b.box[2] / bucket); x++)
      for (let y = Math.floor(b.box[1] / bucket); y <= Math.floor(b.box[3] / bucket); y++) {
        const k = `${x},${y}`;
        if (!index.has(k)) index.set(k, []);
        index.get(k)!.push(i);
      }
  });
  const touch = (a: Rect, b: Rect) => a[0] <= b[2] + 1 && a[2] >= b[0] - 1 && a[1] <= b[3] + 1 && a[3] >= b[1] - 1;
  const context = new Map<string, Set<number>>();
  boxes.forEach((b) => {
    const tile = tiles.get(b.owner);
    if (!tile || tile.profile !== 'full') return;
    for (let x = Math.floor(b.box[0] / bucket); x <= Math.floor(b.box[2] / bucket); x++)
      for (let y = Math.floor(b.box[1] / bucket); y <= Math.floor(b.box[3] / bucket); y++)
        for (const j of index.get(`${x},${y}`) ?? []) {
          const n = boxes[j]!;
          if (n.owner === b.owner || !touch(b.box, n.box)) continue;
          if (!context.has(b.owner)) context.set(b.owner, new Set());
          context.get(b.owner)!.add(j);
        }
  });
  for (const [key, set] of context) {
    const t = tiles.get(key)!;
    for (const j of [...set].sort((a, b) => a - b)) {
      const { r } = boxes[j]!;
      const q = r.geometry[0]!.map((ring) => ring.flatMap((p) => gridToTile(toGrid(p, z, e), t.id, e)));
      if (q.some((ring) => ring.some((v) => !fitsInt16(v)))) continue;
      (t.layers.buildingContext as FeatureLayerInput).features.push({
        id: r.id,
        renderId: 0,
        geometry: [q],
        properties: {
          height: r.properties.height ?? null,
          minHeight: r.properties.minHeight ?? null,
          levels: r.properties.levels ?? null,
          area: r.properties.area ?? null,
        },
        provenance: { height: r.provenance.height ?? 'inferred' },
        tags: r.tags,
      });
    }
  }
}

export function levelTileKeys(tiles: Map<string, TileInput>): string[] {
  return [...tiles.keys()].sort();
}

export { tileToLngLatBounds };
export type { LngLat };

/** Appends a baked landmark group to the tile's `landmark` mesh layer, converting project metres to tile metres. */
function appendLandmark(t: TileInput, r: PlanRecord, project: Phase1Data['project']) {
  const bake = r.mesh!;
  let layer = t.layers.landmark as MeshLayerInput | undefined;
  if (!layer) {
    layer = {
      type: 'mesh',
      position: [],
      normal: [],
      index: [],
      vertexFeature: [],
      submeshes: [],
      vertexAttributes: { color: { itemSize: 3, array: [] } },
      attributes: [
        { name: 'recipe', type: 'string' },
        { name: 'recipeVersion', type: 'string' },
      ],
      features: [],
    };
    t.layers.landmark = layer;
  }
  const position = layer.position as number[];
  const normal = layer.normal as number[];
  const index = layer.index as number[];
  const vertexFeature = layer.vertexFeature as number[];
  const color = layer.vertexAttributes!.color!.array as number[];
  const featureBase = layer.features.length;
  for (const id of bake.featureIds)
    layer.features.push({ id, renderId: 0, properties: { recipe: bake.recipeId, recipeVersion: bake.recipeVersion } });
  for (const m of bake.meshes) {
    const vertexBase = position.length / 3;
    for (let v = 0; v < m.position.length; v += 3) {
      const [lat, lon] = project.inverse([m.position[v]!, m.position[v + 2]!]);
      const [x, z] = lngLatToTileMeters(t.id, [lon, lat]);
      position.push(x, m.position[v + 1]!, z);
      normal.push(m.normal[v]!, m.normal[v + 1]!, m.normal[v + 2]!);
      color.push(m.color[v]!, m.color[v + 1]!, m.color[v + 2]!);
      vertexFeature.push(featureBase + m.featureIndex);
    }
    const indexStart = index.length;
    for (const i of m.index) index.push(vertexBase + i);
    layer.submeshes.push({
      materialRole: 'landmark',
      featureIndex: featureBase + m.featureIndex,
      indexStart,
      indexCount: m.index.length,
    });
  }
}
