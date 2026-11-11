// WP-C AC301/AC302: build every phase-one sample (public/data with metadata.bbox) into tiles, validate, and record
// sizes. Also builds the phase-one 9-block benchmark areas of Beijing CBD and Kyoto Gion.
// Usage: node scripts/benchmark-tiles/build-samples.mjs <outDir> [--json summary.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'city-tiles-samples'));
const city = path.join(root, 'bin/city.js');
const run = (args) => {
  const t0 = performance.now();
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [city, 'tiles', ...args, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1 << 28,
    });
  } catch (error) {
    stdout = error.stdout;
  }
  return { ms: Math.round(performance.now() - t0), result: JSON.parse(stdout) };
};
const phase1 = (name) => {
  const j = JSON.parse(
    readFileSync(path.join(root, `docs/phase1-evidence/remediation/integration/performance/${name}.json`), 'utf8'),
  );
  const a = j.build.config.area;
  return {
    bbox: [a.west, a.south, a.east, a.north].join(','),
    packageBytes: j.build.packageBytes,
    features: j.build.features,
  };
};
const jobs = readdirSync(path.join(root, 'public/data'))
  .filter((f) => f.endsWith('.json'))
  .filter((f) => Array.isArray(JSON.parse(readFileSync(path.join(root, 'public/data', f), 'utf8')).metadata?.bbox))
  .map((f) => ({ name: f.replace(/\.json$/, ''), input: path.join(root, 'public/data', f) }));
jobs.push({
  name: 'beijing-cbd-grow-9',
  input: path.join(root, 'public/data/beijing-cbd.json'),
  ...phase1('beijing-cbd-grow-9'),
});
jobs.push({
  name: 'kyoto-gion-grow-9',
  input: path.join(root, 'public/data/kyoto-gion.json'),
  ...phase1('kyoto-gion-grow-9'),
});
const rows = [];
for (const job of jobs) {
  const dir = path.join(out, job.name);
  const build = run(['build', '--input', job.input, '--output', dir, ...(job.bbox ? ['--bbox', job.bbox] : [])]);
  const validate = run(['validate', dir]);
  const report =
    build.result.status === 'succeeded' ? JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')) : null;
  const row = {
    name: job.name,
    build: build.result.status,
    buildMs: build.ms,
    validate: validate.result.status,
    validateDiagnostics: validate.result.diagnostics?.map((d) => d.code) ?? [],
    tiles: validate.result.tiles,
    gzipBytes: validate.result.gzipBytes,
    rawBytes: validate.result.bytes,
    counts: report?.counts,
    levels: report?.tiles.map(({ overBudget, ...t }) => ({ ...t, overBudget: overBudget.map((o) => o.tile) })),
    fallbacks: report?.fallbacks.length,
    buildDiagnostics: build.result.diagnostics?.map((d) => d.code) ?? [],
  };
  if (job.packageBytes) Object.assign(row, { phase1PackageBytes: job.packageBytes, bbox: job.bbox });
  rows.push(row);
  console.log(
    `${job.name.padEnd(24)} ${row.build}/${row.validate} ${String(row.tiles).padStart(4)} tiles  ${(row.gzipBytes / 1048576).toFixed(2).padStart(6)} MB gzip  ${(row.buildMs / 1000).toFixed(1).padStart(6)} s  L1 median ${((row.levels?.[1]?.medianGzipBytes ?? 0) / 1024).toFixed(0)} KB p95 ${((row.levels?.[1]?.p95GzipBytes ?? 0) / 1024).toFixed(0)} KB max ${((row.levels?.[1]?.maxGzipBytes ?? 0) / 1024).toFixed(0)} KB ${row.validateDiagnostics.join(',')}`,
  );
}
const summary = {
  date: new Date().toISOString(),
  machine: {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
  },
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  rows,
};
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(summary, null, 2) + '\n');
