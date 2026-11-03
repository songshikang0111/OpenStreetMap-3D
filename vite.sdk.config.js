import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  publicDir:false,
  build:{outDir:'dist-sdk',lib:{entry:fileURLToPath(new URL('./src/sdk/index.js',import.meta.url)),formats:['es'],fileName:()=> 'city-ink.js'},sourcemap:false},
});
