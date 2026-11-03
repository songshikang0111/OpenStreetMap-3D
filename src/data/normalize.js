import { CityError, validateArea, bboxArray, centerOf, hash } from './common.js';

export function normalizeOSM(input, { area, origin, name = 'Imported city', source = {} } = {}) {
  if (!input || !Array.isArray(input.elements) || input.remark)
    throw new CityError('INVALID_OSM', 'normalize', input?.remark || 'Expected OSM / Overpass JSON elements.', 'Import .json; XML and PBF are not supported.');
  const legacy = input.metadata || {};
  if (!area && Array.isArray(legacy.bbox)) area = Object.fromEntries(['south','west','north','east'].map((k, i) => [k, legacy.bbox[i]]));
  if (!area && input.bounds) area = { south: input.bounds.minlat, west: input.bounds.minlon, north: input.bounds.maxlat, east: input.bounds.maxlon };
  validateArea(area); origin ||= centerOf(area);
  const map = new Map();
  const pointValid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  for (const item of input.elements) {
    if (!['node','way','relation'].includes(item.type) || !Number.isSafeInteger(item.id) || item.id <= 0 ||
        item.type === 'node' && !pointValid(item) || item.geometry && (!Array.isArray(item.geometry) || item.geometry.some(p => !pointValid(p))) ||
        item.nodes && (!Array.isArray(item.nodes) || item.nodes.some(n => !Number.isSafeInteger(n))) ||
        item.members && (!Array.isArray(item.members) || item.members.some(m => !['node','way','relation'].includes(m.type) || !Number.isSafeInteger(m.ref) || m.geometry && (!Array.isArray(m.geometry) || m.geometry.some(p => !pointValid(p))))))
      throw new CityError('INVALID_ELEMENT', 'normalize', 'Invalid OSM element or geometry.', 'Check element IDs, references and WGS84 coordinates.');
    const key = `${item.type}/${item.id}`;
    const old = map.get(key);
    if (old && hash(old) !== hash(item)) throw new CityError('DUPLICATE_ELEMENT', 'normalize', `Conflicting duplicate ${key}.`);
    map.set(key, structuredClone(item));
  }
  const diagnostics = [], missing = new Map();
  const add = (owner, type, id) => {
    missing.set(`${type}/${id}`, { type, id });
    diagnostics.push({ code: 'MISSING_REFERENCE', stage: 'normalize', featureId: `${owner.type}/${owner.id}`, message: `Missing ${type}/${id}.`, hint: 'Fetch with reference completion or import a complete extract.' });
  };
  for (const e of map.values()) {
    if (e.type === 'way' && !e.geometry) for (const id of e.nodes || []) if (!map.has(`node/${id}`)) add(e, 'node', id);
    if (e.type === 'relation') for (const m of e.members || []) if (!m.geometry && !map.has(`${m.type}/${m.ref}`)) add(e, m.type, m.ref);
  }
  const elements = [...map.values()].sort((a,b) => a.type.localeCompare(b.type) || a.id - b.id);
  if (!elements.some(e => e.tags?.building || e.tags?.['building:part'])) diagnostics.push({ code: 'NO_BUILDINGS', stage: 'normalize', message: 'The extract contains no tagged buildings.', hint: 'Check the selected area; no buildings will be invented.' });
  const contentHash = hash(elements);
  const raw = { version: input.version || 0.6, generator: input.generator || 'CityInk import', elements, metadata: {
    ...legacy, name, bbox: bboxArray(area), center: [origin.lat, origin.lon], ...source,
    attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright',
    coordinateSystem: 'WGS84 / EPSG:4326', terrain: 'Flat local ground; no elevation dataset.', contentHash,
    objectVersions: elements.filter(e => e.version !== undefined).map(e => ({ type: e.type, id: e.id, version: e.version, timestamp: e.timestamp })),
    incompleteReferences: [...missing.values()]
  } };
  return { raw, diagnostics, missing: [...missing.values()], contentHash };
}
