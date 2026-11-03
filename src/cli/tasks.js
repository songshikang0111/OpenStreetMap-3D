import path from 'node:path';
import { mkdir, rename, rm, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CityError, atomicWrite, checkAbort, hash, readJSON, safePath, relativeFile } from '../data/common.js';
import { normalizeOSM } from '../data/normalize.js';
import { fetchArea } from '../data/overpass.js';
import { readProject } from './project.js';
import { projectRecipes, updateLandmarks } from './landmarks.js';

export async function loadCore() {
  try { return await import('../core/index.js'); }
  catch (e) { throw new CityError('CORE_UNAVAILABLE','build',`Core compiler could not load: ${e.message}`,'Integrate task A src/core before building.'); }
}
async function engineFingerprint() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entries=[];
  async function visit(dir) {
    for (const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink()) continue;
      const file=path.join(dir,item.name);
      if (item.isDirectory()) await visit(file);
      else if (/\.(js|json)$/.test(item.name)) entries.push([path.relative(root,file).replaceAll('\\','/'),hash(await readFile(file))]);
    }
  }
  await visit(root); return hash(entries);
}
export async function buildProject(root, { signal, onProgress = () => {}, core, landmarkRegistry } = {}) {
  const config = await readProject(root);
  core ||= await loadCore();
  const validation = await core.validateProjectConfig(config);
  if (validation === false || validation?.valid === false) throw new CityError('INVALID_CONFIG','build','Core rejected project configuration.');
  const sourcePath = await safePath(root,config.source.file);
  const raw = normalizeOSM(await readJSON(sourcePath),{area:config.area,origin:config.origin,name:config.name});
  const recipes = await projectRecipes(root,config);
  if (recipes.length && !landmarkRegistry) {
    const registry = await import('../landmark-registry.js');
    landmarkRegistry = registry.createLandmarkRegistry({overrides:recipes});
  }
  const previous = await readJSON(path.join(root,'city.lock.json'));
  const inputs = {configHash:hash(config), dataHash:raw.contentHash, sourceFileHash:hash(await readFile(sourcePath)), engineHash:await engineFingerprint(), recipeHash:hash(recipes), styleHash:hash(config.style)};
  checkAbort(signal); onProgress({stage:'compile',progress:0});
  const result = await core.compileScene(raw.raw,config,{signal,onProgress,landmarkRegistry});
  checkAbort(signal);
  const valid = await core.validateSceneManifest(result.manifest);
  if (valid === false || valid?.valid === false) throw new CityError('INVALID_MANIFEST','build','Compiler produced an invalid manifest.');
  const staging = await safePath(root,`.city-cache/build-${crypto.randomUUID()}`,{allowMissing:true});
  await mkdir(staging,{recursive:true});
  const assetHashes={};
  try {
    const entries = result.assets instanceof Map ? [...result.assets] : Object.entries(result.assets || {});
    for (const [relative, bytes] of entries) {
      relativeFile(relative);
      if (relative === 'manifest.json') throw new CityError('ASSET_COLLISION','pack','Compiler assets must not replace manifest.json.');
      if (!(typeof bytes === 'string' || bytes instanceof Uint8Array)) throw new CityError('INVALID_ASSET','pack',`Invalid asset ${relative}.`);
      await atomicWrite(await safePath(staging,relative,{allowMissing:true}),bytes,{signal}); assetHashes[relative]=hash(bytes);
    }
    await atomicWrite(path.join(staging,'manifest.json'),result.manifest,{signal});
    if(!assetHashes['report.json'])await atomicWrite(path.join(staging,'report.json'),result.report||{diagnostics:[]},{signal});
    const contentHash=hash({manifest:result.manifest, assets:assetHashes});
    const lock={...previous,schemaVersion:1,inputs,contentHash,assetHashes,manifestHash:hash(result.manifest),history:previous.inputs && hash(previous.inputs)!==hash(inputs) ? [...(previous.history||[]),previous.inputs] : previous.history||[], build:{builtAt:new Date().toISOString(),report:result.report}};
    delete lock.pendingRebuild;
    // The scene and its lock travel as one generation; root lock is refreshed after publication.
    await atomicWrite(path.join(staging,'city.build-lock.json'),lock,{signal});
    checkAbort(signal); onProgress({stage:'publish',progress:0.95});
    const dist=await safePath(root,'dist',{allowMissing:true}), backup=await safePath(root,'.city-cache/previous-dist',{allowMissing:true});
    await rm(backup,{recursive:true,force:true});
    let backedUp=false;
    try { await rename(dist,backup); backedUp=true; } catch(e) { if(e.code!=='ENOENT') throw e; }
    try { await rename(staging,dist); }
    catch(e) { if(backedUp) await rename(backup,dist); throw e; }
    await atomicWrite(path.join(root,'city.lock.json'),lock);
    await rm(backup,{recursive:true,force:true});
    return {schemaVersion:1,status:'succeeded',artifacts:['dist/manifest.json','city.lock.json'],diagnostics:[...raw.diagnostics,...(result.report?.diagnostics||[])],contentHash,report:result.report};
  } finally { await rm(staging,{recursive:true,force:true}); }
}
export async function validateProject(root, {core}={}) {
  const config=await readProject(root), lock=await readJSON(path.join(root,'city.lock.json'));
  const data=normalizeOSM(await readJSON(await safePath(root,config.source.file)),{area:config.area,origin:config.origin,name:config.name});
  const manifest=await readJSON(await safePath(root,'dist/manifest.json'));
  core ||= await loadCore(); const valid=await core.validateSceneManifest(manifest);
  if(valid===false||valid?.valid===false) throw new CityError('INVALID_MANIFEST','validate','Invalid scene manifest.');
  const recipes=await projectRecipes(root,config);
  if(lock.inputs?.configHash!==hash(config)||lock.inputs.dataHash!==data.contentHash||lock.inputs.recipeHash!==hash(recipes)||lock.inputs.sourceFileHash!==hash(await readFile(await safePath(root,config.source.file)))) throw new CityError('STALE_BUILD','validate','Project inputs differ from the build lock.','Run city build.');
  if(lock.manifestHash!==hash(manifest)) throw new CityError('CORRUPT_MANIFEST','validate','Manifest differs from build lock.');
  for(const [file,expected] of Object.entries(lock.assetHashes||{})) if(hash(await readFile(await safePath(root,`dist/${file}`)))!==expected) throw new CityError('CORRUPT_ASSET','validate',`Asset hash mismatch: ${file}.`);
  return {schemaVersion:1,status:'succeeded',artifacts:['dist/manifest.json'],diagnostics:data.diagnostics};
}
export async function runProjectTask(kind, root, parameters={}, context={}) {
  const {signal,onProgress=()=>{}}=context;
  if(kind==='build') return buildProject(root,context);
  if(kind==='fetch') {
    const config=await readProject(root); onProgress({stage:'download',progress:0});
    const result=await fetchArea({area:config.area,origin:config.origin,name:config.name,cacheDir:await safePath(root,'.city-cache/data',{allowMissing:true}),...parameters,signal});
    await atomicWrite(await safePath(root,config.source.file,{allowMissing:true}),result.raw,{signal});
    return {schemaVersion:1,status:'succeeded',artifacts:[config.source.file],diagnostics:result.diagnostics,cacheHit:result.cacheHit,contentHash:result.contentHash};
  }
  if(kind==='update-landmarks') {
    const updated=await updateLandmarks(root,{...parameters,signal});
    const built=await buildProject(root,context); return {...built,packages:updated.packages};
  }
  if(kind==='export-web'||kind==='export-png'||kind==='export-glb') {
    // Integration owns concrete export implementations; no fallback demo generator.
    let exporter=context.exporter;
    if(!exporter) {
      try { exporter=(await import('./export.js')).exportProject; }
      catch(e) { throw new CityError('EXPORT_UNAVAILABLE','export',`Export adapter could not load: ${e.message}`,'Integrate the SDK and studio export adapter.'); }
    }
    return exporter(root,{...parameters,format:kind.slice(7),signal,onProgress});
  }
  throw new CityError('UNKNOWN_JOB','job',`Unsupported job kind: ${kind}.`);
}
