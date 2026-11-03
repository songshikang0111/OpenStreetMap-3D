import * as THREE from 'three';
import {projection} from './osm.js';
import {recipes as officialRecipes} from '../packages/landmarks/index.js';
import {officialGenerators} from './generators/official.js';
import {satisfies, versionTuple} from './generators/compatibility.js';

export const LANDMARK_ENGINE_VERSION = '1.0.0';
const clone = value => JSON.parse(JSON.stringify(value));
const sourceKey = f => `${f.osmType}/${f.osmId}`;
const error = (code,message,recipeId,featureIds=[]) => ({code,stage:'landmarks',recipeId,featureIds,message,hint:'Check recipe identity, required parts, generator and engine compatibility; degraded mode preserves generic source geometry.'});

export function validateLandmarkRecipe(recipe) {
  const errors=[];
  try {
    if(recipe?.schemaVersion!==1) throw new Error('Unsupported recipe schemaVersion');
    for(const key of ['id','version','generator','engineCompatibility']) if(typeof recipe[key]!=='string'||!recipe[key]) throw new Error(`Missing recipe ${key}`);
    versionTuple(recipe.version); satisfies(LANDMARK_ENGINE_VERSION,recipe.engineCompatibility);
    if(!recipe.match?.osm?.length || recipe.match.osm.some(s=>!['node','way','relation'].includes(s.type)||!Number.isSafeInteger(s.id)||s.id<=0)) throw new Error('match.osm requires explicit OSM type and positive id');
    if(new Set(recipe.match.osm.map(s=>`${s.type}/${s.id}`)).size!==recipe.match.osm.length) throw new Error('Duplicate match.osm identity');
    const b=recipe.match.bounds;
    if(b && (![b.south,b.west,b.north,b.east].every(Number.isFinite)||b.south>=b.north||b.west>=b.east||b.south< -90||b.north>90||b.west< -180||b.east>180)) throw new Error('Invalid geographic match.bounds');
    if(recipe.anchor?.kind!=='source-footprint'||recipe.orientation?.kind!=='source'||recipe.orientation.radians!==0) throw new Error('v1 supports source-footprint anchors and source orientation (radians: 0)');
    if(!recipe.parameters||!Array.isArray(recipe.materialRoles)||!recipe.materialRoles.length||!recipe.source||!recipe.provenance) throw new Error('Recipe parameters/materialRoles/source/provenance required');
    clone(recipe);
  } catch(e) {errors.push(error('LANDMARK_RECIPE_INVALID',e.message,recipe?.id));}
  return {valid:!errors.length,diagnostics:errors};
}

