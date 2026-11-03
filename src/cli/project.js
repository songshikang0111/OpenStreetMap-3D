import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { CityError, validateArea, centerOf, relativeFile, safePath, atomicWrite, readJSON, hash } from '../data/common.js';
import { normalizeOSM } from '../data/normalize.js';
import {validateProjectConfig} from '../core/config.js';

export const SAMPLE_AREA = { south: 39.908, west: 116.459, north: 39.910, east: 116.462 };
// A deliberately small synthetic offline sample, explicitly identified as such.
export const OFFLINE_SAMPLE = {
  version: 0.6, generator: 'CityInk synthetic offline sample',
  elements: [
    { type: 'way', id: 1, tags: { building: 'office', height: '24', name: 'Synthetic sample building' }, geometry: [{ lat:39.9086,lon:116.4597 },{ lat:39.9086,lon:116.4601 },{ lat:39.909,lon:116.4601 },{ lat:39.909,lon:116.4597 },{ lat:39.9086,lon:116.4597 }] },
    { type:'way', id:2, tags:{ highway:'residential', name:'Synthetic sample street' }, geometry:[{lat:39.908,lon:116.4605},{lat:39.910,lon:116.4605}] },
    { type:'node', id:3, lat:39.9092, lon:116.461, tags:{ natural:'tree' } }
  ], metadata: { synthetic: true, attribution: 'Synthetic example; map attribution shown for downstream OSM imports.' }
};

export function validateConfig(config) {
  if (!config || config.schemaVersion !== 1 || typeof config.name !== 'string' || !config.name.trim() || config.name.length > 120)
    throw new CityError('INVALID_CONFIG', 'config', 'Expected schemaVersion 1 and a nonempty project name.');
  validateArea(config.area);
  if (!config.origin || !Number.isFinite(config.origin.lat) || !Number.isFinite(config.origin.lon) || Math.abs(config.origin.lat) > 80 || Math.abs(config.origin.lon) > 180 || !Number.isSafeInteger(config.seed)) throw new CityError('INVALID_CONFIG', 'config', 'Invalid fixed origin or seed.');
  if(config.origin.lat<config.area.south||config.origin.lat>config.area.north||config.origin.lon<config.area.west||config.origin.lon>config.area.east)throw new CityError('ORIGIN_OUTSIDE_AREA','config','The fixed project origin must remain inside the selected area.','Create a new project for a different location.');
  relativeFile(config.source?.file);
  if (!config.source.file.startsWith('data/') || !['overpass','import','local','osm-map','sample'].includes(config.source.kind)) throw new CityError('INVALID_CONFIG', 'config', 'Source must use data/ and kind overpass, local, osm-map, import or sample.');
  if (!config.generation || !['landscapeEnabled','inferRoofs'].every(k => typeof config.generation[k] === 'boolean') || !(config.tiling?.sizeMeters >= 25 && config.tiling.sizeMeters <= 10000) || !['low','draft','balanced','high'].includes(config.quality) || typeof config.style?.id !== 'string' || !config.style.id || !config.style.parameters || typeof config.style.parameters !== 'object' || Array.isArray(config.style.parameters) || !config.landmarks || typeof config.landmarks.enabled !== 'boolean' || !Array.isArray(config.landmarks.packages)) throw new CityError('INVALID_CONFIG', 'config', 'Invalid generation, tiling, quality, style or landmark settings.');
  for (const p of config.landmarks.packages) relativeFile(typeof p === 'string' ? p : p.path);
  const validation=validateProjectConfig(config);
  if(!validation.valid)throw new CityError('INVALID_CONFIG','config',validation.diagnostics.map(item=>`${item.path}: ${item.message}`).join('; '),'Correct the project configuration before saving.');
  return config;
}
export async function readProject(root) { return validateConfig(await readJSON(await safePath(root, 'city.config.json'))); }
export async function createProject(root, { name = path.basename(root), area = SAMPLE_AREA, origin, source, sample = false, ...extra } = {}) {
  await mkdir(root, { recursive: true });
  const existing = await readFile(path.join(root, 'city.config.json')).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });
  if (existing) throw new CityError('PROJECT_EXISTS', 'init', 'A city project already exists here.', 'Open it instead of initializing over it.');
  const config = validateConfig({ schemaVersion:1, name, area, origin: origin || centerOf(area), seed:1, source: { kind: sample ? 'sample' : 'overpass', file:'data/source.json', ...source }, generation:{landscapeEnabled:false,inferRoofs:false}, tiling:{sizeMeters:500}, quality:'balanced', style:{id:'comic',parameters:{}}, landmarks:{enabled:true,packages:[]}, ...extra });
  await mkdir(path.join(root, 'data'), { recursive: true });
  if (sample) {
    if (hash(area) !== hash(SAMPLE_AREA)) throw new CityError('SAMPLE_AREA', 'init', 'The synthetic sample uses its own fixed area.', 'Initialize without --sample to select a custom area.');
    await atomicWrite(await safePath(root, config.source.file, { allowMissing: true }), normalizeOSM(OFFLINE_SAMPLE, { area, origin:config.origin, name }).raw);
  }
  await atomicWrite(path.join(root, 'city.config.json'), config);
  await atomicWrite(path.join(root, 'city.lock.json'), { schemaVersion:1, inputs:{configHash:hash(config)}, history:[] });
  return config;
}
export async function patchProject(root, patch) {
  const current = await readProject(root);
  if (patch.origin && hash(patch.origin) !== hash(current.origin)) throw new CityError('ORIGIN_LOCKED', 'config', 'Project origin is fixed after initialization.', 'Create a new project to change projection origin.');
  const config = validateConfig({ ...current, ...patch });
  await atomicWrite(path.join(root, 'city.config.json'), config); return config;
}
export async function importData(root, file, { signal } = {}) {
  const config = await readProject(root);
  if (path.extname(file).toLowerCase() !== '.json') throw new CityError('UNSUPPORTED_FORMAT', 'import', 'Only OSM / Overpass JSON is supported.', 'Convert XML or PBF with an external tool, then import JSON.');
  const bytes = await readFile(file, { signal });
  if (bytes.length > 32 * 1024 * 1024) throw new CityError('IMPORT_LIMIT', 'import', 'Input exceeds 32 MiB.');
  let input; try { input = JSON.parse(bytes); } catch { throw new CityError('INVALID_JSON', 'import', 'Input is not valid JSON.'); }
  const result = normalizeOSM(input, { area: config.area, origin:config.origin, name:config.name, source:{sourceApi:'local-import', sourceHash:hash(bytes), retrievedAt:new Date().toISOString()} });
  await atomicWrite(await safePath(root, config.source.file, {allowMissing:true}), result.raw, {signal});
  return { ...result, artifacts:[config.source.file] };
}
