// Work done inside a Worker: decode + generate, plus compact feature metadata for picking. No DOM, no WebGL.
import {
  decodeTile,
  readFeatureMetaAt,
  tileMetersToLngLat,
  gridStepMeters,
  isTileError,
  tileKey,
} from '@city-ink/tiles';
import type { DecodedTile, Diagnostic, MeshLayer, LngLat, Provenance } from '@city-ink/tiles';
import { generateTile, batchTransferables } from '@city-ink/generators';
import type { GeneratedTile } from '@city-ink/generators';
import { DETAIL_GENERATORS } from '@city-ink/details';

import { prepareUpload, type UploadData } from './upload-data.js';

export interface WorkerRequest {
  type: 'generate';
  job: number;
  buffer: ArrayBuffer;
  options: { seed?: number; inferRoofs?: boolean };
}

export interface FeatureRecord {
  renderId: number;
  id: string;
  layer: string;
  properties: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  tags: Record<string, string>;
  lngLat: LngLat;
  bounds: [number, number, number, number];
}

export type WorkerResponse =
  | {
      type: 'result';
      job: number;
      tile: string;
      profile: string;
      generated: GeneratedTile;
      upload: UploadData;
      features: FeatureRecord[];
      maxRenderId: number;
      decodeMs: number;
      generateMs: number;
    }
  | { type: 'error'; job: number; diagnostic: Diagnostic };

type MeshBounds = [number, number, number, number];

function meshFeatureBounds(layer: MeshLayer): MeshBounds[] {
  const bounds: MeshBounds[] = [];
  for (let v = 0; v < layer.vertexCount; v++) {
    // Without explicit ownership every feature describes the same mesh extent.
    const owner = layer.vertexFeature?.[v] ?? 0;
    const x = layer.position[v * 3]!;
    const z = layer.position[v * 3 + 2]!;
    const box = bounds[owner];
    if (box) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], z);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], z);
    } else bounds[owner] = [x, z, x, z];
  }
  return bounds;
}

function featureRecords(tile: DecodedTile) {
  const step = gridStepMeters(tile.id, tile.extentLog2);
  const features: FeatureRecord[] = [];
  let maxRenderId = 0;
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (name === 'buildingContext') continue;
    const table = layer.type === 'features' ? layer : layer.features;
    if (!table.featureCount) continue;
    const meshBounds = layer.type === 'mesh' ? meshFeatureBounds(layer) : undefined;
    for (let i = 0; i < table.featureCount; i++) {
      let x0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        z1 = -Infinity;
      if (layer.type === 'features') {
        const v0 = layer.vertexStart[layer.ringStart[layer.partStart[i]!]!]!;
        const v1 = layer.vertexStart[layer.ringStart[layer.partStart[i + 1]!]!]!;
        for (let v = v0; v < v1; v++) {
          const x = layer.positions[v * 2]! * step,
            z = layer.positions[v * 2 + 1]! * step;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      } else {
        const box = meshBounds![layer.vertexFeature ? i : 0];
        if (!box) continue;
        [x0, z0, x1, z1] = box;
      }
      if (!Number.isFinite(x0)) continue;
      const meta = readFeatureMetaAt(table, i);
      maxRenderId = Math.max(maxRenderId, meta.renderId);
      const sw = tileMetersToLngLat(tile.id, x0, z1);
      const ne = tileMetersToLngLat(tile.id, x1, z0);
      features.push({
        renderId: meta.renderId,
        id: meta.id,
        layer: name,
        properties: meta.properties ?? {},
        provenance: meta.provenance ?? {},
        tags: meta.tags ?? {},
        lngLat: tileMetersToLngLat(tile.id, (x0 + x1) / 2, (z0 + z1) / 2),
        bounds: [sw[0], sw[1], ne[0], ne[1]],
      });
    }
  }
  return { features, maxRenderId };
}

export function handleRequest(request: WorkerRequest): { response: WorkerResponse; transfer: ArrayBuffer[] } {
  try {
    const t0 = performance.now();
    const tile = decodeTile(request.buffer);
    const t1 = performance.now();
    const generated = generateTile(tile, {
      ...request.options,
      layerGenerators: DETAIL_GENERATORS,
      collectNearWalls: true,
    });
    const { features, maxRenderId } = featureRecords(tile);
    const upload = prepareUpload(generated);
    const t2 = performance.now();
    const transfer = batchTransferables(generated.batches);
    transfer.push(generated.trees.data.buffer as ArrayBuffer, generated.trees.renderId.buffer as ArrayBuffer);
    for (const array of [...upload.ink, upload.crowns, upload.trunks]) transfer.push(array.buffer as ArrayBuffer);
    return {
      response: {
        type: 'result',
        job: request.job,
        tile: tileKey(tile.id),
        profile: tile.profile,
        generated,
        upload,
        features,
        maxRenderId,
        decodeMs: t1 - t0,
        generateMs: t2 - t1,
      },
      transfer,
    };
  } catch (error) {
    const diagnostic: Diagnostic = isTileError(error)
      ? error.toDiagnostic()
      : { code: 'TILE_GENERATE_FAILED', stage: 'generate', message: String((error as Error)?.message ?? error) };
    return { response: { type: 'error', job: request.job, diagnostic }, transfer: [] };
  }
}
