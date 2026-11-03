export const GENERATOR_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
export const STYLE_CONTRACT_VERSION = 1;

export class CityBuildError extends Error {
  constructor(code, message, stage = 'compile', details = {}) {
    super(message); this.name = 'CityBuildError'; this.code = code; this.stage = stage;
    Object.assign(this, details);
    this.diagnostics = details.diagnostics || [{code, stage, message, ...details}];
  }
}

// Sorting object keys (and the explicitly unordered input collections below)
// removes UUIDs, insertion order and wall-clock time from the wire protocol.
export function canonicalStringify(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().filter(k => item[k] !== undefined).map(k => [k, item[k]]));
    }
    if (typeof item === 'number' && !Number.isFinite(item)) throw new CityBuildError('NON_FINITE_VALUE', 'Scene metadata must contain finite numbers.', 'encode');
    return item;
  });
}

export async function sha256(payload) {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function checkCancelled(signal) {
  if (signal?.aborted) throw new CityBuildError('BUILD_CANCELLED', 'Scene build cancelled.', 'cancel');
}

export function normalizeRaw(raw, config) {
  if (!raw || !Array.isArray(raw.elements)) throw new CityBuildError('INVALID_SOURCE', 'Expected an OSM JSON object with elements.', 'parse');
  const byId = new Map();
  for (const element of raw.elements) {
    if (!element || typeof element!=='object' || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id)) throw new CityBuildError('INVALID_SOURCE_ELEMENT', 'OSM elements require a type and safe integer id.', 'parse');
    const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
    const validGeometry=g=>Array.isArray(g)&&g.every(validPoint);
    if(element.type==='node'&&!validPoint(element)||element.geometry!==undefined&&!validGeometry(element.geometry))throw new CityBuildError('INVALID_SOURCE_COORDINATES',`Invalid WGS84 geometry on ${element.type}/${element.id}.`,'parse');
    if(element.type==='relation'&&element.members!==undefined&&(!Array.isArray(element.members)||element.members.some(m=>!m||!['node','way','relation'].includes(m.type)||!Number.isSafeInteger(m.ref)||m.geometry!==undefined&&!validGeometry(m.geometry))))throw new CityBuildError('INVALID_SOURCE_ELEMENT',`Malformed members on relation/${element.id}.`,'parse');
    const copy = JSON.parse(canonicalStringify(element));
    if (copy.members) copy.members.sort((a,b) => canonicalStringify(a).localeCompare(canonicalStringify(b), 'en'));
    const key = `${copy.type}:${copy.id}`, previous = byId.get(key);
    if (previous && (previous.version || 0) === (copy.version || 0) && canonicalStringify(previous) !== canonicalStringify(copy)) throw new CityBuildError('SOURCE_CONFLICT', `Conflicting copies of ${key}.`, 'parse');
    if (!previous || (copy.version || 0) > (previous.version || 0)) byId.set(key, copy);
  }
  const a = config.area;
  return { ...raw, metadata: {...raw.metadata, bbox: [a.south,a.west,a.north,a.east], center: [config.origin.lat,config.origin.lon]}, elements: [...byId.values()].sort((a,b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`, 'en')) };
}
