// `city tiles <build|validate|inspect|serve|pack>`; follows the phase-one CLI output contract: with --json the
// result object goes to stdout and progress to stderr, with schemaVersion/status/artifacts/diagnostics.
import os from 'node:os';
import path from 'node:path';
import { buildTiles } from './pipeline.js';
import { validateTilesetDir, inspectTile } from './validate.js';
import { serveTiles } from './serve.js';
import type { Diagnostic } from '@city-ink/tiles';

export const TILES_HELP = `city tiles — build and check static 3D city tiles

  city tiles build (--input file.json|city.osm.pbf | --project dir) --output dir [--bbox w,s,e,n] [--resume]
                   [--seed n] [--config options.json] [--concurrency n] [--cell-zoom n] [--json]
  city tiles validate <dir> [--json]
  city tiles inspect <dir> --tile z/x/y [--json]
  city tiles serve <dir> [--port 4181] [--json]

Input: OSM JSON (Overpass / OSM Map), an .osm.pbf extract (<= 1 GB, build area <= 5,000 km2) or a phase-one project.
Options file (--config): {"inferRoofs": false, "ruleTrees": true, "details": false, "landscape": false}. Output is ODbL data; keep the attribution.`;

export interface TilesCLIResult {
  schemaVersion: 1;
  status: 'succeeded' | 'failed' | 'cancelled';
  artifacts: string[];
  diagnostics: Diagnostic[];
  [key: string]: unknown;
}

interface Parsed {
  positionals: string[];
  options: Record<string, string | boolean>;
}

const VALUE_OPTIONS = new Set([
  'input',
  'project',
  'output',
  'bbox',
  'seed',
  'config',
  'concurrency',
  'cell-zoom',
  'tile',
  'port',
  'name',
  'max-memory',
  'levels',
]);
const FLAG_OPTIONS = new Set(['json', 'resume', 'help']);

function parse(args: string[]): Parsed {
  const out: Parsed = { positionals: [], options: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      out.positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (FLAG_OPTIONS.has(name)) out.options[name] = true;
    else if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? args[++i];
      if (value === undefined)
        throw Object.assign(new Error(`--${name} needs a value.`), { code: 'OPTION_VALUE_MISSING' });
      out.options[name] = value;
    } else
      throw Object.assign(new Error(`Unknown option --${name}.`), {
        code: 'UNKNOWN_OPTION',
        hint: 'Run city tiles --help.',
      });
  }
  return out;
}

const ok = (extra: Partial<TilesCLIResult> = {}): TilesCLIResult => ({
  schemaVersion: 1,
  status: 'succeeded',
  artifacts: [],
  diagnostics: [],
  ...extra,
});

export async function runTilesCLI(
  args: string[],
  {
    cwd = process.cwd(),
    stderr = process.stderr,
    signal,
  }: { cwd?: string; stderr?: NodeJS.WritableStream; signal?: AbortSignal } = {},
): Promise<TilesCLIResult & { server?: { close(): Promise<void> } }> {
  let parsed: Parsed;
  try {
    parsed = parse(args);
  } catch (error) {
    return fail(error, 'cli');
  }
  const [command, target] = parsed.positionals;
  const o = parsed.options;
  if (o.help || !command) return ok({ help: TILES_HELP });
  const resolve = (p: unknown) => path.resolve(cwd, String(p));
  try {
    if (command === 'build') {
      if (!o.output) throw Object.assign(new Error('--output is required.'), { code: 'OPTION_MISSING' });
      const bbox = o.bbox ? String(o.bbox).split(',').map(Number) : undefined;
      if (bbox && (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))))
        throw Object.assign(new Error('--bbox expects west,south,east,north.'), { code: 'OPTION_INVALID' });
      const config = o.config
        ? JSON.parse(await (await import('node:fs/promises')).readFile(resolve(o.config), 'utf8'))
        : {};
      const concurrency = o.concurrency ? Math.max(1, Number(o.concurrency)) : Math.max(1, os.cpus().length - 1);
      const { report, output } = await buildTiles({
        ...(o.input ? { input: resolve(o.input) } : {}),
        ...(o.project ? { project: resolve(o.project) } : {}),
        output: resolve(o.output),
        ...(bbox ? { bbox: bbox as [number, number, number, number] } : {}),
        ...(o.seed ? { seed: Number(o.seed) } : {}),
        ...(o.name ? { name: String(o.name) } : {}),
        ...(o['cell-zoom'] !== undefined ? { cellZoom: Number(o['cell-zoom']) } : {}),
        ...(config.inferRoofs !== undefined ? { inferRoofs: Boolean(config.inferRoofs) } : {}),
        ...(config.ruleTrees !== undefined ? { ruleTrees: Boolean(config.ruleTrees) } : {}),
        ...(config.details !== undefined ? { details: Boolean(config.details) } : {}),
        ...(config.landscape !== undefined ? { landscape: Boolean(config.landscape) } : {}),
        resume: Boolean(o.resume),
        concurrency,
        ...(signal ? { signal } : {}),
        onProgress: (p) => stderr.write(`${JSON.stringify({ type: 'progress', ...p })}\n`),
      });
      return ok({
        artifacts: [
          path.join(output, 'tileset.json'),
          path.join(output, 'coverage.bin'),
          path.join(output, 'report.json'),
        ],
        diagnostics: report.diagnostics,
        report: { counts: report.counts, tiles: report.tiles, fallbacks: report.fallbacks.length },
      });
    }
    if (command === 'validate') {
      if (!target) throw Object.assign(new Error('city tiles validate <dir>'), { code: 'OPTION_MISSING' });
      const v = await validateTilesetDir(resolve(target));
      return {
        ...ok({ diagnostics: v.diagnostics, tiles: v.tiles, bytes: v.bytes, gzipBytes: v.gzipBytes }),
        status: v.valid ? 'succeeded' : 'failed',
      };
    }
    if (command === 'inspect') {
      if (!target || !o.tile)
        throw Object.assign(new Error('city tiles inspect <dir> --tile z/x/y'), { code: 'OPTION_MISSING' });
      return ok({ tile: await inspectTile(resolve(target), String(o.tile)) });
    }
    if (command === 'serve') {
      if (!target) throw Object.assign(new Error('city tiles serve <dir>'), { code: 'OPTION_MISSING' });
      const server = await serveTiles(resolve(target), { port: o.port ? Number(o.port) : 4181 });
      stderr.write(`Serving ${resolve(target)} at ${server.url} (loopback only, Ctrl+C to stop)\n`);
      return { ...ok({ url: server.url, artifacts: [`${server.url}/tileset.json`] }), server };
    }
    if (command === 'pack')
      throw Object.assign(new Error('city tiles pack arrives with the single-file archive in M3 (WP-F).'), {
        code: 'TILES_PACK_UNAVAILABLE',
      });
    throw Object.assign(new Error(`Unknown tiles command ${command}.`), {
      code: 'UNKNOWN_COMMAND',
      hint: 'Run city tiles --help.',
    });
  } catch (error) {
    return fail(error, command ?? 'cli');
  }
}

function fail(error: unknown, stage: string): TilesCLIResult {
  const e = error as Error & { code?: string; hint?: string; diagnostics?: Diagnostic[]; name?: string };
  const d: Diagnostic = { code: e.code ?? 'TILES_FAILED', stage, message: e.message };
  if (e.hint) d.hint = e.hint;
  return {
    schemaVersion: 1,
    status: e.name === 'AbortError' ? 'cancelled' : 'failed',
    artifacts: [],
    diagnostics: [d, ...(e.diagnostics ?? [])],
  };
}
