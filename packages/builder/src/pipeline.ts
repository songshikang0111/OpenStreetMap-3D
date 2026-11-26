import { RegionMask } from './region.js';
import type { BuildRegionInput } from './region.js';
import { ingestPbf } from './ingest/index.js';
// Build pipeline: ingest → partition → plan → cut → encode → finalize (03 section 3), with per-stage caches,
// atomic writes and resume. Same input, options and versions give byte-identical outputs.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
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
  tileToLngLatBounds,
  tilesInBounds,
  validateTileset,
  TILE_EXTENSION,
  TILESET_SCHEMA_VERSION,
} from '@city-ink/tiles';
import type { Bounds, Diagnostic, Provenance, TileId, TileInput, Tileset, FeatureLayerInput } from '@city-ink/tiles';
import { GENERATOR_VERSION } from '@city-ink/generators';
import { PlanContext, cellKey } from './plan.js';
import type { CellPlan, PlanOptions, PlanRecord } from './plan.js';
import { planQueuedCells } from './planning-queue.js';
import { cutTiles } from './cut.js';
import type { CutResult, LevelSpec } from './cut.js';
import { boundsContains, expandBounds } from './geo.js';

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
  /** GeoJSON polygonal mask, mutually exclusive with bbox. */
  region?: BuildRegionInput;
  name?: string;
  seed?: number;
  /** Use 3 m above the known base when height and floors are missing. Defaults to inference. */
  inferHeights?: boolean;
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
  /** Process RSS limit checked between pipeline steps and PBF blocks, in MiB (default 8192). */
  maxMemoryMiB?: number;
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

async function resolveSource(options: BuildOptions) {
  let file = options.input;
  let config: Record<string, any> = {};
  if (options.project) {
    config = JSON.parse(await readFile(path.join(options.project, 'city.config.json'), 'utf8'));
    file = path.join(options.project, config.source?.file ?? 'data/source.json');
  }
  if (!file)
    throw Object.assign(new Error('Provide --input <file.json> or --project <dir>.'), { code: 'TILES_INPUT_MISSING' });
  return { file, config };
}

export async function loadInput(options: BuildOptions): Promise<LoadedInput> {
  return readInput(options, await resolveSource(options));
}

