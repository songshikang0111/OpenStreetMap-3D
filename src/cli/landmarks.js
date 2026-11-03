import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CityError, readJSON, hash, atomicWrite, safePath } from '../data/common.js';
import { readProject, patchProject } from './project.js';

// Declarative packages only. Executable generators remain trusted engine code.
export async function readRecipePackage(directory) {
  const files = (await readdir(directory)).filter(f => f.endsWith('.json')).sort();
  const recipes = [];let metadata;
  for (const file of files) {
    const value = await readJSON(await safePath(directory, file));
    if (Array.isArray(value.recipes)) {recipes.push(...value.recipes);if(value.id)metadata=value;}
    else if (value.generator && value.match) recipes.push(value);
  }
  // Only this bundled, trusted code module may supply official declarations.
  if(!recipes.length&&path.resolve(directory)===fileURLToPath(new URL('../../packages/landmarks/',import.meta.url)).replace(/[\\/]$/,'')){
    try{metadata=(await import('../../packages/landmarks/index.js')).default;recipes.push(...metadata.recipes);}
    catch(e){throw new CityError('LANDMARKS_UNAVAILABLE','landmarks',`Official package cannot load: ${e.message}`,'Integrate task C.');}
  }
  if (!recipes.length) throw new CityError('EMPTY_RECIPE_PACKAGE', 'landmarks', 'No declarative recipes found.', 'Use recipe JSON files or a JSON object containing recipes[].');
  for (const r of recipes) {
    if (r.schemaVersion !== 1 || typeof r.id !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version) || !r.generator || !r.match)
      throw new CityError('INVALID_RECIPE', 'landmarks', 'Recipe requires schemaVersion, id/version, generator and match.');
    const compatibility = r.engineCompatibility;
    if (!compatibility || !supportsEngine(compatibility))
      throw new CityError('INCOMPATIBLE_RECIPE', 'landmarks', `Unsupported engine compatibility for ${r.id}.`, 'Use a declarative package compatible with engine protocol 1.');
    if(!Array.isArray(r.match.osm)||!r.match.osm.length||r.match.osm.some(s=>!['node','way','relation'].includes(s.type)||!Number.isSafeInteger(s.id)||s.id<=0)||r.anchor?.kind!=='source-footprint'||r.orientation?.kind!=='source'||r.orientation.radians!==0||!r.parameters||!Array.isArray(r.materialRoles)||!r.materialRoles.length||!r.source||!r.provenance)throw new CityError('INVALID_RECIPE','landmarks',`Invalid declarative recipe ${r.id}.`,'Use the task C landmark recipe schema.');
  }
  if (new Set(recipes.map(r => r.id)).size !== recipes.length) throw new CityError('DUPLICATE_RECIPE', 'landmarks', 'Recipe IDs must be unique.');
  if(metadata?.engineCompatibility&&!supportsEngine(metadata.engineCompatibility))throw new CityError('INCOMPATIBLE_RECIPE','landmarks','Package engine compatibility does not match protocol 1.');
  // Prefer C's authoritative validator when integrated; the isolated B checks above remain usable.
  let contract;
  try{contract=await import('../landmark-registry.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
  if(contract)for(const recipe of recipes){const result=contract.validateLandmarkRecipe(recipe);if(!result.valid)throw new CityError('INVALID_RECIPE','landmarks',result.diagnostics.map(d=>d.message).join('; '));}
  return { recipes, hash:hash(recipes), ...(metadata?{package:{id:metadata.id,version:metadata.version,engineCompatibility:metadata.engineCompatibility}}:{}) };
}
function supportsEngine(range){
  try{return range.trim().split(/\s*\|\|\s*/).some(branch=>branch.split(/\s+/).every(token=>{
    const m=/^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(token);if(!m)throw new Error('Unsupported version range');
    const tuple=m.slice(2).map(Number),cmp=1-tuple[0]||-tuple[1]||-tuple[2],op=m[1]||'=';
    return op==='^'||op==='~'?tuple[0]===1&&tuple[1]===0&&tuple[2]===0:op==='>='?cmp>=0:op==='<='?cmp<=0:op==='>'?cmp>0:op==='<'?cmp<0:cmp===0;
  }));}catch{return false;}
}
export async function updateLandmarks(root, { packagePath, rollback, signal } = {}) {
  const config = await readProject(root);
  const lock = await readJSON(path.join(root, 'city.lock.json'));
  let packages;
  if (rollback) {
    const previous = lock.landmarkHistory?.at(-1);
    if (!previous) throw new CityError('NO_ROLLBACK', 'landmarks', 'No previous landmark package set is recorded.');
    packages = previous;
  } else {
    if (!packagePath) throw new CityError('PACKAGE_REQUIRED', 'landmarks', 'An explicit local package path is required.');
    const pack = await readRecipePackage(packagePath);
    const relative = `rules/packages/${pack.hash}.json`;
    await atomicWrite(await safePath(root, relative, {allowMissing:true}), {schemaVersion:1, recipes:pack.recipes}, {signal});
    packages = [{path:relative, hash:pack.hash, recipes:pack.recipes.map(r => ({id:r.id,version:r.version}))}];
  }
  lock.landmarkHistory = [...(lock.landmarkHistory || []), config.landmarks.packages];
  lock.pendingRebuild = { stages:['planning','geometry','pack'], reason:'landmark-package-change', previous:config.landmarks.packages, next:packages };
  // A crash between writes is detectable: build verifies the recipe hash against config.
  await atomicWrite(path.join(root, 'city.lock.json'), lock, {signal});
  await patchProject(root, {landmarks:{...config.landmarks, packages}});
  return {packages, rebuildRequired:true, artifacts:['city.config.json','city.lock.json']};
}
export async function projectRecipes(root, config) {
  const recipes=[];
  for (const p of config.landmarks.packages) {
    const file = await safePath(root, typeof p === 'string' ? p : p.path);
    const value = await readJSON(file); const list = value.recipes || [value];
    if (p.hash && hash(list) !== p.hash) throw new CityError('RECIPE_HASH_MISMATCH','landmarks','Locked recipe content has changed.','Update the package explicitly.');
    recipes.push(...list);
  }
  return recipes;
}
