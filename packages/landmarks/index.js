// Rules and provenance only. No generated model, network access or executable recipe text.
export const version = '1.0.0';
export const engineCompatibility = '>=1.0.0 <2.0.0';
const common = {
  schemaVersion: 1, engineCompatibility,
  anchor: {kind: 'source-footprint'}, orientation: {kind: 'source', radians: 0},
  materialRoles: ['glass', 'roof', 'structure'],
  source: {license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors'},
};
export const recipes = [
  {...common, id: 'china-zun', version, generator: 'city-ink/china-zun',
    match: {osm: [{type: 'way', id: 599547918}], bounds: {south: 39.90, west: 116.45, north: 39.92, east: 116.47}},
    parameters: {steps: 44, ribWidth: 0.48, ribStride: 2, crownInset: 0.88},
    provenance: {kind: 'parametric-approximation', inferred: ['taper', 'rounded-corners', 'ribs'], height: 'preserve-source', note: 'OSM height and source retained; silhouette is an illustrative approximation.'}},
  {...common, id: 'cctv-headquarters', version, generator: 'city-ink/cctv',
    match: {osm: [547523486, 547523487, 548126516, 548126517].map(id => ({type: 'way', id})), bounds: {south: 39.90, west: 116.45, north: 39.93, east: 116.47}},
    parameters: {beamWidth: 0.8, legShifts: {'548126516': [13, 23], '548126517': [-21, -11]}},
    provenance: {kind: 'parametric-approximation', inferred: ['lean', 'cantilever-connection'], height: 'preserve-source', note: 'All four OSM parts are claimed together; each height/min_height stays unchanged.'}},
];
export default {schemaVersion: 1, id: '@city-ink/landmarks', version, engineCompatibility, recipes};
