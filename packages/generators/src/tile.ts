// Tile-level generation: decoded tile in, role-batched typed arrays out. Runs unchanged in Node and in a Worker.
import { gridStepMeters } from '@city-ink/tiles';
import type { DecodedTile, FeatureLayer, MeshLayer } from '@city-ink/tiles';
import { BatchSet, triangleCount } from './batch.js';
import type { MeshBatch } from './batch.js';
import { generateBuildings } from './building.js';
import type { BuildingOptions, NearWall } from './building.js';
import { generateBands, generateMassing, generatePolygons } from './surfaces.js';
import { generateStructures } from './structures.js';

export const GENERATOR_VERSION = '2.0.0';

export const TREE_SHAPES = ['round', 'spreading', 'columnar', 'conifer', 'cypress', 'palm', 'weeping'] as const;
export const TREE_STRIDE = 6;

export interface TreeInstances {
  /** [x, y, z, height, crown radius, shape code] per tree, tile metres. */
  data: Float32Array;
  renderId: Float32Array;
  count: number;
}

export interface GeneratedTile {
  batches: MeshBatch[];
  trees: TreeInstances;
  /** Complete facade walls for near-camera details (only with `collectNearWalls`). */
  nearWalls?: NearWall[];
  stats: {
    triangles: number;
    vertices: number;
    drawCalls: number;
    buildings: number;
    trees: number;
    msByLayer: Record<string, number>;
  };
}

export interface GenerateOptions extends BuildingOptions {
  /** Restrict to these layers (default: all known layers). */
  layers?: string[];
  /** Generators of optional layers (e.g. @city-ink/details for `detail` and `landscape`). Unknown layers are skipped. */
  layerGenerators?: Record<string, (layer: FeatureLayer, step: number, batches: BatchSet) => number>;
}

function generateTrees(layer: FeatureLayer, step: number): TreeInstances {
  const col = (name: string) => layer.attributes.find((a) => a.name === name);
  const height = col('height');
  const crown = col('crown');
  const shape = col('shape');
  const data = new Float32Array(layer.featureCount * TREE_STRIDE);
  const renderId = new Float32Array(layer.featureCount);
  for (let i = 0; i < layer.featureCount; i++) {
    const v = layer.vertexStart[layer.ringStart[layer.partStart[i]!]!]!;
    const h = Number(height?.values[i]);
    const c = Number(crown?.values[i]);
    const s = shape ? shape.values[i]! : 0xffffffff;
    const shapeName = s === 0xffffffff ? 'round' : layer.strings[s]!;
    const o = i * TREE_STRIDE;
    data[o] = layer.positions[v * 2]! * step;
    data[o + 1] = 0;
    data[o + 2] = layer.positions[v * 2 + 1]! * step;
    data[o + 3] = Number.isFinite(h) ? h : 8;
    data[o + 4] = Number.isFinite(c) ? c : 3;
    data[o + 5] = Math.max(0, TREE_SHAPES.indexOf(shapeName as (typeof TREE_SHAPES)[number]));
    renderId[i] = layer.renderId[i]!;
  }
  return { data, renderId, count: layer.featureCount };
}

function meshBatches(layer: MeshLayer, name: string, batches: BatchSet): number {
  let triangles = 0;
  const fallback = [0.86, 0.85, 0.82];
  const colors = layer.vertexAttributes.color?.itemSize === 3 ? layer.vertexAttributes.color.array : null;
  for (const sub of layer.submeshes) {
    const b = batches.get(name, sub.materialRole, true);
    const renderId = layer.features.renderId[sub.featureIndex] ?? 0;
    const remap = new Map<number, number>();
    for (let k = sub.indexStart; k < sub.indexStart + sub.indexCount; k++) {
      const v = layer.index[k]!;
      let out = remap.get(v);
      if (out === undefined) {
        const n = layer.normal ? layer.normal.subarray(v * 3, v * 3 + 3) : [0, 1, 0];
        const rid = layer.vertexFeature ? (layer.features.renderId[layer.vertexFeature[v]!] ?? renderId) : renderId;
        out = b.vertex(
          layer.position.subarray(v * 3, v * 3 + 3),
          n,
          colors ? colors.subarray(v * 3, v * 3 + 3) : fallback,
          rid,
        );
        remap.set(v, out);
      }
      b.index.push(out);
    }
    triangles += sub.indexCount / 3;
  }
  return triangles;
}

/** Generates all geometry of a decoded tile. Deterministic: same tile and options give identical arrays. */
export function generateTile(tile: DecodedTile, options: GenerateOptions = {}): GeneratedTile {
  // Normalize libm differences before collinearity and polygon clipping tests. At L1 the
  // maximum change over a whole tile is under 0.04 mm, below coordinate quantization.
  const step = Math.fround(gridStepMeters(tile.id, tile.extentLog2));
  const batches = new BatchSet();
  const msByLayer: Record<string, number> = {};
  const wanted = (name: string) => !options.layers || options.layers.includes(name);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let buildings = 0;
  const nearWalls: NearWall[] = [];
  let trees: TreeInstances = { data: new Float32Array(0), renderId: new Float32Array(0), count: 0 };
  for (const name of Object.keys(tile.layers).sort()) {
    if (!wanted(name) || name === 'buildingContext') continue;
    const layer = tile.layers[name]!;
    const t0 = now();
    const extension = options.layerGenerators?.[name];
    if (extension) {
      if (layer.type === 'features') extension(layer, step, batches);
    } else if (name === 'detail' || name === 'landscape') {
      // optional layers without a registered generator are not drawn
    } else if (layer.type === 'mesh') meshBatches(layer, name, batches);
    else if (name === 'building' && tile.profile === 'full') {
      const context = tile.layers.buildingContext;
      const r = generateBuildings(layer, context?.type === 'features' ? context : null, step, options, batches);
      buildings += r.buildings;
      nearWalls.push(...r.nearWalls);
    } else if (name === 'building') {
      generateMassing(layer, name, step, batches, options.seed ?? 1);
      buildings += layer.featureCount;
    } else if (name === 'tree') trees = generateTrees(layer, step);
    else if (layer.geometry === 'polygon') generatePolygons(layer, name, step, batches);
    else if (name === 'structure' && tile.profile === 'full') generateStructures(layer, step, batches);
    else if (layer.geometry === 'line' && (name === 'structure' || tile.profile === 'massing'))
      generateBands(layer, name, step, batches);
    msByLayer[name] = now() - t0;
  }
  const built = batches.build();
  return {
    batches: built,
    trees,
    ...(options.collectNearWalls ? { nearWalls } : {}),
    stats: {
      triangles: built.reduce((s, b) => s + triangleCount(b), 0),
      vertices: built.reduce((s, b) => s + b.vertexCount, 0),
      drawCalls: built.length + (trees.count ? 2 : 0),
      buildings,
      trees: trees.count,
      msByLayer,
    },
  };
}
