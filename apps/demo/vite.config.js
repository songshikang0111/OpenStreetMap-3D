import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Static demo site: `base: './'` keeps it working from any sub-path (AC1004).
export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: { '@city-ink/map': fileURLToPath(new URL('../../packages/map/dist/index.js', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true },
});
