import path from 'node:path';
import { CityError, atomicWrite, hash, readJSON, validateArea, bboxArray, checkAbort } from './common.js';
import { requestJSON } from './http.js';
import { normalizeOSM } from './normalize.js';
import { OVERPASS_URL, resolveDataSource, canFallback, overpassRequest } from './source.js';

export { OVERPASS_URL };
export const QUERY_VERSION = 1;
export function areaQuery(area) {
  validateArea(area); const box = bboxArray(area).join(',');
  const selectors = ['[building]', '["building:part"]', '[highway]', '[waterway]', '[natural]', '[landuse]', '[landcover]', '[leisure]', '["area:highway"]', '[amenity]', '[barrier]'];
  // Recursive down includes complete ways/nodes and nested relation members, not clipped geometry.
  return `[out:json][timeout:60][maxsize:67108864];(${selectors.map(s => `nwr${s}(${box});`).join('')});(._;>>;);out meta;`;
}
export async function fetchArea({ area, origin, name, cacheDir, source, endpoint, transport, fallbackEndpoints, fallbackPolicy, refresh = false, offline = false, signal, request = requestJSON, requestOptions = {} }) {
  checkAbort(signal);
  const query = areaQuery(area);
  const selected=resolveDataSource(source,{endpoint,transport,fallbackEndpoints,fallbackPolicy});
  const endpoints=[selected.endpoint,...(selected.fallbackPolicy==='unavailable'?selected.fallbackEndpoints:[])];
  // Preserve v1 POST cache keys. GET snapshots are separate protocol requests.
  const descriptor=endpoint=>{const key=hash({area,endpoint,queryVersion:QUERY_VERSION,...(selected.transport==='get'?{transport:'get'}:{})});return {key,file:path.join(cacheDir,`${key}.json`)};};
  if (!refresh || offline) for(const candidate of endpoints){
    const {key,file}=descriptor(candidate);
    try {
      const entry = await readJSON(file);
      const normalized = normalizeOSM(entry.raw, { area, origin, name });
      if (entry.key !== key || entry.contentHash !== normalized.contentHash || entry.snapshotHash !== hash(entry.raw)) throw new CityError('CACHE_CORRUPT', 'cache', 'Cached snapshot hash mismatch.', 'Refresh explicitly to replace this cache.');
      checkAbort(signal);
      return { ...normalized, diagnostics:[...normalized.diagnostics,...(candidate!==selected.endpoint?[fallbackDiagnostic(candidate,true)]:[])], raw: { ...normalized.raw, metadata: { ...entry.raw.metadata, ...normalized.raw.metadata } }, cacheHit: true, cacheKey: key, cacheFile: file, endpoint:candidate, transport:selected.transport, sourceAttempts:[] };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (offline) throw new CityError('OFFLINE_CACHE_MISS', 'cache', 'No cached snapshot for this area and source.', 'Fetch once online or import a local JSON file.');
  const sourceAttempts=[];
  for(let index=0;index<endpoints.length;index++){
  const candidate=endpoints[index],{key,file}=descriptor(candidate),started=performance.now();
  try{
  const receivedAt = new Date().toISOString();
  const download = q => {const {url,init}=overpassRequest(candidate,q,selected.transport);return request(url, { ...requestOptions,...init, signal });};
  let raw = await download(query);
  let result = normalizeOSM(raw, { area, origin, name });
  if (result.missing.length) {
    if (result.missing.length > 500) throw new CityError('REFERENCE_LIMIT', 'download', 'Too many missing references for bounded completion.');
    const completion = `[out:json][timeout:30][maxsize:33554432];(${result.missing.map(m => `${m.type}(${m.id});`).join('')});(._;>>;);out meta;`;
    const extra = await download(completion);
    if (!Array.isArray(extra.elements) || extra.remark) throw new CityError('INVALID_OSM', 'download', extra.remark || 'Invalid reference completion response.');
    const merged = new Map(raw.elements.map(e => [`${e.type}/${e.id}`, e]));
    for (const e of extra.elements) merged.set(`${e.type}/${e.id}`, e);
    raw = { ...raw, elements: [...merged.values()] };
    result = normalizeOSM(raw, { area, origin, name });
  }
  sourceAttempts.push({endpoint:candidate,transport:selected.transport,status:'succeeded',elapsedMs:Math.round(performance.now()-started)});
  result = normalizeOSM(result.raw, { area, origin, name, source: { retrievedAt: receivedAt, endpoint:candidate, transport:selected.transport, requestedEndpoint:selected.endpoint, fallbackPolicy:selected.fallbackPolicy, sourceAttempts, query, queryVersion: QUERY_VERSION, sourceApi: 'overpass', sourceHash: hash(raw), ...(raw.osm3s?.timestamp_osm_base?{osmBaseTimestamp:raw.osm3s.timestamp_osm_base}:{}) } });
  checkAbort(signal);
  await atomicWrite(file, { key, contentHash: result.contentHash, snapshotHash: hash(result.raw), raw: result.raw }, { signal });
  return { ...result, diagnostics:[...result.diagnostics,...(index?[fallbackDiagnostic(candidate,false)]:[])], cacheHit: false, cacheKey: key, cacheFile: file, endpoint:candidate, transport:selected.transport, sourceAttempts };
  }catch(error){
    checkAbort(signal);
    sourceAttempts.push({endpoint:candidate,transport:selected.transport,status:'failed',code:error.code||'TASK_FAILED',...(error.httpStatus?{httpStatus:error.httpStatus}:{}),elapsedMs:Math.round(performance.now()-started)});
    if(index===endpoints.length-1||!canFallback(error)){error.sourceAttempts=sourceAttempts;throw error;}
  }
  }
}
function fallbackDiagnostic(endpoint,cacheHit){return {code:cacheHit?'FALLBACK_CACHE_HIT':'SOURCE_FALLBACK',stage:cacheHit?'cache':'download',message:`Used ${cacheHit?'cached data from':'explicit fallback'} ${endpoint}.`,hint:'The snapshot records the actual source; configure a self-hosted endpoint for sustained use.'};}
