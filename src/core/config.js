import { projection } from '../osm.js';
import {validateProjectStyleConfig} from '../styles/project-contract.js';

export const MAX_AREA_SPAN_METERS = 10000;

/** Validate without mutating input; value is the defaulted, persistable config. */
export function validateProjectConfig(config) {
  const diagnostics = [];
  const error = (path, message) => diagnostics.push({code:'INVALID_PROJECT_CONFIG',stage:'config',path,message,hint:'Use schemas/project.schema.json and persist the returned value at project initialization.'});
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {valid:false, diagnostics:[{code:'INVALID_PROJECT_CONFIG',stage:'config',path:'',message:'Project config must be an object.'}]};
  if (config.schemaVersion !== 1) error('schemaVersion', 'Only project schemaVersion 1 is supported.');
  if (typeof config.name !== 'string' || !config.name.trim()) error('name','A non-empty project name is required.');
  const a = config.area;
  if (!a || !['south','west','north','east'].every(k => typeof a[k] === 'number' && Number.isFinite(a[k]))) error('area','area requires finite named south/west/north/east coordinates.');
  else {
    if (a.south >= a.north || a.west >= a.east || a.south < -80 || a.north > 80 || a.west < -180 || a.east > 180) error('area','Area must be ordered, within ±80° latitude, and must not cross the date line.');
    const p=projection((a.south+a.north)/2,(a.west+a.east)/2), nw=p.point({lat:a.north,lon:a.west}),se=p.point({lat:a.south,lon:a.east});
    if(se[0]-nw[0]>MAX_AREA_SPAN_METERS || se[1]-nw[1]>MAX_AREA_SPAN_METERS) error('area',`Each local-projection area span is limited to ${MAX_AREA_SPAN_METERS} m; this is a build guard, not a browser performance claim.`);
  }
  const origin=config.origin === undefined ? (a && {lat:(a.south+a.north)/2,lon:(a.west+a.east)/2}) : config.origin;
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || Math.abs(origin.lat)>80 || Math.abs(origin.lon)>180) error('origin','Origin requires finite WGS84 lat/lon within the supported projection.');
  else if(a && (origin.lat<a.south || origin.lat>a.north || origin.lon<a.west || origin.lon>a.east)) error('origin','The locked origin must lie in the project area.');
  for(const key of ['generation','tiling','style','landmarks'])if(config[key]!==undefined&&(!config[key]||typeof config[key]!=='object'||Array.isArray(config[key])))error(key,'Expected an object.');
  if (config.seed !== undefined && !Number.isSafeInteger(config.seed)) error('seed','Seed must be a safe integer.');
  if (!config.source || !['overpass','osm-map','local','import','sample'].includes(config.source.kind) || typeof config.source.file !== 'string' || !config.source.file.trim()) error('source','source requires kind (overpass/osm-map/local/import/sample) and file.');
  for (const key of ['landscapeEnabled','inferRoofs']) if(config.generation?.[key] !== undefined && typeof config.generation[key] !== 'boolean') error(`generation.${key}`,'Expected boolean.');
  if(config.landmarks?.enabled !== undefined && typeof config.landmarks.enabled !== 'boolean') error('landmarks.enabled','Expected boolean.');
  if(config.landmarks?.policy !== undefined && !['strict','degraded'].includes(config.landmarks.policy))error('landmarks.policy','Expected strict or degraded.');
  if(config.landmarks?.packages !== undefined && (!Array.isArray(config.landmarks.packages)||!config.landmarks.packages.every(x=>typeof x==='string'||(x&&typeof x==='object'&&typeof x.path==='string'&&(!x.hash||/^[a-f0-9]{64}$/.test(x.hash)))))) error('landmarks.packages','Expected project-relative paths or locked {path,hash,recipes} entries.');
  if(config.tiling?.sizeMeters !== undefined && (!Number.isFinite(config.tiling.sizeMeters)||config.tiling.sizeMeters<25||config.tiling.sizeMeters>10000)) error('tiling.sizeMeters','Tile size must be 25–10000 m.');
  if(config.tiling?.divisions !== undefined && (!Number.isInteger(config.tiling.divisions)||config.tiling.divisions<1||config.tiling.divisions>32)) error('tiling.divisions','Optional fixed-area comparison grid requires divisions between 1 and 32.');
  if(config.quality !== undefined && !['draft','low','balanced','high'].includes(config.quality)) error('quality','Expected low, balanced or high (draft is a legacy alias).');
  if(config.style !== undefined && (!config.style || typeof config.style.id!=='string' || !config.style.id)) error('style','Style requires id.');
  if(config.style?.parameters !== undefined && (!config.style.parameters || typeof config.style.parameters!=='object' || Array.isArray(config.style.parameters))) error('style.parameters','Expected a parameter object.');
  if(config.style!==undefined)try{validateProjectStyleConfig(config.style);}catch(e){error('style',e.message);}
  if(config.camera!==undefined){
    if(!config.camera||typeof config.camera!=='object'||Array.isArray(config.camera))error('camera','Expected an object.');
    else{
      for(const key of ['position','target'])if(config.camera[key]!==undefined&&(!Array.isArray(config.camera[key])||config.camera[key].length!==3||!config.camera[key].every(Number.isFinite)))error(`camera.${key}`,'Expected three finite coordinates.');
      if(config.camera.fov!==undefined&&(!Number.isFinite(config.camera.fov)||config.camera.fov<5||config.camera.fov>140))error('camera.fov','Expected FOV in [5, 140].');
      if(config.camera.near!==undefined&&(!Number.isFinite(config.camera.near)||config.camera.near<=0))error('camera.near','Expected a positive near plane.');
    }
  }
  if(diagnostics.length) return {valid:false, diagnostics};
  const value={...config,origin,seed:config.seed??1,generation:{landscapeEnabled:false,inferRoofs:false,...config.generation},tiling:{sizeMeters:500,...config.tiling},quality:config.quality||'balanced',style:{id:'comic',parameters:{},...config.style},landmarks:{enabled:true,packages:[],...config.landmarks}};
  return {valid:true,diagnostics,value,config:value};
}
