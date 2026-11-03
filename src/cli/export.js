import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access,cp,mkdir,rename,rm,readFile} from 'node:fs/promises';
import {CityError,safePath,checkAbort,atomicWrite} from '../data/common.js';
import {validateProject} from './tasks.js';

const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
/** Export a self-contained static viewer. No runtime CDN or local API dependency. */
export async function exportWeb(root,{signal,onProgress=()=>{},output='site'}={}) {
  if(output!=='site'&&!output.startsWith('exports/'))throw new CityError('EXPORT_PATH','export','Web output must be site or under exports/.');
  const source=await safePath(root,'dist');
  await access(path.join(source,'manifest.json'));
  const sdk=path.join(packageRoot,'dist-sdk/city-ink.js');
  try {await access(sdk);} catch {throw new CityError('SDK_BUNDLE_MISSING','export','The bundled Web SDK is missing.','Run npm run build in the toolchain before city export web.');}
  const staging=await safePath(root,`.city-cache/site-${crypto.randomUUID()}`,{allowMissing:true});
  await mkdir(path.join(staging,'assets'),{recursive:true});
  try {
    checkAbort(signal);onProgress({stage:'copy-scene',progress:0.1});
    await cp(source,path.join(staging,'scene'),{recursive:true,filter:file=>{checkAbort(signal);return !file.endsWith('city.build-lock.json');}});
    await cp(sdk,path.join(staging,'assets/city-ink.js'));
    await atomicWrite(path.join(staging,'index.html'),await readFile(path.join(packageRoot,'studio/static-viewer.html')),{signal});
    await atomicWrite(path.join(staging,'viewer.js'),await readFile(path.join(packageRoot,'studio/static-viewer.js')),{signal});
    const config=JSON.parse(await readFile(await safePath(root,'city.config.json'),'utf8'));
    await atomicWrite(path.join(staging,'viewer-config.json'),{style:config.style,quality:config.quality,camera:config.camera},{signal});
    checkAbort(signal);onProgress({stage:'publish-site',progress:0.9});
    const site=await safePath(root,output,{allowMissing:true}),backup=await safePath(root,'.city-cache/previous-site',{allowMissing:true});
    checkAbort(signal);await mkdir(path.dirname(site),{recursive:true});checkAbort(signal);
    await rm(backup,{recursive:true,force:true});let previous=false;
    try{await rename(site,backup);previous=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{checkAbort(signal);await rename(staging,site);}catch(error){if(previous)await rename(backup,site);throw error;}
    await rm(backup,{recursive:true,force:true});
    return {schemaVersion:1,status:'succeeded',artifacts:[`${output}/index.html`],diagnostics:[],scope:'complete-area',attribution:'© OpenStreetMap contributors; ODbL'};
  }finally{await rm(staging,{recursive:true,force:true});}
}
export async function exportProject(root,options={}) {
  await validateProject(root);checkAbort(options.signal);
  if(options.format==='web')return exportWeb(root,options);
  // The browser-backed PNG/GLB adapter is loaded only for image/asset export.
  const {exportInBrowser}=await import('./browser-export.js');
  return exportInBrowser(root,options);
}
