// Isolate the shipped browser Worker's decode, generation and feature-record time, without map rendering.
// Usage: CITY_DEMO_DIST=apps/demo/dist node scripts/benchmark-tiles/browser-worker-measure.mjs <sample> [runs]
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const [sample, rawRuns = '5'] = process.argv.slice(2);
const runs = Number(rawRuns);
assert.ok(sample && Number.isInteger(runs) && runs > 0, 'Provide a tileset name and a positive run count');
const dist = process.env.CITY_DEMO_DIST ?? fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url));
const dir = path.join(dist, 'tiles', sample);
const tileset = JSON.parse(await readFile(path.join(dir, 'tileset.json'), 'utf8'));
const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
const keys = Object.keys(report.hashes).filter((k) => k.startsWith(tileset.levels.at(-1).zoom + '/'));
assert.ok(keys.length, 'Expected at least one L1 tile');
const workerFile = (await readdir(path.join(dist, 'assets'))).find((k) => /^worker-.*\.js$/.test(k));
assert.ok(workerFile, 'Build the demo first');
const options = { seed: tileset.build?.seed ?? 1, inferRoofs: Boolean(tileset.build?.options?.inferRoofs) };

// This function runs inside the actual browser. All requests are serialized through one module worker.
async function measure(workerFile, sample, keys, options, runs) {
  const worker = new Worker('assets/' + workerFile, { type: 'module' });
  const rows = [];
  let job = 0;
  const issue = async (bytes) => {
    const buffer = bytes.slice(0);
    return new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message));
      worker.onmessage = ({ data }) => {
        if (data.type === 'error') reject(new Error(data.diagnostic.message));
        else resolve(data.decodeMs + data.generateMs);
      };
      worker.postMessage({ type: 'generate', job: ++job, options, buffer }, [buffer]);
    });
  };
  try {
    const inputs = await Promise.all(
      keys.map(async (key) => {
        const res = await fetch('tiles/' + sample + '/' + key);
        if (!res.ok) throw new Error(res.status + ' ' + key);
        return res.arrayBuffer();
      }),
    );
    for (const bytes of inputs) await issue(bytes);
    for (const [i, bytes] of inputs.entries()) {
      const ms = [];
      for (let r = 0; r < runs; r++) ms.push(await issue(bytes));
      ms.sort((a, b) => a - b);
      rows.push({ tile: keys[i], ms, median: ms[Math.floor(ms.length / 2)] });
    }
    return rows;
  } finally {
    worker.terminate();
  }
}
const page = await openPage(dist, 'benchmark.html');
try {
  const args = [workerFile, sample, keys, options, runs].map((v) => JSON.stringify(v)).join(',');
  const rows = await page.evaluate('(' + measure.toString() + ')(' + args + ')', { timeout: 300000 });
  const medians = rows.map((r) => r.median).sort((a, b) => a - b);
  const q = (p) => medians[Math.min(medians.length - 1, Math.floor(p * medians.length))];
  console.log(
    JSON.stringify({ browser: page.version.product, tileset: sample, runs, p50: q(0.5), p95: q(0.95), rows }),
  );
} finally {
  await page.close();
}
