import path from 'node:path';
import { CityError, atomicWrite, hash, readJSON, validateArea, bboxArray, checkAbort } from './common.js';
import { requestJSON } from './http.js';
import { normalizeOSM } from './normalize.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const QUERY_VERSION = 1;
export function areaQuery(area) {
  validateArea(area); const box = bboxArray(area).join(',');
  const selectors = ['[building]', '["building:part"]', '[highway]', '[waterway]', '[natural]', '[landuse]', '[landcover]', '[leisure]', '["area:highway"]', '[amenity]', '[barrier]'];
  // Recursive down includes complete ways/nodes and nested relation members, not clipped geometry.
  return `[out:json][timeout:60][maxsize:67108864];(${selectors.map(s => `nwr${s}(${box});`).join('')});(._;>>;);out meta;`;
}
export async function fetchArea({ area, origin, name, cacheDir, endpoint = OVERPASS_URL, refresh = false, offline = false, signal, request = requestJSON, requestOptions = {} }) {
  const query = areaQuery(area);
  const key = hash({ area, endpoint, queryVersion: QUERY_VERSION });
  const file = path.join(cacheDir, `${key}.json`);
  if (!refresh || offline) {
    try {
      const entry = await readJSON(file);
      const normalized = normalizeOSM(entry.raw, { area, origin, name });
      if (entry.key !== key || entry.contentHash !== normalized.contentHash || entry.snapshotHash !== hash(entry.raw)) throw new CityError('CACHE_CORRUPT', 'cache', 'Cached snapshot hash mismatch.', 'Refresh explicitly to replace this cache.');
      return { ...normalized, raw: { ...normalized.raw, metadata: { ...entry.raw.metadata, ...normalized.raw.metadata } }, cacheHit: true, cacheKey: key, cacheFile: file };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (offline) throw new CityError('OFFLINE_CACHE_MISS', 'cache', 'No cached snapshot for this area and source.', 'Fetch once online or import a local JSON file.');
  const receivedAt = new Date().toISOString();
  const download = q => request(endpoint, { ...requestOptions, method: 'POST', body: new URLSearchParams({ data: q }), signal });
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
  result = normalizeOSM(result.raw, { area, origin, name, source: { retrievedAt: receivedAt, endpoint, query, queryVersion: QUERY_VERSION, sourceApi: 'overpass', sourceHash: hash(raw) } });
  checkAbort(signal);
  await atomicWrite(file, { key, contentHash: result.contentHash, snapshotHash: hash(result.raw), raw: result.raw }, { signal });
  return { ...result, cacheHit: false, cacheKey: key, cacheFile: file };
}
