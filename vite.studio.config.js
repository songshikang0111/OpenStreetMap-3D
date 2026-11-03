import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./studio',import.meta.url)),base:'./',publicDir:false,build:{target:'es2022',outDir:'dist',emptyOutDir:true}});
