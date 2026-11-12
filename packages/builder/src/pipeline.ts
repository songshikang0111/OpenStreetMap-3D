import { ingestPbf } from './ingest/index.js';
// Build pipeline: ingest → partition → plan → cut → encode → finalize (03 section 3), with per-stage caches,
// atomic writes and resume. Same input, options and versions give byte-identical outputs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseOSM } from '../../../src/osm.js';
import { normalizeRaw, canonicalStringify } from '../../../src/core/contract.js';
import {
  Coverage,
  encodeCoverage,
  encodeTile,
  tileKey,
  tilesInBounds,
  validateTileset,
  TILE_EXTENSION,
  TILESET_SCHEMA_VERSION,
} from '@city-ink/tiles';
import type { Bounds, Diagnostic, Provenance, TileId, TileInput, Tileset, FeatureLayerInput } from '@city-ink/tiles';
import { GENERATOR_VERSION } from '@city-ink/generators';
import { PlanContext, planCell, cellKey } from './plan.js';
import type { CellPlan, PlanOptions, PlanRecord } from './plan.js';
import { cutTiles } from './cut.js';
import type { LevelSpec } from './cut.js';

export const BUILDER_VERSION = GENERATOR_VERSION;
export const DEFAULT_LEVELS: (LevelSpec & { geometricErrorMeters: number })[] = [
  { id: 'L0', zoom: 14, profile: 'massing', geometricErrorMeters: 12 },
  { id: 'L1', zoom: 16, profile: 'full', geometricErrorMeters: 0.5 },
];
/** gzip budgets per profile (02 section 6), bytes. */
export const BUDGETS = {
  full: { median: 60 * 1024, p95: 250 * 1024, max: 1024 * 1024 },
  massing: { median: 40 * 1024, p95: 150 * 1024, max: 500 * 1024 },
};

export interface BuildOptions {
  /** OSM JSON file (Overpass / OSM Map / phase-one project data). */
  input?: string;
  /** Phase-one project directory (city.config.json). */
  project?: string;
  output: string;
  bbox?: Bounds;
  name?: string;
  seed?: number;
  inferRoofs?: boolean;
  ruleTrees?: boolean;
  /** Street details: lamps, signals, crossings, kerbs, parked cars, pedestrians (default off, decision E10). */
  details?: boolean;
  /** Inferred landscape completion (03 section 6, default off). */
  landscape?: boolean;
  /** Use official landmark recipes (03 section 6, default on). */
  landmarks?: boolean;
  /** Planning-cell zoom (03 section 3 default 12). Larger values give smaller cells. */
  cellZoom?: number;
  bufferMeters?: number;
  levels?: (LevelSpec & { geometricErrorMeters: number })[];
  resume?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?(p: { stage: string; progress: number; detail?: string }): void;
  /** Test hook: throws after the named stage step to simulate an interruption. */
  failAfter?: { stage: string; count: number };
}

export interface BuildReport {
  schemaVersion: 1;
  name: string;
  source: Tileset['source'];
  options: Record<string, unknown>;
  counts: Record<string, number>;
  provenance: Record<string, Record<string, Record<Provenance, number>>>;
  incompleteRelations: number;
  invalidRings: number;
  tiles: {
    level: string;
    zoom: number;
    count: number;
    totalBytes: number;
    totalGzipBytes: number;
    medianGzipBytes: number;
    p95GzipBytes: number;
    maxGzipBytes: number;
    overBudget: { tile: string; gzipBytes: number; reason: string }[];
  }[];
  fallbacks: { id: string; tile: string; reason: string }[];
  diagnostics: Diagnostic[];
  hashes: Record<string, string>;
}