async function readInput(
  options: BuildOptions,
  { file, config }: Awaited<ReturnType<typeof resolveSource>>,
  checkBudget?: () => void,
): Promise<LoadedInput> {
  let text = '';
  let raw: Record<string, any>;
  let pbfHash: string | null = null;
  if (/\.pbf$/i.test(file)) {
    const ingested = await ingestPbf(file, {
      ...(checkBudget ? { checkBudget } : {}),
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

type BuildOutput = { report: BuildReport; tileset: Tileset; output: string };

async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

interface CompleteBuild {
  requestHash: string;
  reportHash: string;
  tilesetHash: string;
}

// Both metadata files and all referenced payloads must survive a crash/copy intact. Hashing a finished output
// also catches same-length edits that cannot be detected by a cached byte count or modification timestamp.
async function readComplete(out: string, marker: CompleteBuild): Promise<BuildOutput | null> {
  try {
    const reportText = await readFile(path.join(out, 'report.json'), 'utf8');
    const tilesetText = await readFile(path.join(out, 'tileset.json'), 'utf8');
    if (sha256(reportText) !== marker.reportHash || sha256(tilesetText) !== marker.tilesetHash) return null;
    const report: BuildReport = JSON.parse(reportText);
    const tileset: Tileset = JSON.parse(tilesetText);
    const keys = new Set<string>();
    for (const [file, expected] of Object.entries(report.hashes)) {
      if (file !== 'coverage.bin') {
        const match = /^(\d+\/\d+\/\d+)\.c3t$/.exec(file);
        if (!match) return null;
        keys.add(match[1]!);
      }
      if ((await hashFile(path.join(out, file))) !== expected) return null;
    }
    await removeStaleTiles(out, keys);
    return { report, tileset, output: out };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Runs the whole pipeline and returns the build report (also written to report.json). */
export async function buildTiles(
  options: BuildOptions,
): Promise<{ report: BuildReport; tileset: Tileset; output: string }> {
  const region = options.region ? new RegionMask(options.region) : null;
  if (region) {
    if (options.bbox)
      throw Object.assign(new Error('Choose either bbox or a polygon region.'), { code: 'BUILD_REGION_INVALID' });
    options = { ...options, bbox: region.bounds };
  }
  const out = path.resolve(options.output);
  const cache = path.join(out, '.build');
  const concurrency = options.concurrency ?? 1;
  const memoryMiB = options.maxMemoryMiB ?? 8192;
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isSafeInteger(memoryMiB) ||
    memoryMiB < 1 ||
    memoryMiB > 8192
  )
    throw Object.assign(new Error('Use positive integer concurrency and a --max-memory limit in MiB (at most 8192).'), {
      code: 'OPTION_INVALID',
    });
  const checkBudget = () => {
    options.signal?.throwIfAborted();
    if (process.memoryUsage.rss() > memoryMiB * 1024 ** 2)
      throw Object.assign(new Error(`Build exceeded the ${memoryMiB} MiB process RSS budget.`), {
        code: 'BUILD_MEMORY_LIMIT',
        hint: 'Use fewer workers or clip the input with osmium extract and retry with --resume.',
      });
  };
  const progress = (stage: string, value: number, detail?: string) => {
    checkBudget();
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
  const source = await resolveSource(options);
  const completeFile = path.join(cache, 'complete.json');
  const marker = options.resume ? await readJSONIf<CompleteBuild>(completeFile) : null;
  const requestKey = (sourceHash: string) =>
    sha256(
      canonicalStringify({
        // Change the cache revision whenever planning, tile encoding or report semantics change.
        revision: 2,
        version: BUILDER_VERSION,
        sourceHash,
        file: path.basename(source.file),
        config: source.config,
        project: Boolean(options.project),
        bbox: options.bbox ?? null,
        ...(region ? { region: region.polygons } : {}),
        name: options.name ?? null,
        seed: options.seed ?? null,
        ...(options.inferHeights === false ? { inferHeights: false } : {}),
        inferRoofs: options.inferRoofs ?? null,
        ruleTrees: options.ruleTrees ?? true,
        details: options.details ?? false,
        landscape: options.landscape ?? false,
        landmarks: options.landmarks ?? true,
        cellZoom: options.cellZoom ?? 12,
        bufferMeters: options.bufferMeters ?? 800,
        levels: options.levels ?? DEFAULT_LEVELS,
      }),
    );
  if (marker && marker.requestHash === requestKey(await hashFile(source.file))) {
    const complete = await readComplete(out, marker);
    if (complete) {
      progress('finalize', 1, 'verified existing build');
      return complete;
    }
  }
  const input = await readInput(options, source, checkBudget);
  const levels = options.levels ?? DEFAULT_LEVELS;
  const planOptions: PlanOptions = {
    seed: input.seed,
    ...(options.inferHeights === false ? { inferHeights: false } : {}),
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
    ...(region ? { region: region.polygons } : {}),
  };
  const configHash = sha256(canonicalStringify(buildConfig));
  const inputHash = sha256('2:' + input.sourceSha256 + configHash);
  if (!options.resume) await rm(cache, { recursive: true, force: true });
  const ingestMarker = await readJSONIf<{ inputHash: string }>(path.join(cache, 'ingest.json'));
  if (ingestMarker && ingestMarker.inputHash !== inputHash) await rm(cache, { recursive: true, force: true });
  await writeAtomic(path.join(cache, 'ingest.json'), JSON.stringify({ inputHash, configHash, source: input.file }));
  step('ingest');
  const data = parseOSM(input.raw, input.seed);
  if (options.inferHeights === false) {
    for (const building of data.buildings) {
      if (building.source !== 'estimated') continue;
      building.height = building.minHeight + 3;
      building.levels = 1;
    }
  }
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

  // plan (cached per cell). Only the building records of every cell stay in memory (neighbour context for the
  // cut); everything else is read back one cell at a time (WP-F task F4, memory bounded by the largest cell).
  const planStats: Record<string, number> = {};
  const summary = new RecordSummary();
  const buildingRecords: PlanRecord[] = [];
  const planFiles = cells.map((cell) => ({
    cell,
    file: path.join(cache, 'plan', cellKey(cell).replace(/\//g, '-') + '.json'),
  }));
  let completed = 0;
  const complete = (cell: TileId | null) => {
    progress('plan', ++completed / cells.length, cellKey(cell));
    step('plan');
  };
  const jobs = [];
  for (const job of planFiles) {
    const cached = options.resume && (await readJSONIf<CellPlan & { inputHash: string }>(job.file));
    if (cached && cached.inputHash === inputHash) complete(job.cell);
    else jobs.push(job);
  }
  // Each active neighbourhood includes phase-one modelling structures as well as its serialized plan. Cap
  // simultaneous workers on many-core hosts so planning cannot duplicate dozens of dense neighbourhoods at once.
  await planQueuedCells(
    jobs,
    ctx,
    planOptions,
    Math.min(concurrency, Math.max(1, Math.floor(memoryMiB / 1024))),
    async (job, plan) => {
      if (region) plan.records = plan.records.flatMap((r) => region.clip(r));
      await writeAtomic(job.file, JSON.stringify({ ...plan, inputHash }));
      complete(job.cell);
    },
    options.signal,
  );

  // Reduce plans in cell order independently of worker completion order.
  for (const { file } of planFiles) {
    const plan = (await readJSONIf<CellPlan>(file))!;
    for (const r of plan.records) {
      summary.add(r);
      if (r.layer === 'building') buildingRecords.push(r);
    }
    for (const [k, v] of Object.entries(plan.stats)) planStats[k] = (planStats[k] ?? 0) + v;
  }

  // cut and encode, cell by cell. Every tile lies inside one planning cell and only records owned by that cell
  // reach it, so cutting per cell gives the same tiles as one global cut; neighbouring buildings are added for the
  // shared-wall context and their own tiles are discarded.
  const sizes = new Map<string, { raw: number; gzip: number; hash: string; profile: string }>();
  const keys: string[] = [];
  const layers = new Set<string>();
  const cutDiagnostics: Diagnostic[] = [];
  const fallbacks: CutResult['fallbacks'] = [];
  let cutSteps = 0;
  progress('cut', 0);
  for (const { cell, file } of planFiles) {
    const plan = (await readJSONIf<CellPlan>(file))!;
    const own = new Set(plan.records.map((r) => r.id));
    const cellRect = cell ? tileToLngLatBounds(cell) : null;
    const near = cellRect ? expandBounds(cellRect, 400) : null;
    const context = buildingRecords.filter(
      (r) => r.cell !== plan.cell && !own.has(r.id) && (!near || boundsContains(near, r.anchor)),
    );
    const cut = cutTiles(context.length ? [...plan.records, ...context] : plan.records, { levels, data });
    const inside = (k: string) => {
      if (!cell) return true;
      const [z, x, y] = k.split('/').map(Number);
      const d = 2 ** (z! - cell.z);
      return Math.floor(x! / d) === cell.x && Math.floor(y! / d) === cell.y;
    };
    for (const d of cut.diagnostics) if (!d.tileId || inside(d.tileId)) cutDiagnostics.push(d);
    for (const f of cut.fallbacks) if (inside(f.tile)) fallbacks.push(f);
    if (cutSteps++ === 0) step('cut');
    for (const key of [...cut.tiles.keys()].filter(inside).sort()) {
      const tile = cut.tiles.get(key)!;
      for (const l of Object.keys(tile.layers)) layers.add(l);
      const bytes = encodeTile(tile);
      const hash = sha256(bytes);
      const out_ = path.join(out, `${key}.${TILE_EXTENSION}`);
      const existing = options.resume
        ? await readFile(out_).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          })
        : null;
      if (!existing?.equals(bytes)) await writeAtomic(out_, bytes);
      keys.push(key);
      sizes.set(key, { raw: bytes.length, gzip: gzipSync(bytes, { level: 6 }).length, hash, profile: tile.profile });
      progress('encode', keys.length, key);
      step('encode');
    }
  }
  keys.sort();
  const cut = { diagnostics: cutDiagnostics, fallbacks };
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
        ...(planOptions.inferHeights === false ? { inferHeights: false } : {}),
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
  const tilesetText = JSON.stringify(tileset, null, 2) + '\n';
  await writeAtomic(path.join(out, 'tileset.json'), tilesetText);

  const report = makeReport(input.name, tileset, summary, cut, sizes, levels, data, planOptions, coverageBytes);
  const reportText = JSON.stringify(report, null, 2) + '\n';
  await writeAtomic(path.join(out, 'report.json'), reportText);
  await writeAtomic(
    completeFile,
    JSON.stringify({
      requestHash: requestKey(input.sourceSha256),
      reportHash: sha256(reportText),
      tilesetHash: sha256(tilesetText),
    } satisfies CompleteBuild),
  );
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
  summary: RecordSummary,
  cut: Pick<CutResult, 'diagnostics' | 'fallbacks'>,
  sizes: Map<string, { raw: number; gzip: number; hash: string; profile: string }>,
  levels: LevelSpec[],
  data: ReturnType<typeof parseOSM>,
  planOptions: PlanOptions,
  coverageBytes: Uint8Array,
): BuildReport {
  const { counts, provenance } = summary;
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

/** Object counts and provenance of plan records, deduplicated across cells (polygon and line records repeat). */
class RecordSummary {
  readonly counts: Record<string, number> = {};
  readonly provenance: BuildReport['provenance'] = {};
  private readonly seen = new Set<string>();
  add(r: PlanRecord) {
    const key = `${r.layer}:${r.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.counts[r.layer] = (this.counts[r.layer] ?? 0) + 1;
    // Buildings claimed by a landmark recipe are drawn by the landmark mesh at full detail; their provenance is
    // reported separately so `provenance.building` matches the L1 building features (and the runtime filter).
    if (r.layer === 'building' && r.properties.landmark === 'claimed') {
      this.counts.landmarkClaimedBuildings = (this.counts.landmarkClaimedBuildings ?? 0) + 1;
      return;
    }
    for (const [attr, level] of Object.entries(r.provenance)) {
      const layer = (this.provenance[r.layer] ??= {});
      const slot = (layer[attr] ??= { observed: 0, derived: 0, inferred: 0 });
      slot[level]++;
    }
  }
}
