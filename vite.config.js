import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base:'./',
  build:{target:'es2022',rollupOptions:{input:{demo:fileURLToPath(new URL('./index.html',import.meta.url)),quickstart:fileURLToPath(new URL('./examples/quickstart/index.html',import.meta.url))},output:{manualChunks:{three:['three']}}}},
  server:{proxy:{'/api':'http://127.0.0.1:4178','/projects':'http://127.0.0.1:4178'}},
});
