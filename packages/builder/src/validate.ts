// `city tiles validate` and `city tiles inspect` (03 section 7).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  decodeCoverage,
  decodeTile,
  parentTile,
  parseTileKey,
  readFeatureMeta,
  readFeatures,
  tileKey,
  validateTileset,
  isTileError,
  TILE_EXTENSION,
} from '@city-ink/tiles';
import type { Diagnostic, Tileset, TileId } from '@city-ink/tiles';
import { BUDGETS } from './pipeline.js';

export interface ValidateResult {
  valid: boolean;
  tiles: number;
  bytes: number;
  gzipBytes: number;
  diagnostics: Diagnostic[];
}

async function listTiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const z of await readdir(dir).catch(() => [] as string[])) {
    if (!/^\d+$/.test(z)) continue;
    for (const x of await readdir(path.join(dir, z)).catch(() => [] as string[]))
      for (const f of await readdir(path.join(dir, z, x)).catch(() => [] as string[])) {
        const m = new RegExp(`^(\\d+)\\.${TILE_EXTENSION}$`).exec(f);
        if (m) out.push(`${z}/${x}/${m[1]}`);
      }
  }
  return out.sort();
}

/** Checks metadata schema, decodability, coverage consistency, size budgets and attribution. */
export async function validateTilesetDir(dir: string): Promise<ValidateResult> {
  const diagnostics: Diagnostic[] = [];
  const result: ValidateResult = { valid: false, tiles: 0, bytes: 0, gzipBytes: 0, diagnostics };
  let tileset: Tileset;
  try {
    const json = JSON.parse(await readFile(path.join(dir, 'tileset.json'), 'utf8'));
    const v = validateTileset(json);
    diagnostics.push(...v.diagnostics);
    if (!v.valid) return result;
    tileset = v.value!;
  } catch (error) {
    diagnostics.push({
      code: 'TILESET_MISSING',
      stage: 'validate',
      message: `Cannot read tileset.json: ${(error as Error).message}`,
      hint: 'Run city tiles build first.',
    });
    return result;
  }
  if (!tileset.attribution?.text?.includes('OpenStreetMap'))
    diagnostics.push({
      code: 'ATTRIBUTION_MISSING',
      stage: 'validate',
      message: 'tileset.json must credit OpenStreetMap contributors.',
    });
  let coverage;
  try {
    coverage = decodeCoverage(await readFile(path.join(dir, tileset.coverage.index)));
  } catch (error) {
    diagnostics.push({
      code: isTileError(error) ? error.code : 'COVERAGE_MISSING',
      stage: 'validate',
      message: `Coverage index: ${(error as Error).message}`,
    });
    return result;
  }
  if (coverage.zoom !== tileset.coverage.zoom)
    diagnostics.push({
      code: 'COVERAGE_ZOOM_MISMATCH',
      stage: 'validate',
      message: `coverage.bin is zoom ${coverage.zoom}, tileset.json says ${tileset.coverage.zoom}.`,
    });
  const files = await listTiles(dir);
  const levels = new Map(tileset.levels.map((l) => [l.zoom, l]));
  const present = new Set(files);
  for (const key of files) {
    const id = parseTileKey(key);
    const level = levels.get(id.z);
    if (!level) {
      diagnostics.push({
        code: 'TILE_UNEXPECTED_ZOOM',
        stage: 'validate',
        tileId: key,
        message: `Tile ${key} is not at a declared level.`,
      });
      continue;
    }
    if (!coverage.has(id))
      diagnostics.push({
        code: 'COVERAGE_MISMATCH',
        stage: 'validate',
        tileId: key,
        message: `Tile ${key} exists but coverage.bin marks it absent.`,
      });
    const bytes = await readFile(path.join(dir, `${key}.${TILE_EXTENSION}`));
    result.bytes += bytes.length;
    const gz = gzipSync(bytes, { level: 6 }).length;
    result.gzipBytes += gz;
    try {
      const tile = decodeTile(bytes);
      if (tileKey(tile.id) !== key)
        diagnostics.push({
          code: 'TILE_ID_MISMATCH',
          stage: 'validate',
          tileId: key,
          message: `File ${key} contains tile ${tileKey(tile.id)}.`,
        });
      if (tile.profile !== level.profile)
        diagnostics.push({
          code: 'TILE_PROFILE_MISMATCH',
          stage: 'validate',
          tileId: key,
          message: `Tile ${key} has profile ${tile.profile}, level ${level.id} expects ${level.profile}.`,
        });
    } catch (error) {
      diagnostics.push({
        code: isTileError(error) ? error.code : 'TILE_DECODE_FAILED',
        stage: 'validate',
        tileId: key,
        message: (error as Error).message,
      });
    }
    const budget = BUDGETS[level.profile];
    if (gz > budget.max)
      diagnostics.push({
        code: 'TILE_OVER_BUDGET',
        stage: 'validate',
        tileId: key,
        message: `${key} is ${gz} bytes gzip, over the ${budget.max}-byte limit.`,
      });
    result.tiles++;
  }
  // Every covered finest-level tile and every ancestor at the declared levels must exist.
  for (const id of coverage.tiles()) {
    if (!present.has(tileKey(id)))
      diagnostics.push({
        code: 'COVERAGE_MISMATCH',
        stage: 'validate',
        tileId: tileKey(id),
        message: `coverage.bin lists ${tileKey(id)} but the file is missing.`,
      });
    for (const level of tileset.levels)
      if (level.zoom < id.z) {
        const p: TileId = parentTile(id, level.zoom);
        if (!present.has(tileKey(p)))
          diagnostics.push({
            code: 'LEVEL_TILE_MISSING',
            stage: 'validate',
            tileId: tileKey(p),
            message: `Level ${level.id} tile ${tileKey(p)} is missing above ${tileKey(id)}.`,
          });
      }
  }
  result.valid = !diagnostics.some((d) => d.code !== 'TILE_OVER_BUDGET');
  return result;
}

/** Summarises one tile: layers, counts, sizes and the first features of each layer. */
export async function inspectTile(dir: string, key: string, sample = 3) {
  const id = parseTileKey(key);
  const bytes = await readFile(path.join(dir, `${tileKey(id)}.${TILE_EXTENSION}`));
  const tile = decodeTile(bytes);
  const layers: Record<string, unknown> = {};
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (layer.type === 'features')
      layers[name] = {
        type: 'features',
        geometry: layer.geometry,
        features: layer.featureCount,
        vertices: layer.positions.length / 2,
        attributes: layer.attributes.map((a) => `${a.name}:${a.type}`),
        sample: readFeatures(layer)
          .slice(0, sample)
          .map((f) => ({
            id: f.id,
            renderId: f.renderId,
            properties: f.properties,
            provenance: f.provenance,
            tags: f.tags,
          })),
      };
    else
      layers[name] = {
        type: 'mesh',
        vertices: layer.vertexCount,
        triangles: layer.index.length / 3,
        submeshes: layer.submeshes.length,
        positionEncoding: layer.positionEncoding,
        sample: readFeatureMeta(layer.features).slice(0, sample),
      };
  }
  return {
    tile: tileKey(tile.id),
    profile: tile.profile,
    version: `${tile.version.major}.${tile.version.minor}`,
    extentLog2: tile.extentLog2,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 6 }).length,
    layers,
  };
}