export class BuildInterrupted extends Error {
  constructor(stage: string) {
    super(`Build interrupted after ${stage}.`);
    this.name = 'BuildInterrupted';
  }
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

async function writeAtomic(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function readJSONIf<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface LoadedInput {
  raw: { metadata: Record<string, unknown>; elements: unknown[] };
  area: { south: number; west: number; north: number; east: number };
  origin: { lat: number; lon: number };
  seed: number;
  name: string;
  file: string;
  sourceSha256: string;
  timestamp?: string;
  inferRoofs: boolean;
}

export async function loadInput(options: BuildOptions): Promise<LoadedInput> {
  let file = options.input;
  let config: Record<string, any> = {};
  if (options.project) {
    config = JSON.parse(await readFile(path.join(options.project, 'city.config.json'), 'utf8'));
    file = path.join(options.project, config.source?.file ?? 'data/source.json');
  }
  if (!file)
    throw Object.assign(new Error('Provide --input <file.json> or --project <dir>.'), { code: 'TILES_INPUT_MISSING' });
  let text = '';
  let raw: Record<string, any>;
  let pbfHash: string | null = null;
  if (/\.pbf$/i.test(file)) {
    const ingested = await ingestPbf(file, {
      ...(options.bbox ? { bbox: options.bbox } : {}),
      onProgress: (stage) => options.onProgress?.({ stage: 'ingest', progress: 0, detail: `pbf ${stage}` }),
    });
    raw = ingested.raw;
    pbfHash = ingested.sha256;
  } else {
    text = await readFile(file, 'utf8');
    raw = JSON.parse(text);
  }
  const meta = raw.metadata ?? {};
  const bbox = options.bbox
    ? [options.bbox[1], options.bbox[0], options.bbox[3], options.bbox[2]]
    : config.area
      ? [config.area.south, config.area.west, config.area.north, config.area.east]
      : meta.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4)
    throw Object.assign(new Error('Input has no bounding box; pass --bbox west,south,east,north.'), {
      code: 'TILES_BBOX_MISSING',
    });
  const [south, west, north, east] = bbox as number[];
  const area = { south: south!, west: west!, north: north!, east: east! };
  const origin = options.bbox
    ? { lat: (south! + north!) / 2, lon: (west! + east!) / 2 }
    : (config.origin ??
      (Array.isArray(meta.center)
        ? { lat: meta.center[0], lon: meta.center[1] }
        : { lat: (south! + north!) / 2, lon: (west! + east!) / 2 }));
  const normalized = normalizeRaw(raw, { area, origin });
  const timestamp = raw.osm3s?.timestamp_osm_base ?? meta.timestamp ?? undefined;
  return {
    raw: normalized,
    area,
    origin,
    seed: options.seed ?? config.seed ?? 1,
    name:
      options.name ??
      config.name?.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64) ??
      path.basename(file).replace(/\.(json|osm\.pbf|pbf)$/i, ''),
    file,
    sourceSha256: pbfHash ?? sha256(text),
    timestamp,
    inferRoofs: options.inferRoofs ?? config.generation?.inferRoofs ?? false,
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0;
}

/** Runs the whole pipeline and returns the build report (also written to report.json). */
export async function buildTiles(
  options: BuildOptions,
): Promise<{ report: BuildReport; tileset: Tileset; output: string }> {
  const out = path.resolve(options.output);
  const cache = path.join(out, '.build');
  const progress = (stage: string, value: number, detail?: string) => {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
    options.onProgress?.({ stage, progress: value, ...(detail ? { detail } : {}) });
  };
  const steps = new Map<string, number>();
  const step = (stage: string) => {
    const n = (steps.get(stage) ?? 0) + 1;
    steps.set(stage, n);
    if (options.failAfter && options.failAfter.stage === stage && options.failAfter.count === n)
      throw new BuildInterrupted(stage);
  };

  // ingest
  progress('ingest', 0);
  const input = await loadInput(options);
  const levels = options.levels ?? DEFAULT_LEVELS;
  const planOptions: PlanOptions = {
    seed: input.seed,
    inferRoofs: input.inferRoofs,
    ruleTrees: options.ruleTrees ?? true,
    ...(options.details ? { details: true } : {}),
    ...(options.landscape ? { landscape: true } : {}),
    landmarks: options.landmarks ?? true,
    bufferMeters: options.bufferMeters ?? 800,
  };
  const cellZoom = options.cellZoom ?? 12;
  const buildConfig = {
    planOptions,
    levels,
    cellZoom,
    version: BUILDER_VERSION,
    area: input.area,
    origin: input.origin,
  };
  const configHash = sha256(canonicalStringify(buildConfig));
  const inputHash = sha256(input.sourceSha256 + configHash);
  if (!options.resume) await rm(cache, { recursive: true, force: true });
  const ingestMarker = await readJSONIf<{ inputHash: string }>(path.join(cache, 'ingest.json'));
  if (ingestMarker && ingestMarker.inputHash !== inputHash) await rm(cache, { recursive: true, force: true });
  await writeAtomic(path.join(cache, 'ingest.json'), JSON.stringify({ inputHash, configHash, source: input.file }));
  step('ingest');
  const data = parseOSM(input.raw, input.seed);
  const ctx = new PlanContext(data);

  // partition
  progress('partition', 0);
  const areaBounds: Bounds = [input.area.west, input.area.south, input.area.east, input.area.north];
  const coarsest = Math.min(...levels.map((l) => l.zoom));
  if (cellZoom > coarsest)
    throw Object.assign(
      new Error(`Planning cells (zoom ${cellZoom}) must not be finer than the coarsest level (zoom ${coarsest}).`),
      {
        code: 'TILES_CELL_ZOOM',
        hint: 'Every tile must lie inside one planning cell; use --cell-zoom <= the L0 zoom.',
      },
    );
  const cells: (TileId | null)[] = cellZoom >= 0 ? tilesInBounds(areaBounds, cellZoom) : [null];
  step('partition');

  // plan (cached per cell)
  const records: PlanRecord[] = [];
  const planStats: Record<string, number> = {};
  for (const [i, cell] of cells.entries()) {
    const key = cellKey(cell);
    const file = path.join(cache, 'plan', `${key.replace(/\//g, '-')}.json`);
    let plan = await readJSONIf<CellPlan & { inputHash: string }>(file);
    if (!plan || plan.inputHash !== inputHash) {
      plan = { ...(await planCell(ctx, cell, planOptions)), inputHash };
      await writeAtomic(file, JSON.stringify(plan));
    }
    records.push(...plan.records);
    for (const [k, v] of Object.entries(plan.stats)) planStats[k] = (planStats[k] ?? 0) + v;
    progress('plan', (i + 1) / cells.length, key);
    step('plan');
  }

  // cut
  progress('cut', 0);
  const cut = cutTiles(records, { levels, data });
  step('cut');

  // encode (skip tiles already written with a matching hash when resuming)
  const encodedFile = path.join(cache, 'encoded.json');
  const encoded = (options.resume ? await readJSONIf<Record<string, string>>(encodedFile) : null) ?? {};
  const keys = [...cut.tiles.keys()].sort();
  const sizes = new Map<string, { raw: number; gzip: number; hash: string; profile: string }>();
  let sinceFlush = 0;
  for (const [i, key] of keys.entries()) {
    const tile = cut.tiles.get(key)!;
    const bytes = encodeTile(tile);
    const hash = sha256(bytes);
    const file = path.join(out, `${key}.${TILE_EXTENSION}`);
    if (encoded[key] !== hash) {
      await writeAtomic(file, bytes);
      encoded[key] = hash;
      if (++sinceFlush >= 16 || i === keys.length - 1) {
        await writeAtomic(encodedFile, JSON.stringify(encoded));
        sinceFlush = 0;
      }
    }
    sizes.set(key, { raw: bytes.length, gzip: gzipSync(bytes, { level: 6 }).length, hash, profile: tile.profile });
    progress('encode', (i + 1) / keys.length, key);
    step('encode');
  }
  await writeAtomic(encodedFile, JSON.stringify(encoded));
  // remove stale tiles from an earlier build into the same directory
  await removeStaleTiles(out, new Set(keys));

  // finalize
  progress('finalize', 0);
  const finest = levels[levels.length - 1]!;
  const coverage = Coverage.fromTiles(
    finest.zoom,
    keys
      .filter((k) => k.startsWith(`${finest.zoom}/`))
      .map((k) => {
        const [z, x, y] = k.split('/').map(Number);
        return { z: z!, x: x!, y: y! };
      }),
  );
  const coverageBytes = encodeCoverage(coverage);
  await writeAtomic(path.join(out, 'coverage.bin'), coverageBytes);
  const layers = new Set<string>();
  for (const t of cut.tiles.values()) for (const l of Object.keys(t.layers)) layers.add(l);
  const tileset: Tileset = {
    schemaVersion: TILESET_SCHEMA_VERSION,
    name: input.name,
    tiles: [`{z}/{x}/{y}.${TILE_EXTENSION}`],
    bounds: areaBounds,
    center: [input.origin.lon, input.origin.lat, finest.zoom],
    levels: levels.map((l) => ({
      id: l.id,
      zoom: l.zoom,
      profile: l.profile,
      geometricErrorMeters: l.geometricErrorMeters,
    })),
    coverage: { zoom: finest.zoom, index: 'coverage.bin' },
    generator: { id: 'city-ink-builder', version: BUILDER_VERSION, compatibleRuntime: '>=2.0.0 <3.0.0' },
    layers: [...layers].sort(),
    attributes: {
      building: ['height', 'minHeight', 'levels', 'roofShape', 'roofHeight', 'facade', 'usage', 'provenance'],
    },
    source: {
      kind: options.project ? 'project' : /\.pbf$/i.test(input.file) ? 'osm-pbf' : 'osm-json',
      file: path.basename(input.file),
      sha256: input.sourceSha256,
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    },
    attribution: {
      text: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL-1.0',
    },
    build: {
      seed: input.seed,
      options: {
        inferRoofs: planOptions.inferRoofs,
        ruleTrees: planOptions.ruleTrees,
        landscape: Boolean(planOptions.landscape),
        details: Boolean(planOptions.details),
        landmarks: planOptions.landmarks,
      },
      configHash,
    },
    ground: { elevation: 'flat', value: 0 },
  };
  const valid = validateTileset(tileset);
  if (!valid.valid)
    throw Object.assign(new Error('Generated tileset.json is invalid.'), {
      code: 'TILESET_INVALID',
      diagnostics: valid.diagnostics,
    });
  await writeAtomic(path.join(out, 'tileset.json'), JSON.stringify(tileset, null, 2) + '\n');

  const report = makeReport(input.name, tileset, records, cut, sizes, levels, data, planOptions, coverageBytes);
  await writeAtomic(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  step('finalize');
  progress('finalize', 1);
  return { report, tileset, output: out };
}

async function removeStaleTiles(out: string, keep: Set<string>) {
  for (const z of await readdir(out).catch(() => [])) {
    if (!/^\d+$/.test(z)) continue;
    for (const x of await readdir(path.join(out, z)).catch(() => []))
      for (const f of await readdir(path.join(out, z, x)).catch(() => [])) {
        const m = new RegExp(`^(\\d+)\\.${TILE_EXTENSION}$`).exec(f);
        if (m && !keep.has(`${z}/${x}/${m[1]}`)) await rm(path.join(out, z, x, f));
      }
  }
}

function makeReport(
  name: string,
  tileset: Tileset,
  records: PlanRecord[],
  cut: ReturnType<typeof cutTiles>,
  sizes: Map<string, { raw: number; gzip: number; hash: string; profile: string }>,
  levels: LevelSpec[],
  data: ReturnType<typeof parseOSM>,
  planOptions: PlanOptions,
  coverageBytes: Uint8Array,
): BuildReport {
  const counts: Record<string, number> = {};
  const provenance: BuildReport['provenance'] = {};
  const seen = new Set<string>();
  for (const r of records) {
    const key = `${r.layer}:${r.id}`;
    if (seen.has(key)) continue; // polygon/line records repeat per intersecting cell
    seen.add(key);
    counts[r.layer] = (counts[r.layer] ?? 0) + 1;
    // Buildings claimed by a landmark recipe are drawn by the landmark mesh at full detail; their provenance is
    // reported separately so `provenance.building` matches the L1 building features (and the runtime filter).
    if (r.layer === 'building' && r.properties.landmark === 'claimed') {
      counts.landmarkClaimedBuildings = (counts.landmarkClaimedBuildings ?? 0) + 1;
      continue;
    }
    for (const [attr, level] of Object.entries(r.provenance)) {
      const layer = (provenance[r.layer] ??= {});
      const slot = (layer[attr] ??= { observed: 0, derived: 0, inferred: 0 });
      slot[level]++;
    }
  }
  const tiles = levels.map((level) => {
    const list = [...sizes].filter(([k]) => k.startsWith(`${level.zoom}/`));
    const gz = list.map(([, s]) => s.gzip).sort((a, b) => a - b);
    const budget = BUDGETS[level.profile];
    return {
      level: level.id,
      zoom: level.zoom,
      count: list.length,
      totalBytes: list.reduce((s, [, v]) => s + v.raw, 0),
      totalGzipBytes: gz.reduce((s, v) => s + v, 0),
      medianGzipBytes: percentile(gz, 50),
      p95GzipBytes: percentile(gz, 95),
      maxGzipBytes: gz.at(-1) ?? 0,
      overBudget: list
        .filter(([, s]) => s.gzip > budget.max)
        .map(([k, s]) => ({
          tile: k,
          gzipBytes: s.gzip,
          reason: `exceeds the ${level.profile} hard limit of ${budget.max} bytes`,
        })),
    };
  });
  const diagnostics: Diagnostic[] = [...cut.diagnostics];
  for (const t of tiles)
    for (const o of t.overBudget)
      diagnostics.push({
        code: 'TILE_OVER_BUDGET',
        stage: 'encode',
        tileId: o.tile,
        message: `${o.tile} is ${o.gzipBytes} bytes gzip; ${o.reason}.`,
        hint: 'Listed in the build report; no objects were dropped.',
      });
  if (data.stats.incompleteRelations)
    diagnostics.push({
      code: 'INCOMPLETE_RELATIONS',
      stage: 'parse',
      message: `${data.stats.incompleteRelations} incomplete multipolygons were omitted; missing rings were not invented.`,
    });
  const hashes: Record<string, string> = { 'coverage.bin': sha256(coverageBytes) };
  for (const [k, s] of [...sizes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) hashes[`${k}.${TILE_EXTENSION}`] = s.hash;
  return {
    schemaVersion: 1,
    name,
    source: tileset.source,
    options: { ...planOptions },
    counts,
    provenance,
    incompleteRelations: data.stats.incompleteRelations,
    invalidRings: data.stats.invalidRings,
    tiles,
    fallbacks: cut.fallbacks,
    diagnostics,
    hashes,
  };
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}

export type { TileInput, FeatureLayerInput };
