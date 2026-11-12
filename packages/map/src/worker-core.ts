// Work done inside a Worker: decode + generate, plus compact feature metadata for picking. No DOM, no WebGL.
import {
  decodeTile,
  readFeatureMetaAt,
  tileMetersToLngLat,
  gridStepMeters,
  isTileError,
  tileKey,
} from '@city-ink/tiles';
import type { DecodedTile, Diagnostic, FeatureLayer, LngLat, Provenance } from '@city-ink/tiles';
import { generateTile, batchTransferables } from '@city-ink/generators';
import type { GeneratedTile } from '@city-ink/generators';
import { DETAIL_GENERATORS } from '@city-ink/details';

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
      generated: GeneratedTile;
      features: FeatureRecord[];
      decodeMs: number;
      generateMs: number;
    }
  | { type: 'error'; job: number; diagnostic: Diagnostic };

function featureRecords(tile: DecodedTile): FeatureRecord[] {
  const step = gridStepMeters(tile.id, tile.extentLog2);
  const out: FeatureRecord[] = [];
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (name === 'buildingContext') continue;
    const table = layer.type === 'features' ? layer : layer.features;
    for (let i = 0; i < table.featureCount; i++) {
      const meta = readFeatureMetaAt(table, i);
      let x0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        z1 = -Infinity;
      if (layer.type === 'features') {
        const f = layer as FeatureLayer;
        const v0 = f.vertexStart[f.ringStart[f.partStart[i]!]!]!;
        const v1 = f.vertexStart[f.ringStart[f.partStart[i + 1]!]!]!;
        for (let v = v0; v < Math.max(v1, v0 + 1); v++) {
          const x = f.positions[v * 2]! * step,
            z = f.positions[v * 2 + 1]! * step;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      } else {
        for (let v = 0; v < layer.vertexCount; v++) {
          if (layer.vertexFeature && layer.vertexFeature[v] !== i) continue;
          const x = layer.position[v * 3]!,
            z = layer.position[v * 3 + 2]!;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      }
      if (!Number.isFinite(x0)) continue;
      const sw = tileMetersToLngLat(tile.id, x0, z1);
      const ne = tileMetersToLngLat(tile.id, x1, z0);
      out.push({
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
  return out;
}

export function handleRequest(request: WorkerRequest): { response: WorkerResponse; transfer: ArrayBuffer[] } {
  try {
    const t0 = performance.now();
    const tile = decodeTile(request.buffer);
    const t1 = performance.now();
    const generated = generateTile(tile, { ...request.options, layerGenerators: DETAIL_GENERATORS });
    const features = featureRecords(tile);
    const t2 = performance.now();
    const transfer = batchTransferables(generated.batches);
    transfer.push(generated.trees.data.buffer as ArrayBuffer, generated.trees.renderId.buffer as ArrayBuffer);
    return {
      response: {
        type: 'result',
        job: request.job,
        tile: tileKey(tile.id),
        generated,
        features,
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
