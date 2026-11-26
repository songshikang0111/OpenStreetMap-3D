import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Bind benchmark reports to the code and data shipped with this static build (also works on HTTP LAN hosts).
const tileDir = root + 'public/tiles/';
const hashes = {};
for (const name of existsSync(tileDir) ? readdirSync(tileDir) : []) {
  const report = tileDir + name + '/report.json';
  if (existsSync(report)) hashes[name] = createHash('sha256').update(readFileSync(report)).digest('hex');
}
let revision = 'unknown';
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  /* source archive */
}

// Static demo site: `base: './'` keeps it working from any sub-path (AC1004).
export default defineConfig({
  root,
  base: './',
  define: { __SDK_COMMIT__: JSON.stringify(revision), __TILE_HASHES__: JSON.stringify(hashes) },
  resolve: {
    alias: {
      '@city-ink/map/maplibre': fileURLToPath(new URL('../../packages/map/dist/maplibre/index.js', import.meta.url)),
      '@city-ink/map': fileURLToPath(new URL('../../packages/map/dist/index.js', import.meta.url)),
      '@city-ink/styles-ink': fileURLToPath(new URL('../../packages/styles-ink/dist/index.js', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        benchmark: root + 'benchmark.html',
        main: root + 'index.html',
        overlays: root + 'overlays.html',
        maplibre: root + 'maplibre.html',
      },
    },
  },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true },
});
