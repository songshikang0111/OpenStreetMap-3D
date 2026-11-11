// Single-file ESM build of @city-ink/map (WP-D task D10). `three` stays external (import map or bundler);
// the decode/generate worker is emitted as its own chunk next to the entry and loaded on demand.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  publicDir: false,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./bundle', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    lib: {
      entry: fileURLToPath(new URL('./dist/index.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'city-map.js',
    },
    rollupOptions: { external: ['three', /^three\//] },
  },
  worker: { format: 'es', rollupOptions: { external: [] } },
});
