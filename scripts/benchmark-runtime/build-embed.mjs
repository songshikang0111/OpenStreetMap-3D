import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
const outDir=path.resolve(process.argv[2]||'work/runtime-embed');
await build({configFile:false,root:process.cwd(),base:'./',build:{outDir,emptyOutDir:true,rollupOptions:{input:path.resolve('examples/embed/index.html')}}});
const scene=process.argv[3]||'core-synthetic-fixed-4';
await fs.cp(path.resolve('work/runtime-fixtures',scene),path.join(outDir,'examples/scenes',scene),{recursive:true});
console.log(JSON.stringify({outDir,entry:'examples/embed/index.html',query:`?manifest=../scenes/${scene}/manifest.json`}));
