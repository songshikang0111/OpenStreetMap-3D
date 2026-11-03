import path from 'node:path';
import { CityError, atomicWrite, readJSON, hash } from './common.js';
import { requestJSON } from './http.js';
import { OVERPASS_URL } from './overpass.js';

export const LANDMARK_LOCATIONS = [
  { id: 'china-zun', displayName: '中国尊 / CITIC Tower', lat: 39.9029, lon: 116.4679, source: 'official-landmark-index' },
  { id: 'cctv', displayName: '央视总部 / CCTV Headquarters', lat: 39.9152, lon: 116.4578, source: 'official-landmark-index' }
];
export async function searchPlaces(query, { cacheDir, offline = false, refresh = false, photonUrl = 'https://photon.komoot.io/api/', overpassUrl = OVERPASS_URL, request = requestJSON, signal, requestOptions = {} } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new CityError('INVALID_QUERY', 'search', 'Query must contain 1–300 characters.');
  query = query.trim();
  const coordinates = query.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
  if (coordinates) {
    const lat = Number(coordinates[1]), lon = Number(coordinates[2]);
    if (Math.abs(lat) > 80 || Math.abs(lon) > 180) throw new CityError('INVALID_COORDINATES', 'search', 'Coordinates are outside supported WGS84 limits.');
    return [{ id: `coordinate:${lat},${lon}`, displayName: `${lat}, ${lon}`, lat, lon, source: 'coordinate' }];
  }
  const landmark = LANDMARK_LOCATIONS.find(p => [p.id, `landmark:${p.id}`, p.displayName, ...p.displayName.split(' / ')].some(s => s.toLowerCase() === query.toLowerCase()));
  if (landmark) return [landmark];
  const osm = query.match(/^(?:https?:\/\/(?:www\.)?openstreetmap\.org\/)?(node|way|relation)[/:](\d+)\/?(?:\?.*)?$/);
  const key = hash({ query, photonUrl, overpassUrl }); const file = cacheDir && path.join(cacheDir, `search-${key}.json`);
  if (file && (!refresh || offline)) { try { return (await readJSON(file)).candidates; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  if (offline) throw new CityError('OFFLINE_SEARCH_MISS', 'search', 'No offline search result.', 'Use coordinates, an official landmark ID, or a previously cached query.');
  let candidates;
  if (osm) {
    const raw = await request(overpassUrl, { ...requestOptions, signal, method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:15];${osm[1]}(${osm[2]});out center;` }) });
    if (raw.remark || !Array.isArray(raw.elements)) throw new CityError('INVALID_SEARCH_RESPONSE', 'search', raw.remark || 'Invalid OSM response.');
    candidates = raw.elements.map(e => ({ id: `${e.type}/${e.id}`, displayName: e.tags?.name || `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, source: 'osm-object' }));
  } else {
    const url = new URL(photonUrl); url.searchParams.set('q', query); url.searchParams.set('limit', '5');
    const raw = await request(url.href, { ...requestOptions, signal, maxBytes: 1024 * 1024 });
    if (!Array.isArray(raw.features)) throw new CityError('INVALID_SEARCH_RESPONSE', 'search', 'Expected Photon GeoJSON features.');
    const types = { N: 'node', W: 'way', R: 'relation' };
    candidates = raw.features.map((f, i) => { const p = f.properties || {}, c = f.geometry?.coordinates || [];
      return { id: p.osm_id ? `${types[p.osm_type] || p.osm_type}/${p.osm_id}` : `photon:${key}:${i}`, displayName: [p.name, p.city, p.state, p.country].filter(Boolean).join(', '), lat: c[1], lon: c[0], source: 'photon', ...(p.extent ? { bbox: { west: p.extent[0], north: p.extent[1], east: p.extent[2], south: p.extent[3] } } : {}) };
    });
  }
  if (candidates.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) throw new CityError('INVALID_SEARCH_RESPONSE', 'search', 'Search returned invalid coordinates.');
  if (file) await atomicWrite(file, { candidates, retrievedAt: new Date().toISOString() }, { signal });
  return candidates;
}
