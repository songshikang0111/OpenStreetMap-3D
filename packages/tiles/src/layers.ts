// Standard layer schemas (02 section 5.3). Writers and readers agree on names, geometry and attribute types here.
// New attributes may be appended in a minor version; readers must tolerate missing and unknown attributes.

export type GeometryType = 'polygon' | 'line' | 'point';
export type AttributeType = 'f32' | 'i32' | 'u32' | 'string';
export type Provenance = 'observed' | 'derived' | 'inferred';
export const PROVENANCE_LEVELS: readonly Provenance[] = ['observed', 'derived', 'inferred'];

export interface AttributeSpec {
  name: string;
  type: AttributeType;
}

export interface LayerSchema {
  name: string;
  geometry: GeometryType;
  elevation: boolean;
  attributes: AttributeSpec[];
  /** Attributes whose provenance is recorded (at most 16). */
  provenance: string[];
}

const f = (name: string): AttributeSpec => ({ name, type: 'f32' });
const u = (name: string): AttributeSpec => ({ name, type: 'u32' });
const i = (name: string): AttributeSpec => ({ name, type: 'i32' });
const s = (name: string): AttributeSpec => ({ name, type: 'string' });

export const LAYER_SCHEMAS: Record<string, LayerSchema> = {
  building: {
    name: 'building',
    geometry: 'polygon',
    elevation: false,
    attributes: [
      f('height'),
      f('minHeight'),
      f('levels'),
      s('roofShape'),
      f('roofHeight'),
      f('roofDirection'),
      s('facade'),
      u('facadeSeed'),
      s('usage'),
      s('partOf'),
      s('materialHint'),
      s('colour'),
      s('roofColour'),
    ],
    provenance: ['height', 'minHeight', 'levels', 'roofShape', 'roofHeight'],
  },
  road: {
    name: 'road',
    geometry: 'line',
    elevation: true,
    attributes: [s('class'), f('width'), u('lanes'), s('surface'), u('bridge'), u('tunnel'), i('layer'), u('oneway')],
    provenance: ['width', 'elevation'],
  },
  structure: {
    name: 'structure',
    geometry: 'line',
    elevation: true,
    attributes: [s('kind'), f('width'), f('thickness'), s('source')],
    provenance: ['elevation'],
  },
  water: { name: 'water', geometry: 'polygon', elevation: false, attributes: [s('kind')], provenance: [] },
  green: { name: 'green', geometry: 'polygon', elevation: false, attributes: [s('kind')], provenance: [] },
  tree: {
    name: 'tree',
    geometry: 'point',
    elevation: false,
    attributes: [s('shape'), f('height'), f('crown'), s('leafType'), s('species')],
    provenance: ['position', 'height', 'shape'],
  },
  ground: { name: 'ground', geometry: 'polygon', elevation: true, attributes: [s('kind')], provenance: [] },
  /**
   * Optional street details (lamps, signals, crossings, kerbs, parked cars, pedestrians, benches) planned at build
   * time with the phase-one rules; meshes are generated at runtime (decision E10). Minor extension of format 1.0.
   */
  detail: {
    name: 'detail',
    geometry: 'point',
    elevation: false,
    attributes: [s('kind'), f('angle'), f('size'), f('y'), f('gradeX'), f('gradeZ'), s('color')],
    provenance: ['position'],
  },
  /** Optional inferred landscape surfaces (courts, verges, planting beds) from the phase-one landscape planner. */
  landscape: {
    name: 'landscape',
    geometry: 'polygon',
    elevation: false,
    attributes: [s('kind'), s('source')],
    provenance: ['kind'],
  },
  /** L0 only: tree cover density on a 100 m grid, stored as points at cell centres. */
  treeDensity: {
    name: 'treeDensity',
    geometry: 'point',
    elevation: false,
    attributes: [f('density'), f('cellSize')],
    provenance: [],
  },
};

/** Tag keys kept on features by default; declared per tileset in tileset.json `attributes`. */
export const DEFAULT_KEPT_TAGS = [
  'name',
  'building',
  'highway',
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'landuse',
  'natural',
  'man_made',
  'addr:housenumber',
  'addr:street',
  'wikidata',
];