/** Synchronous matching/generation. Pass context.features when generating a serialized match. */
export function createLandmarkRegistry({recipes=officialRecipes,generators={},overrides={},engineVersion=LANDMARK_ENGINE_VERSION}={}) {
  versionTuple(engineVersion);
  const source=new Map(recipes.map(r=>[r.id,clone(r)]));
  for(const [id,override] of Object.entries(overrides)) {if(override===false||override===null)source.delete(id);else {if(override.id!==id)throw new TypeError('Override key must equal recipe.id');source.set(id,clone(override));}}
  const entries=[...source.values()].sort((a,b)=>(b.priority||0)-(a.priority||0)||a.id.localeCompare(b.id)), implementations={...officialGenerators,...generators};
  let diagnostics=[];
  const featureSets=new WeakMap();
  function report(d,context) {diagnostics.push(d);context.onDiagnostic?.(d);if(context.policy==='strict')throw Object.assign(new Error(d.message),{code:d.code,diagnostic:d});}
  return {
    get diagnostics(){return [...diagnostics];},
    recipes: entries.map(clone),
    match(features,context={}) {
      diagnostics=[];const output=[], claimed=new Set();
      if(new Set(features.map(f=>String(f.id))).size!==features.length) {report(error('LANDMARK_DUPLICATE_FEATURE_ID','Duplicate stable feature IDs in input'),context);return output;}
      for(const recipe of entries) {
        const validation=validateLandmarkRecipe(recipe);
        if(!validation.valid){for(const d of validation.diagnostics)report(d,context);continue;}
        if(!satisfies(engineVersion,recipe.engineCompatibility)){report(error('LANDMARK_INCOMPATIBLE',`Recipe requires engine ${recipe.engineCompatibility}; current ${engineVersion}`,recipe.id),context);continue;}
        const keys=new Set(recipe.match.osm.map(s=>`${s.type}/${s.id}`));
        const selected=features.filter(f=>keys.has(sourceKey(f))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        if(!selected.length)continue;
        const found=new Set(selected.map(sourceKey));
        if(found.size!==keys.size){report(error('LANDMARK_MISSING_PARTS','Required OSM landmark parts are missing; use generic buildings',recipe.id,selected.map(f=>String(f.id))),context);continue;}
        if(typeof implementations[recipe.generator]!=='function'){report(error('LANDMARK_GENERATOR_UNKNOWN',`Unknown generator ${recipe.generator}`,recipe.id),context);continue;}
        const bounds=recipe.match.bounds;
        if(bounds) {
          const origin=context.origin;
          const lat=Array.isArray(origin)?origin[0]:origin?.lat,lon=Array.isArray(origin)?origin[1]:origin?.lon;
          const inverse=context.project?.inverse || context.inverse || (Number.isFinite(lat)&&Number.isFinite(lon)?projection(lat,lon).inverse:null);
          const locations=selected.map(f=>Number.isFinite(f.lat)&&Number.isFinite(f.lon)?[f.lat,f.lon]:inverse&&f.center?inverse(f.center):null);
          if(locations.some(p=>!p || !p.every(Number.isFinite) || p[0]<bounds.south||p[0]>bounds.north||p[1]<bounds.west||p[1]>bounds.east)) {report(error('LANDMARK_LOCATION_MISMATCH','Landmark location missing or outside recipe bounds',recipe.id),context);continue;}
        }
        const ids=selected.map(f=>String(f.id));
        if(ids.some(id=>claimed.has(id))){report(error('LANDMARK_CLAIM_CONFLICT','Higher-priority recipe already claims an input feature',recipe.id,ids),context);continue;}
        const match={recipeId:recipe.id,recipeVersion:recipe.version,generatorId:recipe.generator,claimedFeatureIds:ids,parameters:clone(recipe.parameters),provenance:clone(recipe.provenance),diagnostics:[]};
        featureSets.set(match,selected);output.push(match);ids.forEach(id=>claimed.add(id));
      }
      return output;
    },
    generate(match,context={}) {
      let result;
      try {
        const recipe=entries.find(r=>r.id===match.recipeId&&r.version===match.recipeVersion);
        if(!recipe||recipe.generator!==match.generatorId||!satisfies(engineVersion,recipe.engineCompatibility)) throw new Error('Match recipe/version/generator is unavailable or incompatible');
        const features=(context.features||featureSets.get(match)||[]).filter(f=>match.claimedFeatureIds.includes(String(f.id))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        if(features.length!==match.claimedFeatureIds.length||features.some(f=>!Array.isArray(f.outer)||!Number.isFinite(f.height)||f.height<=0||!Number.isFinite(f.minHeight)||f.minHeight<0||f.minHeight>=f.height))throw new Error('Generation requires all claimed source features with valid geometry/heights');
        const required=new Set(recipe.match.osm.map(s=>`${s.type}/${s.id}`));
        if(features.some(f=>!required.has(sourceKey(f)))||new Set(features.map(sourceKey)).size!==required.size)throw new Error('Serialized match source identities do not match the recipe');
        result=implementations[match.generatorId](clone(match),{...context,features:clone(features)});
        if(!result?.group?.isGroup||JSON.stringify([...result.claimedFeatureIds].sort())!==JSON.stringify([...match.claimedFeatureIds].sort())||!result.provenance)throw new Error('Generator must return a Group, unchanged claimedFeatureIds and provenance');
        let vertices=0; result.group.traverse(o=>{if(o.isMesh){const p=o.geometry?.attributes.position;if(!p)throw new Error('Generated geometry has no positions');for(const value of p.array)if(!Number.isFinite(value))throw new Error('Generated geometry is non-finite');vertices+=p.count;if(!o.userData.city?.featureId||!o.userData.city?.materialRole)throw new Error('Generated mesh requires serializable userData.city semantics');}});
        if(!vertices)throw new Error('Generator returned no geometry');
        return {...result,diagnostics:result.diagnostics||[]};
      } catch(e) {
        const geometries=new Set(),materials=new Set();result?.group?.traverse?.(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
        geometries.forEach(g=>g?.dispose());materials.forEach(m=>m?.dispose());
        const d=error('LANDMARK_GENERATION_FAILED',e.message,match.recipeId,match.claimedFeatureIds);report(d,context);
        return {group:new THREE.Group(),claimedFeatureIds:[],provenance:null,diagnostics:[d]};
      }
    },
  };
}

/** Pure compatibility/lock helper. The CLI owns filesystem installation and atomic lock writes. */
export function checkLandmarkPackage(pack,{engineVersion=LANDMARK_ENGINE_VERSION}={}) {
  const diagnostics=[];
  try {
    if(pack?.schemaVersion!==1||!pack.id||!pack.recipes?.length)throw new Error('Invalid landmark package metadata');
    versionTuple(pack.version);
    if(!satisfies(engineVersion,pack.engineCompatibility))throw new Error(`Package requires ${pack.engineCompatibility}`);
    for(const recipe of pack.recipes){const v=validateLandmarkRecipe(recipe);diagnostics.push(...v.diagnostics);if(v.valid&&!satisfies(engineVersion,recipe.engineCompatibility))throw new Error(`Recipe ${recipe.id} incompatible`);}
    if(new Set(pack.recipes.map(r=>r.id)).size!==pack.recipes.length)throw new Error('Duplicate recipe IDs');
  } catch(e) {diagnostics.push(error('LANDMARK_PACKAGE_INCOMPATIBLE',e.message));}
  return {valid:!diagnostics.length,diagnostics,lock:diagnostics.length?null:{id:pack.id,version:pack.version,engineCompatibility:pack.engineCompatibility,recipes:pack.recipes.map(r=>({id:r.id,version:r.version,generator:r.generator})).sort((a,b)=>a.id.localeCompare(b.id))}};
}
