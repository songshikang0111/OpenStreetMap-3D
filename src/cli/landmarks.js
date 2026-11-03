import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { CityError, readJSON, hash, atomicWrite, safePath } from '../data/common.js';
import { readProject, patchProject } from './project.js';

// Declarative packages only. Executable generators remain trusted engine code.
export async function readRecipePackage(directory) {
  const files = (await readdir(directory)).filter(f => f.endsWith('.json')).sort();
  const recipes = [];
  for (const file of files) {
    const value = await readJSON(await safePath(directory, file));
    if (Array.isArray(value.recipes)) recipes.push(...value.recipes);
    else if (value.generator && value.match) recipes.push(value);
  }
  if (!recipes.length) throw new CityError('EMPTY_RECIPE_PACKAGE', 'landmarks', 'No declarative recipes found.', 'Use recipe JSON files or a JSON object containing recipes[].');
  for (const r of recipes) {
    if (r.schemaVersion !== 1 || typeof r.id !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version) || !r.generator || !r.match)
      throw new CityError('INVALID_RECIPE', 'landmarks', 'Recipe requires schemaVersion, id/version, generator and match.');
    const compatibility = r.compatibility?.engine || r.engineRange || r.compatibleEngine || r.engine;
    if (!compatibility || !['*','^1.0.0','>=1.0.0 <2.0.0','1','1.x'].includes(compatibility))
      throw new CityError('INCOMPATIBLE_RECIPE', 'landmarks', `Unsupported engine compatibility for ${r.id}.`, 'Use a declarative package compatible with engine protocol 1.');
  }
  if (new Set(recipes.map(r => r.id)).size !== recipes.length) throw new CityError('DUPLICATE_RECIPE', 'landmarks', 'Recipe IDs must be unique.');
  return { recipes, hash:hash(recipes) };
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
