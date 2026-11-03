import path from 'node:path';
import { mkdir, rename, rm, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CityError, atomicWrite, checkAbort, hash, readJSON, safePath, relativeFile } from '../data/common.js';
import { normalizeOSM } from '../data/normalize.js';
import { fetchArea } from '../data/overpass.js';
import { dataSourceOverrides } from '../data/source.js';
import { readProject } from './project.js';
import { projectRecipes, updateLandmarks } from './landmarks.js';

export async function loadCore() {
  try { return await import('../core/index.js'); }
  catch (e) { throw new CityError('CORE_UNAVAILABLE','build',`Core compiler could not load: ${e.message}`,'Integrate task A src/core before building.'); }
}
// Viewer settings are saved with the project, but do not alter scene geometry.
// Keep the complete configHash in the lock for provenance and race detection.
export function buildConfigHash({camera,style,quality,...geometryConfig}) {return hash(geometryConfig);}
async function engineFingerprint() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entries=[];
  async function visit(dir) {
    for (const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink()) continue;
      if(dir===root&&['cli','data','local-server','runtime','sdk'].includes(item.name))continue;
      const file=path.join(dir,item.name);
      if (item.isDirectory()) await visit(file);
      else if (/\.(js|json)$/.test(item.name)&&item.name!=='main.js') entries.push([path.relative(root,file).replaceAll('\\','/'),hash((await readFile(file,'utf8')).replaceAll('\r\n','\n'))]);
    }
  }
  await visit(root);
  await visit(fileURLToPath(new URL('../../packages/',import.meta.url)));
  const packageInfo=await readJSON(new URL('../../package.json',import.meta.url));
  return hash({sources:entries,dependencies:packageInfo.dependencies});
}
export async function buildProject(root, { signal, onProgress = () => {}, core, landmarkRegistry } = {}) {
  await recoverBuildPublication(root);
  const config = await readProject(root);
  core ||= await loadCore();
  const compileConfig=config;
  const validation = await core.validateProjectConfig(compileConfig);
  if (validation === false || validation?.valid === false) throw new CityError('INVALID_CONFIG','build','Core rejected project configuration.');
  const sourcePath = await safePath(root,config.source.file);
  const sourceBytes=await readFile(sourcePath);
  const raw = normalizeOSM(JSON.parse(sourceBytes.toString('utf8')),{area:config.area,origin:config.origin,name:config.name});
  const recipes = await projectRecipes(root,config);
  if (recipes.length && !landmarkRegistry) {
    const registry = await import('../landmark-registry.js');
    landmarkRegistry = registry.createLandmarkRegistry({overrides:Object.fromEntries(recipes.map(recipe=>[recipe.id,recipe]))});
  }
  const previous = await readJSON(path.join(root,'city.lock.json'));
  if(previous.pendingRebuild?.next&&hash(previous.pendingRebuild.next)!==hash(config.landmarks.packages))throw new CityError('LANDMARK_UPDATE_INCOMPLETE','build','Landmark configuration and pending lock transaction differ.','Repeat the explicit landmark update or roll it back before building.');
  const inputs = {configHash:hash(config), buildConfigHash:buildConfigHash(config), dataHash:raw.contentHash, sourceFileHash:hash(sourceBytes), engineHash:await engineFingerprint(), recipeHash:hash(recipes), styleHash:hash(config.style)};
  checkAbort(signal); onProgress({stage:'compile',progress:0});
  const result = await core.compileScene(raw.raw,compileConfig,{signal,onProgress,landmarkRegistry});
  if(hash(await readFile(sourcePath))!==inputs.sourceFileHash||hash(await readProject(root))!==inputs.configHash)throw new CityError('INPUT_CHANGED','build','Project input changed while compiling.','Wait for edits to finish and build again.');
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
  await recoverBuildPublication(root);
  const config=await readProject(root), lock=await readJSON(path.join(root,'city.lock.json'));
  const data=normalizeOSM(await readJSON(await safePath(root,config.source.file)),{area:config.area,origin:config.origin,name:config.name});
  const manifest=await readJSON(await safePath(root,'dist/manifest.json'));
  core ||= await loadCore(); const valid=await core.validateSceneManifest(manifest);
  if(valid===false||valid?.valid===false) throw new CityError('INVALID_MANIFEST','validate','Invalid scene manifest.');
  const recipes=await projectRecipes(root,config);
  const configChanged=lock.inputs?.buildConfigHash?lock.inputs.buildConfigHash!==buildConfigHash(config):lock.inputs?.configHash!==hash(config);
  if(configChanged||lock.inputs.dataHash!==data.contentHash||lock.inputs.recipeHash!==hash(recipes)||lock.inputs.sourceFileHash!==hash(await readFile(await safePath(root,config.source.file)))) throw new CityError('STALE_BUILD','validate','Project geometry inputs differ from the build lock.','Run city build after changing area, seed, tiling, generation or recipes.');
  if(lock.inputs.engineHash!==await engineFingerprint())throw new CityError('STALE_ENGINE','validate','Generator or dependency sources differ from the locked build.','Rebuild explicitly with the installed engine.');
  if(lock.manifestHash!==hash(manifest)) throw new CityError('CORRUPT_MANIFEST','validate','Manifest differs from build lock.');
  for(const [file,expected] of Object.entries(lock.assetHashes||{})) if(hash(await readFile(await safePath(root,`dist/${file}`)))!==expected) throw new CityError('CORRUPT_ASSET','validate',`Asset hash mismatch: ${file}.`);
  return {schemaVersion:1,status:'succeeded',artifacts:['dist/manifest.json'],diagnostics:data.diagnostics};
}
export async function recoverBuildPublication(root){
  const dist=await safePath(root,'dist',{allowMissing:true}),backup=await safePath(root,'.city-cache/previous-dist',{allowMissing:true});
  let manifest;
  try{manifest=await readJSON(path.join(dist,'manifest.json'));}
  catch(e){
    if(e.code!=='ENOENT')throw e;
    try{await readJSON(path.join(backup,'manifest.json'));await rename(backup,dist);manifest=await readJSON(path.join(dist,'manifest.json'));}
    catch(e){if(e.code==='ENOENT')return;throw e;}
  }
  let embedded;
  try{embedded=await readJSON(path.join(dist,'city.build-lock.json'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  const current=await readJSON(path.join(root,'city.lock.json'));
  if(current.contentHash===embedded.contentHash)return;
  if(hash(manifest)!==embedded.manifestHash)throw new CityError('CORRUPT_MANIFEST','recovery','Published manifest does not match its generation lock.');
  for(const [file,expected]of Object.entries(embedded.assetHashes||{}))if(hash(await readFile(await safePath(dist,file)))!==expected)throw new CityError('CORRUPT_ASSET','recovery',`Published asset is corrupt: ${file}.`);
  await atomicWrite(path.join(root,'city.lock.json'),{...embedded,...(current.landmarkHistory?{landmarkHistory:current.landmarkHistory}:{}),...(current.pendingRebuild?{pendingRebuild:current.pendingRebuild}:{})});
}
export async function runProjectTask(kind, root, parameters={}, context={}) {
  const {signal,onProgress=()=>{}}=context;
  if(kind==='build') return buildProject(root,context);
  if(kind==='fetch') {
    const config=await readProject(root); onProgress({stage:'download',progress:0});
    for(const key of Object.keys(parameters))if(!['endpoint','transport','fallbackEndpoints','fallbackPolicy','refresh','offline'].includes(key))throw new CityError('INVALID_PARAMETER','fetch',`Unsupported fetch parameter ${key}.`);
    const result=await fetchArea({area:config.area,origin:config.origin,name:config.name,cacheDir:await safePath(root,'.city-cache/data',{allowMissing:true}),source:config.source,...dataSourceOverrides(parameters),refresh:parameters.refresh,offline:parameters.offline,signal,...(context.request?{request:context.request}:{})});
    await atomicWrite(await safePath(root,config.source.file,{allowMissing:true}),result.raw,{signal});
    return {schemaVersion:1,status:'succeeded',artifacts:[config.source.file],diagnostics:result.diagnostics,cacheHit:result.cacheHit,contentHash:result.contentHash,source:{endpoint:result.endpoint,transport:result.transport,retrievedAt:result.raw.metadata.retrievedAt,sourceHash:result.raw.metadata.sourceHash,osmBaseTimestamp:result.raw.metadata.osmBaseTimestamp,cacheKey:result.cacheKey,attempts:result.sourceAttempts}};
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
