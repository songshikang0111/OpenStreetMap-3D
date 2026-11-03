import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, cp, rm, rename, readFile } from 'node:fs/promises';
import { CityError, safePath, atomicWrite, checkAbort, readJSON } from '../data/common.js';
import { validateProject } from './tasks.js';

export async function exportProject(root,{format='web',output,signal,onProgress=()=>{}}={}){
  await validateProject(root);checkAbort(signal);
  if(format==='web')return exportWeb(root,{output:output||'site',signal,onProgress});
  if(format==='glb')return exportGLB(root,{output:output||'exports/city.glb',signal});
  if(format==='png')return exportPNG(root,{output:output||'exports/city.png',signal});
  throw new CityError('UNSUPPORTED_EXPORT','export',`Unsupported format ${format}.`);
}
async function publishDirectory(staging,target,backup){
  await rm(backup,{recursive:true,force:true});let saved=false;
  try{await rename(target,backup);saved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await rename(staging,target);}catch(e){if(saved)await rename(backup,target);throw e;}
  await rm(backup,{recursive:true,force:true});
}
async function exportWeb(root,{output,signal,onProgress}){
  if(!['site'].includes(output)&&!output.startsWith('exports/'))throw new CityError('EXPORT_PATH','export','Web output must be site or under exports/.');
  const target=await safePath(root,output,{allowMissing:true});
  const staging=await safePath(root,`.city-cache/web-${crypto.randomUUID()}`,{allowMissing:true});
  const source=path.join(staging,'entry'),out=path.join(staging,'out');await mkdir(source,{recursive:true});
  try{
    const sdk=fileURLToPath(new URL('../sdk/index.js',import.meta.url)).replaceAll('\\','/');
    await readFile(sdk).catch(()=>{throw new CityError('SDK_UNAVAILABLE','export','Web SDK is missing.','Integrate task D before exporting.');});
    const config=await readJSON(path.join(root,'city.config.json'));
    await atomicWrite(path.join(source,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Ink</title><style>html,body,#city{margin:0;width:100%;height:100%}#credit{position:fixed;bottom:6px;right:6px;background:#fffd;padding:4px;font:12px sans-serif;z-index:2}</style></head><body><div id="city"></div><div id="credit">© OpenStreetMap contributors · ODbL</div><script type="module" src="./viewer.js"></script></body></html>');
    await atomicWrite(path.join(source,'viewer.js'),`import { createCityViewer } from ${JSON.stringify(sdk)};\nconst viewer=await createCityViewer({container:document.querySelector('#city'),manifestUrl:new URL('./scene/manifest.json',document.baseURI).href,style:${JSON.stringify(config.style.id)},quality:${JSON.stringify(config.quality)}});\nwindow.cityViewer=viewer;\nawait viewer.load();\nwindow.cityReady=true;`);
    const {build}=await import('vite');
    onProgress({stage:'bundle',progress:0.2});
    await build({configFile:false,root:source,base:'./',logLevel:'error',build:{outDir:out,emptyOutDir:true}});
    checkAbort(signal);await cp(await safePath(root,'dist'),path.join(out,'scene'),{recursive:true,filter:file=>!file.endsWith('city.build-lock.json')});
    await atomicWrite(path.join(out,'EXPORT-NOTES.txt'),'Self-contained City Ink viewer. Serve this directory using any static HTTP server. OSM data: © OpenStreetMap contributors, ODbL-1.0. Source JSON and caches are excluded.');
    checkAbort(signal);onProgress({stage:'publish',progress:0.95});
    await publishDirectory(out,target,await safePath(root,'.city-cache/previous-site',{allowMissing:true}));
    return {schemaVersion:1,status:'succeeded',artifacts:[`${output}/index.html`],diagnostics:[]};
  }finally{await rm(staging,{recursive:true,force:true});}
}
async function exportGLB(root,{output,signal}){
  if(!output.startsWith('exports/')||!output.endsWith('.glb'))throw new CityError('EXPORT_PATH','export','GLB output must be exports/*.glb.');
  const {decodeChunk}=await import('../core/scene-codec.js');
  const {Group}=await import('three');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
  const manifest=await readJSON(await safePath(root,'dist/manifest.json'));const group=new Group();
  for(const chunk of manifest.chunks){
    checkAbort(signal);
    const lods=Array.isArray(chunk.lods)?chunk.lods:Object.values(chunk.lods);
    const descriptor=[...lods].sort((a,b)=>(b.triangles||0)-(a.triangles||0))[0];
    if(!descriptor?.uri)throw new CityError('INVALID_MANIFEST','export',`No geometry for chunk ${chunk.id}.`);
    const bytes=await readFile(await safePath(root,`dist/${descriptor.uri}`));
    const decoded=await decodeChunk(JSON.parse(bytes.toString('utf8')),descriptor);
    if(chunk.transform?.position)decoded.position.fromArray(chunk.transform.position);
    else if(Array.isArray(chunk.transform)&&chunk.transform.length===16){decoded.matrix.fromArray(chunk.transform);decoded.matrix.decompose(decoded.position,decoded.quaternion,decoded.scale);}
    group.add(decoded);
  }
  const original=globalThis.FileReader;
  if(!original)globalThis.FileReader=class {
    readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();},error=>this.onerror?.(error));}
    readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();},error=>this.onerror?.(error));}
  };
  try{
    const bytes=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:false});checkAbort(signal);
    await atomicWrite(await safePath(root,output,{allowMissing:true}),new Uint8Array(bytes),{signal});
    return {schemaVersion:1,status:'succeeded',artifacts:[output],diagnostics:[{code:'GLB_MATERIAL_LIMITS',stage:'export',message:'Full region at highest available geometry detail; standard materials only. Procedural windows and postprocessing are not portable GLB effects.',hint:'Use export web for the complete style pipeline.'}]};
  }finally{if(!original)delete globalThis.FileReader;group.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();});}
}
async function exportPNG(root,{output,signal}){
  if(!output.startsWith('exports/')||!output.endsWith('.png'))throw new CityError('EXPORT_PATH','export','PNG output must be exports/*.png.');
  let chromium;try{({chromium}=await import('playwright'));}catch{throw new CityError('BROWSER_UNAVAILABLE','export','PNG export requires Playwright and Chromium.','Install playwright and run npx playwright install chromium, then retry.');}
  await exportWeb(root,{output:'exports/png-viewer',signal,onProgress:()=>{}});
  const {createLocalServer}=await import('../local-server/index.js');
  const server=await createLocalServer({projectRoot:root,port:0,sample:false});
  let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const project=[...server.projects.values()][0];
    // The server exposes only dist/site. A dedicated static preview avoids exposing source data.
    const {createServer}=await import('vite');const preview=await createServer({configFile:false,root:path.join(root,'exports/png-viewer'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await preview.listen();
    try{
      await page.goto(preview.resolvedUrls.local[0]);await page.waitForFunction(()=>window.cityReady===true,{timeout:60000});
      // Load the whole region before capture when supported; never claim partial view is the full region.
      await page.evaluate(async()=>{await window.cityViewer.load();});checkAbort(signal);
      await page.screenshot({path:await safePath(root,output,{allowMissing:true})});
    }finally{await preview.close();}
    return {schemaVersion:1,status:'succeeded',artifacts:[output],diagnostics:[{code:'PNG_VIEW_SCOPE',stage:'export',message:'1280×720 default SDK overview with visible-region streaming and OSM attribution.',hint:'Use GLB for complete-region geometry.'}]};
  }finally{await browser?.close();await server.close();}
}
