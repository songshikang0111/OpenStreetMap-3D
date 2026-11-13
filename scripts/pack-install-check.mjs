// AC1006: pack every workspace package, install the tarballs in an empty directory outside the repository, build a
// small tileset with @city-ink/builder and show it with a minimal createMap page (bundled by Vite, opened in Chrome).
// Needs network access to the npm registry (or a warm cache) for three and vite. Nothing is published.
// Usage: node scripts/pack-install-check.mjs [--keep]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './benchmark-tiles/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(path.join(os.tmpdir(), 'city-ink-pack-'));
const npm = (args, cwd) =>
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
const result = { work };
try {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '-b',
      ...['tiles', 'generators', 'builder', 'map', 'styles-ink', 'details'].map((p) => path.join(root, 'packages', p)),
    ],
    { stdio: 'inherit' },
  );
  execFileSync(process.execPath, [path.join(root, 'scripts/vendor-phase1.mjs')], { stdio: 'ignore' });
  const tgz = path.join(work, 'tgz');
  mkdirSync(tgz);
  for (const p of ['tiles', 'generators', 'builder', 'map', 'styles', 'styles-ink', 'details', 'landmarks'])
    npm(['pack', '--ignore-scripts', '--pack-destination', tgz], path.join(root, 'packages', p));
  const app = path.join(work, 'app');
  mkdirSync(app);
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'pack-check', private: true, type: 'module' }));
  npm(
    ['install', '--ignore-scripts', ...readdirSync(tgz).map((f) => path.join(tgz, f)), 'three@0.186.1', 'vite@6.4.5'],
    app,
  );
  cpSync(path.join(root, 'public/data/bibury-village.json'), path.join(app, 'area.json'));
  writeFileSync(
    path.join(app, 'build.mjs'),
    "import { buildTiles } from '@city-ink/builder';\nconst { report } = await buildTiles({ input: './area.json', output: './public/tiles/area' });\nconsole.log(Object.keys(report.hashes).length);\n",
  );
  result.tiles = Number(execFileSync(process.execPath, ['build.mjs'], { cwd: app, encoding: 'utf8' }).trim());
  writeFileSync(
    path.join(app, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#map{position:absolute;inset:0}</style></head><body><div id="map"></div><script type="module" src="./main.js"></script></body></html>',
  );
  writeFileSync(
    path.join(app, 'main.js'),
    "import { createMap } from '@city-ink/map';\nconst map = await createMap({ container: document.getElementById('map'), tiles: './tiles/area/tileset.json', pitch: 55 });\nconst el = document.createElement('div');\nel.style.cssText = 'width:12px;height:12px;background:#e2482d;border-radius:50%';\nmap.addMarker({ lngLat: map.getCenter(), element: el });\nglobalThis.cityMap = map;\n",
  );
  writeFileSync(
    path.join(app, 'vite.config.js'),
    "export default { base: './', worker: { format: 'es' }, build: { target: 'es2022' } };\n",
  );
  execFileSync(process.execPath, [path.join(app, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: app,
    stdio: 'ignore',
  });
  const page = await openPage(path.join(app, 'dist'), 'index.html');
  try {
    await page.waitFor('!!globalThis.cityMap', 30000);
    await page.evaluate('cityMap.whenIdle({ timeoutMs: 60000 })');
    const s = await page.evaluate('JSON.stringify(cityMap.getStats())').then(JSON.parse);
    result.visibleTiles = s.tiles.visible;
    result.consoleErrors = page.events.filter((e) => e.level === 'error').length;
  } finally {
    await page.close();
  }
  result.pass = result.tiles > 0 && result.visibleTiles > 0 && result.consoleErrors === 0;
} catch (error) {
  result.pass = false;
  result.error = String(error.stderr ?? error.message ?? error).slice(0, 2000);
} finally {
  if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
