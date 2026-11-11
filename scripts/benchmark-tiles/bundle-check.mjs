// WP-D AC414: builds the single-file ESM bundle, checks its minified size without three.js, and loads it from a plain
// <script type="module"> page with an import map in Chrome/Edge.
// Prerequisites: npm run build:packages && npm run demo:tiles. Usage: node scripts/benchmark-tiles/bundle-check.mjs [--json out.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    path.join(root, 'packages/map/vite.config.js'),
  ],
  { stdio: 'ignore' },
);
const bundle = path.join(root, 'packages/map/bundle');
const main = readFileSync(path.join(bundle, 'city-map.js'));
const workerFile = readdirSync(path.join(bundle, 'assets')).find((f) => f.startsWith('worker'));
const worker = readFileSync(path.join(bundle, 'assets', workerFile));
const importsThree = /from\s*["']three["']/.test(main.toString());
const limit = 180 * 1024;
const page = await openPage(root, 'test/browser/bundle.html');
let loaded = null;
try {
  try {
    await page.waitFor('!!globalThis.bundleCheck', 90000);
  } catch (e) {
    console.log(JSON.stringify(page.events.slice(0, 5)));
    throw e;
  }
  loaded = await page.evaluate('globalThis.bundleCheck');
} finally {
  await page.close();
}
const summary = {
  date: new Date().toISOString(),
  main: {
    file: 'city-map.js',
    minifiedBytes: main.length,
    gzipBytes: gzipSync(main).length,
    threeExternal: importsThree,
  },
  worker: {
    file: workerFile,
    bytes: statSync(path.join(bundle, 'assets', workerFile)).size,
    gzipBytes: gzipSync(worker).length,
    note: 'separate chunk, loaded on demand; contains three.js math, generators and the shared phase-one building code',
  },
  limitBytes: limit,
  scriptTypeModule: { visibleTiles: loaded?.tiles.visible ?? 0, drawCalls: loaded?.drawCalls ?? 0 },
  pass: main.length <= limit && importsThree && (loaded?.tiles.visible ?? 0) > 0,
};
console.log(
  `${summary.pass ? 'PASS' : 'FAIL'} AC414 main ${main.length} B (${summary.main.gzipBytes} B gzip), worker ${worker.length} B; page shows ${summary.scriptTypeModule.visibleTiles} tiles`,
);
const at = process.argv.indexOf('--json');
if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2) + '\n');
if (!summary.pass) process.exitCode = 1;
