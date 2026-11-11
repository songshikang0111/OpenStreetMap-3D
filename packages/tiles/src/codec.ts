// Binary tile container (02 section 5, byte layout in 02 section 9). Little-endian, every section 4-byte aligned so
// that decoding can create typed-array views over the input buffer without copying.
import { TileError } from './diagnostics.js';
import type { AttributeSpec, AttributeType, GeometryType, Provenance } from './layers.js';
import { PROVENANCE_LEVELS } from './layers.js';
import { TILE_MAGIC } from './naming.js';
import { assertTileId, defaultExtentLog2, fitsInt16, gridStepMeters, isValidTileId, tileKey } from './mercator.js';
import type { TileId } from './mercator.js';

export const FORMAT_MAJOR = 1;
export const FORMAT_MINOR = 0;
export const HEADER_BYTES = 44;
export const DIRECTORY_ENTRY_BYTES = 20;
export const LAYER_HEADER_BYTES = 16;
export const SECTION_HEADER_BYTES = 8;
/** Vertical quantisation: 1/16 m steps in an unsigned 16-bit integer above a per-layer base. */
export const HEIGHT_STEPS_PER_METER = 16;

export type Profile = 'massing' | 'full';
const PROFILES: Profile[] = ['massing', 'full'];
const GEOMETRY_CODES: Record<GeometryType, number> = { polygon: 1, line: 2, point: 3 };
const GEOMETRY_NAMES: Record<number, GeometryType> = { 1: 'polygon', 2: 'line', 3: 'point' };
const ATTRIBUTE_CODES: Record<AttributeType, number> = { f32: 0, i32: 1, u32: 2, string: 3 };
const ATTRIBUTE_NAMES: AttributeType[] = ['f32', 'i32', 'u32', 'string'];
const ID_TYPES = ['node', 'way', 'relation', 'generated'] as const;
export const ENCODING_FEATURES = 1;
export const ENCODING_MESH = 2;
export const NO_VALUE_U32 = 0xffffffff;
export const NO_VALUE_I32 = -2147483648;

/** Section codes (02 section 9.5). Unknown codes are skipped by readers. */
export const SECTION = {
  ID_TYPE: 1,
  ID_LO: 2,
  ID_HI: 3,
  ID_SEQ: 4,
  RENDER_ID: 5,
  PART_START: 6,
  RING_START: 7,
  VERTEX_START: 8,
  POSITIONS: 9,
  ELEVATION: 10,
  PROVENANCE: 11,
  ATTRIBUTE: 12,
  TAG_START: 13,
  TAG_KEYS: 14,
  TAG_VALUES: 15,
  PROVENANCE_KEYS: 16,
  MESH_POSITION_Q: 20,
  MESH_HEIGHT_Q: 21,
  MESH_POSITION_F32: 22,
  MESH_NORMAL_OCT: 23,
  MESH_INDEX16: 24,
  MESH_INDEX32: 25,
  SUBMESHES: 26,
  VERTEX_ATTRIBUTE: 27,
  VERTEX_FEATURE16: 28,
  VERTEX_FEATURE32: 29,
} as const;

// ------------------------------------------------------------------------------------------------ public types

export type PropertyValue = number | string | null;

/** One planned feature. Geometry is parts → rings → flat [x0, y0, x1, y1, …] tile grid integers (x east, y south). */
export interface TileFeature {
  id: string;
  renderId: number;
  geometry: number[][][];
  /** Per-vertex elevation in metres, same nesting as geometry (layers with elevation only). */
  elevation?: number[][][];
  properties?: Record<string, PropertyValue>;
  provenance?: Record<string, Provenance>;
  tags?: Record<string, string>;
}

export interface FeatureLayerInput {
  type: 'features';
  geometry: GeometryType;
  elevation?: boolean;
  attributes?: AttributeSpec[];
  provenanceKeys?: string[];
  features: TileFeature[];
}

export interface MeshFeature {
  id: string;
  renderId: number;
  properties?: Record<string, PropertyValue>;
  provenance?: Record<string, Provenance>;
  tags?: Record<string, string>;
}

export interface Submesh {
  materialRole: string;
  featureIndex: number;
  indexStart: number;
  indexCount: number;
}

export interface MeshLayerInput {
  type: 'mesh';
  /** `auto` quantises to the tile grid when every vertex fits, else stores 32-bit floats. */
  positionEncoding?: 'auto' | 'quantized' | 'float32';
  /** Local metres, x east, y up, z south, interleaved xyz. */
  position: ArrayLike<number>;
  normal?: ArrayLike<number> | null;
  /** Pre-encoded octahedral normals (2 signed bytes per vertex); takes precedence over `normal`. */
  normalOct?: ArrayLike<number> | null;
  index: ArrayLike<number>;
  vertexFeature?: ArrayLike<number> | null;
  submeshes: Submesh[];
  vertexAttributes?: Record<string, { itemSize: number; array: ArrayLike<number> }>;
  attributes?: AttributeSpec[];
  provenanceKeys?: string[];
  features: MeshFeature[];
}

export interface TileInput {
  id: TileId;
  profile: Profile;
  extentLog2?: number;
  layers: Record<string, FeatureLayerInput | MeshLayerInput | FeatureLayer | MeshLayer>;
}

export interface AttributeColumn {
  name: string;
  type: AttributeType;
  values: Float32Array | Int32Array | Uint32Array;
}

/** Columnar per-feature data shared by feature and mesh layers. Arrays are views over the tile buffer. */
export interface FeatureTable {
  featureCount: number;
  idType: Uint8Array;
  idLo: Uint32Array;
  idHi: Uint32Array;
  idSeq: Uint32Array;
  renderId: Uint32Array;
  attributes: AttributeColumn[];
  provenanceKeys: string[];
  provenance: Uint32Array | null;
  tagStart: Uint32Array | null;
  tagKeys: Uint32Array | null;
  tagValues: Uint32Array | null;
  strings: string[];
}

export interface FeatureLayer extends FeatureTable {
  type: 'features';
  name: string;
  geometry: GeometryType;
  extentLog2: number;
  baseElevation: number;
  partStart: Uint32Array;
  ringStart: Uint32Array;
  vertexStart: Uint32Array;
  /** Grid integers, interleaved x, y. */
  positions: Int16Array;
  /** Raw vertical steps above baseElevation, or null when the layer has no elevation. */
  elevation: Uint16Array | null;
}

export interface MeshLayer {
  type: 'mesh';
  name: string;
  positionEncoding: 'quantized' | 'float32';
  vertexCount: number;
  /** Dequantised local metres, interleaved xyz. */
  position: Float32Array;
  normal: Float32Array | null;
  /** Raw octahedral normals as stored, used for lossless re-encoding. */
  normalOct: Int8Array | null;
  index: Uint16Array | Uint32Array;
  vertexFeature: Uint16Array | Uint32Array | null;
  submeshes: Submesh[];
  vertexAttributes: Record<string, { itemSize: number; array: Float32Array }>;
  features: FeatureTable;
}

export interface DecodedTile {
  id: TileId;
  profile: Profile;
  version: { major: number; minor: number };
  extentLog2: number;
  layers: Record<string, FeatureLayer | MeshLayer>;
  /** Layers present in the tile but not decoded (filtered out or of an unknown encoding). */
  skippedLayers: string[];
}

export interface DecodeOptions {
  layers?: string[];
}

// ------------------------------------------------------------------------------------------------ identity

export interface ParsedFeatureId {
  type: number;
  lo: number;
  hi: number;
  seq: number;
}

const ID_PATTERN = /^(node|way|relation|generated)\/(\d{1,20})(?:#(\d{1,10}))?$/;

export function parseFeatureId(id: string): ParsedFeatureId {
  const m = ID_PATTERN.exec(id);
  if (!m) throw new TileError('FEATURE_ID_INVALID', `Feature id "${id}" is not of the form type/number[#seq].`);
  const big = BigInt(m[2]!);
  if (big >= 1n << 64n) throw new TileError('FEATURE_ID_INVALID', `Feature id "${id}" exceeds 64 bits.`);
  const seq = m[3] === undefined ? 0 : Number(m[3]) + 1;
  if (seq > NO_VALUE_U32 - 1) throw new TileError('FEATURE_ID_INVALID', `Feature id "${id}" sequence is too large.`);
  return {
    type: ID_TYPES.indexOf(m[1] as (typeof ID_TYPES)[number]),
    lo: Number(big & 0xffffffffn),
    hi: Number(big >> 32n),
    seq,
  };
}

export function formatFeatureId(type: number, lo: number, hi: number, seq: number): string {
  const name = ID_TYPES[type] ?? 'generated';
  const value = hi < 0x200000 ? String(hi * 4294967296 + lo) : String((BigInt(hi) << 32n) | BigInt(lo));
  return seq ? `${name}/${value}#${seq - 1}` : `${name}/${value}`;
}

export function featureIdAt(table: FeatureTable, i: number): string {
  return formatFeatureId(table.idType[i]!, table.idLo[i]!, table.idHi[i]!, table.idSeq[i]!);
}

// ------------------------------------------------------------------------------------------------ writer

class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private reserve(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.reserve(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  u16(v: number) {
    this.reserve(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  i16(v: number) {
    this.reserve(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number) {
    this.reserve(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }
  i32(v: number) {
    this.reserve(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }
  f32(v: number) {
    this.reserve(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
  }
  i8(v: number) {
    this.reserve(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
  }
  bytes(b: Uint8Array) {
    this.reserve(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  align4() {
    while (this.length % 4) this.u8(0);
  }
  patchU32(at: number, v: number) {
    this.view.setUint32(at, v, true);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function section(w: ByteWriter, code: number, body: (w: ByteWriter) => void) {
  w.u16(code);
  w.u16(0);
  const lengthAt = w.length;
  w.u32(0);
  const start = w.length;
  body(w);
  w.patchU32(lengthAt, w.length - start);
  w.align4();
}

// ------------------------------------------------------------------------------------------------ encode

type AnyLayer = FeatureLayerInput | MeshLayerInput | FeatureLayer | MeshLayer;

function isDecodedFeatureLayer(layer: AnyLayer): layer is FeatureLayer {
  return layer.type === 'features' && 'positions' in layer;
}
function isDecodedMeshLayer(layer: AnyLayer): layer is MeshLayer {
  return layer.type === 'mesh' && 'vertexCount' in layer;
}

function fail(code: string, message: string, path: string, hint?: string): never {
  throw new TileError(code, message, { stage: 'encode', path, ...(hint ? { hint } : {}) });
}

function collectTableStrings(
  out: Set<string>,
  features: readonly (TileFeature | MeshFeature)[],
  attributes: AttributeSpec[],
  provenanceKeys: string[],
) {
  for (const a of attributes) out.add(a.name);
  for (const k of provenanceKeys) out.add(k);
  for (const feature of features) {
    for (const a of attributes) {
      const v = feature.properties?.[a.name];
      if (a.type === 'string' && typeof v === 'string') out.add(v);
    }
    for (const [k, v] of Object.entries(feature.tags ?? {})) {
      out.add(k);
      out.add(v);
    }
  }
}

function inferAttributes(features: readonly (TileFeature | MeshFeature)[]): AttributeSpec[] {
  const types = new Map<string, AttributeType>();
  for (const feature of features)
    for (const [k, v] of Object.entries(feature.properties ?? {})) {
      if (v === null) continue;
      const t: AttributeType = typeof v === 'string' ? 'string' : 'f32';
      if (!types.has(k)) types.set(k, t);
    }
  return [...types].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, type]) => ({ name, type }));
}

function inferProvenanceKeys(features: readonly (TileFeature | MeshFeature)[]): string[] {
  const keys = new Set<string>();
  for (const feature of features) for (const k of Object.keys(feature.provenance ?? {})) keys.add(k);
  return [...keys].sort();
}

function writeFeatureTable(
  w: ByteWriter,
  features: readonly (TileFeature | MeshFeature)[],
  attributes: AttributeSpec[],
  provenanceKeys: string[],
  stringIndex: (s: string) => number,
  path: string,
): number {
  let sections = 0;
  const ids = features.map((f, i) => {
    try {
      return parseFeatureId(f.id);
    } catch (error) {
      return fail('FEATURE_ID_INVALID', (error as Error).message, `${path}.features[${i}].id`);
    }
  });
  section(w, SECTION.ID_TYPE, (w) => ids.forEach((id) => w.u8(id.type)));
  section(w, SECTION.ID_LO, (w) => ids.forEach((id) => w.u32(id.lo)));
  section(w, SECTION.ID_HI, (w) => ids.forEach((id) => w.u32(id.hi)));
  section(w, SECTION.ID_SEQ, (w) => ids.forEach((id) => w.u32(id.seq)));
  section(w, SECTION.RENDER_ID, (w) =>
    features.forEach((f, i) => {
      if (!Number.isInteger(f.renderId) || f.renderId < 0 || f.renderId >= NO_VALUE_U32)
        fail('RENDER_ID_INVALID', `renderId ${f.renderId} is not a uint32.`, `${path}.features[${i}].renderId`);
      w.u32(f.renderId);
    }),
  );
  sections += 5;
  for (const attribute of attributes) {
    section(w, SECTION.ATTRIBUTE, (w) => {
      w.u32(stringIndex(attribute.name));
      w.u32(ATTRIBUTE_CODES[attribute.type]);
      features.forEach((f, i) => {
        const v = f.properties?.[attribute.name];
        const at = `${path}.features[${i}].properties.${attribute.name}`;
        if (v === undefined || v === null) {
          if (attribute.type === 'f32') w.f32(NaN);
          else if (attribute.type === 'i32') w.i32(NO_VALUE_I32);
          else w.u32(NO_VALUE_U32);
        } else if (attribute.type === 'string') {
          if (typeof v !== 'string') fail('ATTRIBUTE_TYPE', `Expected a string.`, at);
          w.u32(stringIndex(v));
        } else {
          if (typeof v !== 'number' || !Number.isFinite(v)) fail('ATTRIBUTE_TYPE', `Expected a finite number.`, at);
          if (attribute.type === 'f32') w.f32(v);
          else if (attribute.type === 'i32') {
            if (!Number.isInteger(v) || v <= NO_VALUE_I32 || v > 2147483647)
              fail('ATTRIBUTE_RANGE', `${v} is not an int32.`, at);
            w.i32(v);
          } else {
            if (!Number.isInteger(v) || v < 0 || v >= NO_VALUE_U32)
              fail('ATTRIBUTE_RANGE', `${v} is not a uint32.`, at);
            w.u32(v);
          }
        }
      });
    });
    sections++;
  }
  if (provenanceKeys.length) {
    if (provenanceKeys.length > 16)
      fail('PROVENANCE_KEYS', 'At most 16 provenance keys per layer.', `${path}.provenanceKeys`);
    section(w, SECTION.PROVENANCE_KEYS, (w) => provenanceKeys.forEach((k) => w.u32(stringIndex(k))));
    section(w, SECTION.PROVENANCE, (w) =>
      features.forEach((f, i) => {
        let bits = 0;
        for (const [k, v] of Object.entries(f.provenance ?? {})) {
          const slot = provenanceKeys.indexOf(k);
          const level = PROVENANCE_LEVELS.indexOf(v);
          if (slot < 0)
            fail('PROVENANCE_KEYS', `Undeclared provenance key "${k}".`, `${path}.features[${i}].provenance`);
          if (level < 0)
            fail('PROVENANCE_VALUE', `Unknown provenance "${v}".`, `${path}.features[${i}].provenance.${k}`);
          bits |= (level + 1) << (slot * 2);
        }
        w.u32(bits >>> 0);
      }),
    );
    sections += 2;
  }
  if (features.some((f) => f.tags && Object.keys(f.tags).length)) {
    const keys: number[] = [];
    const values: number[] = [];
    const starts: number[] = [0];
    for (const f of features) {
      for (const k of Object.keys(f.tags ?? {}).sort()) {
        keys.push(stringIndex(k));
        values.push(stringIndex(f.tags![k]!));
      }
      starts.push(keys.length);
    }
    section(w, SECTION.TAG_START, (w) => starts.forEach((v) => w.u32(v)));
    section(w, SECTION.TAG_KEYS, (w) => keys.forEach((v) => w.u32(v)));
    section(w, SECTION.TAG_VALUES, (w) => values.forEach((v) => w.u32(v)));
    sections += 3;
  }
  return sections;
}

function encodeFeatureLayer(
  layer: FeatureLayerInput,
  name: string,
  stringIndex: (s: string) => number,
): { body: Uint8Array; count: number; geometry: number } {
  const path = `layers.${name}`;
  const attributes = layer.attributes ?? inferAttributes(layer.features);
  const provenanceKeys = layer.provenanceKeys ?? inferProvenanceKeys(layer.features);
  const hasElevation = layer.elevation ?? layer.features.some((f) => f.elevation !== undefined);
  const partStart = [0];
  const ringStart = [0];
  const vertexStart = [0];
  const coords: number[] = [];
  const heights: number[] = [];
  layer.features.forEach((f, fi) => {
    if (!Array.isArray(f.geometry))
      fail('GEOMETRY_INVALID', 'geometry must be an array of parts.', `${path}.features[${fi}]`);
    f.geometry.forEach((part, pi) => {
      if (!Array.isArray(part))
        fail('GEOMETRY_INVALID', 'Each part must be an array of rings.', `${path}.features[${fi}].geometry[${pi}]`);
      part.forEach((ring, ri) => {
        const at = `${path}.features[${fi}].geometry[${pi}][${ri}]`;
        if (!Array.isArray(ring) || ring.length % 2) fail('GEOMETRY_INVALID', 'Rings are flat [x, y, …] arrays.', at);
        for (const q of ring)
          if (!Number.isInteger(q) || !fitsInt16(q))
            fail(
              'TILE_COORD_RANGE',
              `Grid coordinate ${q} is outside the int16 range.`,
              at,
              'Store oversized objects in a mesh layer with float32 positions.',
            );
        coords.push(...ring);
        const e = f.elevation?.[pi]?.[ri];
        for (let v = 0; v < ring.length / 2; v++) {
          const h = e?.[v] ?? 0;
          if (!Number.isFinite(h)) fail('ELEVATION_INVALID', 'Elevation must be finite.', at);
          heights.push(h);
        }
        vertexStart.push(coords.length / 2);
      });
      ringStart.push(vertexStart.length - 1);
    });
    partStart.push(ringStart.length - 1);
  });
  // Heights are quantised in absolute 1/16 m steps; the base is the lowest step, so re-encoding is idempotent.
  const steps = heights.map((h) => Math.round(h * HEIGHT_STEPS_PER_METER));
  const { base: baseSteps, span } = stepRange(steps);
  if (hasElevation && span > 0xffff)
    fail('ELEVATION_RANGE', `Elevation span ${span / HEIGHT_STEPS_PER_METER} m exceeds 4096 m.`, path);
  const base = hasElevation ? baseSteps / HEIGHT_STEPS_PER_METER : 0;
  const w = new ByteWriter();
  w.u32(layer.features.length);
  w.u8(ENCODING_FEATURES);
  w.u8(GEOMETRY_CODES[layer.geometry] ?? fail('GEOMETRY_TYPE', `Unknown geometry type ${layer.geometry}.`, path));
  w.u8(0);
  w.u8(0);
  w.f32(base);
  const sectionCountAt = w.length;
  w.u32(0);
  let sections = writeFeatureTable(w, layer.features, attributes, provenanceKeys, stringIndex, path);
  section(w, SECTION.PART_START, (w) => partStart.forEach((v) => w.u32(v)));
  section(w, SECTION.RING_START, (w) => ringStart.forEach((v) => w.u32(v)));
  section(w, SECTION.VERTEX_START, (w) => vertexStart.forEach((v) => w.u32(v)));
  section(w, SECTION.POSITIONS, (w) => coords.forEach((v) => w.i16(v)));
  sections += 4;
  if (hasElevation) {
    section(w, SECTION.ELEVATION, (w) => steps.forEach((s) => w.u16(s - baseSteps)));
    sections++;
  }
  w.patchU32(sectionCountAt, sections);
  return { body: w.result(), count: layer.features.length, geometry: GEOMETRY_CODES[layer.geometry] };
}

function stepRange(steps: ArrayLike<number>): { base: number; span: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]! < min) min = steps[i]!;
    if (steps[i]! > max) max = steps[i]!;
  }
  return steps.length ? { base: min, span: max - min } : { base: 0, span: 0 };
}

function octEncode(x: number, y: number, z: number): [number, number] {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l;
  let v = y / l;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const q = (t: number) => Math.max(-127, Math.min(127, Math.round(t * 127)));
  return [q(u), q(v)];
}

export function octDecode(a: number, b: number): [number, number, number] {
  let x = Math.max(-1, a / 127);
  let y = Math.max(-1, b / 127);
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function encodeMeshLayer(
  layer: MeshLayerInput,
  name: string,
  id: TileId,
  extentLog2: number,
  stringIndex: (s: string) => number,
): { body: Uint8Array; count: number } {
  const path = `layers.${name}`;
  const position = layer.position;
  if (position.length % 3) fail('MESH_INVALID', 'position length must be a multiple of 3.', `${path}.position`);
  const vertexCount = position.length / 3;
  const step = gridStepMeters(id, extentLog2);
  const quantX = new Array<number>(vertexCount);
  const quantZ = new Array<number>(vertexCount);
  const ySteps = new Array<number>(vertexCount);
  let fits = true;
  for (let v = 0; v < vertexCount; v++) {
    const x = position[v * 3]!;
    const y = position[v * 3 + 1]!;
    const z = position[v * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      fail('MESH_INVALID', 'Vertex positions must be finite.', `${path}.position[${v * 3}]`);
    quantX[v] = Math.round(x / step);
    quantZ[v] = Math.round(z / step);
    if (!fitsInt16(quantX[v]!) || !fitsInt16(quantZ[v]!)) fits = false;
    ySteps[v] = Math.round(y * HEIGHT_STEPS_PER_METER);
  }
  const { base: baseSteps, span } = stepRange(ySteps);
  const base = baseSteps / HEIGHT_STEPS_PER_METER;
  if (span > 0xffff) fits = false;
  const mode = layer.positionEncoding ?? 'auto';
  if (mode === 'quantized' && !fits)
    fail(
      'TILE_COORD_RANGE',
      'Mesh does not fit the quantised range.',
      path,
      'Use positionEncoding "float32" or "auto".',
    );
  const useFloat = mode === 'float32' || (mode === 'auto' && !fits);
  const index = layer.index;
  for (let i = 0; i < index.length; i++) {
    const v = index[i]!;
    if (!Number.isInteger(v) || v < 0 || v >= vertexCount)
      fail('MESH_INVALID', `Index ${v} is out of range.`, `${path}.index[${i}]`);
  }
  const features = layer.features;
  const attributes = layer.attributes ?? inferAttributes(features);
  const provenanceKeys = layer.provenanceKeys ?? inferProvenanceKeys(features);
  const w = new ByteWriter();
  w.u32(features.length);
  w.u8(ENCODING_MESH);
  w.u8(0);
  w.u8(useFloat ? 1 : 0);
  w.u8(0);
  w.f32(useFloat ? 0 : base);
  const sectionCountAt = w.length;
  w.u32(0);
  let sections = writeFeatureTable(w, features, attributes, provenanceKeys, stringIndex, path);
  if (useFloat) {
    section(w, SECTION.MESH_POSITION_F32, (w) => {
      for (let i = 0; i < position.length; i++) w.f32(position[i]!);
    });
    sections++;
  } else {
    section(w, SECTION.MESH_POSITION_Q, (w) => {
      for (let v = 0; v < vertexCount; v++) {
        w.i16(quantX[v]!);
        w.i16(quantZ[v]!);
      }
    });
    section(w, SECTION.MESH_HEIGHT_Q, (w) => {
      for (let v = 0; v < vertexCount; v++) w.u16(ySteps[v]! - baseSteps);
    });
    sections += 2;
  }
  if (layer.normalOct) {
    const oct = layer.normalOct;
    if (oct.length !== vertexCount * 2)
      fail('MESH_INVALID', 'normalOct length must be twice the vertex count.', `${path}.normalOct`);
    section(w, SECTION.MESH_NORMAL_OCT, (w) => {
      for (let i = 0; i < oct.length; i++) w.i8(Math.max(-127, Math.min(127, Math.round(oct[i]!))));
    });
    sections++;
  } else if (layer.normal) {
    if (layer.normal.length !== position.length)
      fail('MESH_INVALID', 'normal length must match position.', `${path}.normal`);
    const normal = layer.normal;
    section(w, SECTION.MESH_NORMAL_OCT, (w) => {
      for (let v = 0; v < vertexCount; v++) {
        const [a, b] = octEncode(normal[v * 3]!, normal[v * 3 + 1]!, normal[v * 3 + 2]!);
        w.i8(a);
        w.i8(b);
      }
    });
    sections++;
  }
  const wide = vertexCount > 0xffff;
  section(w, wide ? SECTION.MESH_INDEX32 : SECTION.MESH_INDEX16, (w) => {
    for (let i = 0; i < index.length; i++) wide ? w.u32(index[i]!) : w.u16(index[i]!);
  });
  section(w, SECTION.SUBMESHES, (w) =>
    layer.submeshes.forEach((s, i) => {
      const at = `${path}.submeshes[${i}]`;
      if (
        !(s.featureIndex >= 0 && s.featureIndex < Math.max(1, features.length)) &&
        !(features.length === 0 && s.featureIndex === 0)
      )
        fail('MESH_INVALID', 'featureIndex out of range.', at);
      if (s.indexStart < 0 || s.indexCount < 0 || s.indexStart + s.indexCount > index.length)
        fail('MESH_INVALID', 'Index range out of bounds.', at);
      w.u32(stringIndex(s.materialRole));
      w.u32(s.featureIndex);
      w.u32(s.indexStart);
      w.u32(s.indexCount);
    }),
  );
  sections += 2;
  if (layer.vertexFeature) {
    const vf = layer.vertexFeature;
    if (vf.length !== vertexCount)
      fail('MESH_INVALID', 'vertexFeature length must equal the vertex count.', `${path}.vertexFeature`);
    const wideFeature = features.length > 0xffff;
    section(w, wideFeature ? SECTION.VERTEX_FEATURE32 : SECTION.VERTEX_FEATURE16, (w) => {
      for (let v = 0; v < vertexCount; v++) {
        if (!(vf[v]! >= 0 && vf[v]! < features.length))
          fail('MESH_INVALID', 'vertexFeature out of range.', `${path}.vertexFeature[${v}]`);
        wideFeature ? w.u32(vf[v]!) : w.u16(vf[v]!);
      }
    });
    sections++;
  }
  for (const attrName of Object.keys(layer.vertexAttributes ?? {}).sort()) {
    const attr = layer.vertexAttributes![attrName]!;
    if (
      !Number.isInteger(attr.itemSize) ||
      attr.itemSize < 1 ||
      attr.itemSize > 16 ||
      attr.array.length !== attr.itemSize * vertexCount
    )
      fail('MESH_INVALID', 'Vertex attribute size mismatch.', `${path}.vertexAttributes.${attrName}`);
    section(w, SECTION.VERTEX_ATTRIBUTE, (w) => {
      w.u32(stringIndex(attrName));
      w.u32(attr.itemSize);
      for (let i = 0; i < attr.array.length; i++) w.f32(attr.array[i]!);
    });
    sections++;
  }
  w.patchU32(sectionCountAt, sections);
  return { body: w.result(), count: features.length };
}

/** Converts a decoded layer back into its input form (used by re-encoding and round-trip tests). */
export function layerToInput(layer: FeatureLayer | MeshLayer): FeatureLayerInput | MeshLayerInput {
  if (layer.type === 'features')
    return {
      type: 'features',
      geometry: layer.geometry,
      elevation: layer.elevation !== null,
      attributes: layer.attributes.map((a) => ({ name: a.name, type: a.type })),
      provenanceKeys: [...layer.provenanceKeys],
      features: readFeatures(layer),
    };
  const out: MeshLayerInput = {
    type: 'mesh',
    positionEncoding: layer.positionEncoding,
    position: layer.position,
    normal: layer.normal,
    normalOct: layer.normalOct,
    index: layer.index,
    vertexFeature: layer.vertexFeature,
    submeshes: layer.submeshes.map((s) => ({ ...s })),
    vertexAttributes: layer.vertexAttributes,
    attributes: layer.features.attributes.map((a) => ({ name: a.name, type: a.type })),
    provenanceKeys: [...layer.features.provenanceKeys],
    features: readFeatureMeta(layer.features),
  };
  return out;
}

/** Encodes a tile. Layers may be given in input form or as previously decoded layers. */
export function encodeTile(tile: TileInput | DecodedTile): Uint8Array {
  if (!isValidTileId(tile.id)) assertTileId(tile.id);
  const profile = PROFILES.indexOf(tile.profile);
  if (profile < 0) fail('PROFILE_INVALID', `Unknown profile ${tile.profile}.`, 'profile');
  const extentLog2 = tile.extentLog2 ?? defaultExtentLog2(tile.id.z);
  if (!Number.isInteger(extentLog2) || extentLog2 < 8 || extentLog2 > 20)
    fail('EXTENT_INVALID', 'extentLog2 must be in [8, 20].', 'extentLog2');
  const names = Object.keys(tile.layers).sort();
  if (names.length > 0xffff) fail('LAYER_COUNT', 'Too many layers.', 'layers');
  const inputs = names.map((n) => {
    const layer = tile.layers[n] as AnyLayer;
    if (isDecodedFeatureLayer(layer) || isDecodedMeshLayer(layer)) return layerToInput(layer);
    if (layer.type !== 'features' && layer.type !== 'mesh') fail('LAYER_TYPE', `Unknown layer type.`, `layers.${n}`);
    return layer;
  });
  const strings = new Set<string>(names);
  inputs.forEach((layer) => {
    const features = layer.features;
    collectTableStrings(
      strings,
      features,
      layer.attributes ?? inferAttributes(features),
      layer.provenanceKeys ?? inferProvenanceKeys(features),
    );
    if (layer.type === 'mesh') {
      layer.submeshes.forEach((s) => strings.add(s.materialRole));
      Object.keys(layer.vertexAttributes ?? {}).forEach((k) => strings.add(k));
    }
  });
  const table = [...strings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lookup = new Map(table.map((s, i) => [s, i]));
  const stringIndex = (s: string) => lookup.get(s)!;
  const bodies = inputs.map((layer, i) =>
    layer.type === 'features'
      ? encodeFeatureLayer(layer, names[i]!, stringIndex)
      : { ...encodeMeshLayer(layer, names[i]!, tile.id, extentLog2, stringIndex), geometry: 0 },
  );
  const encoder = new TextEncoder();
  const encoded = table.map((s) => encoder.encode(s));
  const w = new ByteWriter();
  // header
  w.bytes(TILE_MAGIC);
  w.u16(FORMAT_MAJOR);
  w.u16(FORMAT_MINOR);
  w.u16(HEADER_BYTES);
  w.u8(profile);
  w.u8(extentLog2);
  w.u8(tile.id.z);
  w.u8(0);
  w.u16(names.length);
  w.u32(tile.id.x);
  w.u32(tile.id.y);
  const dirOffsetAt = w.length;
  w.u32(0);
  const stringsOffsetAt = w.length;
  w.u32(0);
  const stringsLengthAt = w.length;
  w.u32(0);
  const totalAt = w.length;
  w.u32(0);
  w.u16(DIRECTORY_ENTRY_BYTES);
  w.u16(0);
  // directory (patched after layers are placed)
  w.patchU32(dirOffsetAt, w.length);
  const dirStart = w.length;
  for (let i = 0; i < names.length * DIRECTORY_ENTRY_BYTES; i++) w.u8(0);
  // string table
  w.patchU32(stringsOffsetAt, w.length);
  const stringsStart = w.length;
  w.u32(table.length);
  let offset = 0;
  w.u32(0);
  for (const bytes of encoded) {
    offset += bytes.length;
    w.u32(offset);
  }
  encoded.forEach((b) => w.bytes(b));
  w.align4();
  w.patchU32(stringsLengthAt, w.length - stringsStart);
  // layers
  const placed = bodies.map((b) => {
    const at = w.length;
    w.bytes(b.body);
    w.align4();
    return at;
  });
  const out = w.result();
  const view = new DataView(out.buffer);
  names.forEach((n, i) => {
    const at = dirStart + i * DIRECTORY_ENTRY_BYTES;
    const layer = inputs[i]!;
    view.setUint32(at, stringIndex(n), true);
    view.setUint8(at + 4, layer.type === 'features' ? ENCODING_FEATURES : ENCODING_MESH);
    view.setUint8(at + 5, bodies[i]!.geometry);
    view.setUint32(at + 8, placed[i]!, true);
    view.setUint32(at + 12, bodies[i]!.body.length, true);
    view.setUint32(at + 16, bodies[i]!.count, true);
  });
  view.setUint32(totalAt, out.length, true);
  return out;
}

// ------------------------------------------------------------------------------------------------ decode

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

class Reader {
  readonly view: DataView;
  constructor(
    readonly buffer: ArrayBuffer,
    readonly tileId: string,
  ) {
    this.view = new DataView(buffer);
  }
  bad(code: string, message: string): never {
    throw new TileError(code, message, {
      stage: 'decode',
      tileId: this.tileId,
      hint: 'The tile is truncated or corrupt; rebuild it or check the server response.',
    });
  }
  check(offset: number, length: number, what: string) {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.buffer.byteLength
    )
      this.bad(
        'TILE_TRUNCATED',
        `${what} at byte ${offset} (+${length}) exceeds the tile length ${this.buffer.byteLength}.`,
      );
  }
  u8(at: number) {
    this.check(at, 1, 'u8');
    return this.view.getUint8(at);
  }
  u16(at: number) {
    this.check(at, 2, 'u16');
    return this.view.getUint16(at, true);
  }
  u32(at: number) {
    this.check(at, 4, 'u32');
    return this.view.getUint32(at, true);
  }
  f32(at: number) {
    this.check(at, 4, 'f32');
    return this.view.getFloat32(at, true);
  }
  typed<T extends Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array>(
    Ctor: { new (b: ArrayBuffer, o: number, n: number): T; new (n: number): T; BYTES_PER_ELEMENT: number },
    at: number,
    byteLength: number,
    what: string,
  ): T {
    const size = Ctor.BYTES_PER_ELEMENT;
    const C: unknown = Ctor;
    if (byteLength % size) this.bad('TILE_SECTION_SIZE', `${what} length ${byteLength} is not a multiple of ${size}.`);
    this.check(at, byteLength, what);
    const count = byteLength / size;
    if (LITTLE_ENDIAN && at % size === 0) return new Ctor(this.buffer, at, count);
    const out = new Ctor(count);
    for (let i = 0; i < count; i++) {
      const o = at + i * size;
      (out as unknown as number[])[i] =
        size === 1
          ? C === Int8Array
            ? this.view.getInt8(o)
            : this.view.getUint8(o)
          : size === 2
            ? C === Int16Array
              ? this.view.getInt16(o, true)
              : this.view.getUint16(o, true)
            : C === Float32Array
              ? this.view.getFloat32(o, true)
              : C === Int32Array
                ? this.view.getInt32(o, true)
                : this.view.getUint32(o, true);
    }
    return out;
  }
}

interface RawSection {
  code: number;
  at: number;
  length: number;
}

function readSections(r: Reader, start: number, end: number, count: number, layer: string): RawSection[] {
  const out: RawSection[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + SECTION_HEADER_BYTES > end)
      r.bad('TILE_LAYER_CORRUPT', `Layer ${layer} declares ${count} sections but ends after ${i}.`);
    const code = r.u16(at);
    const length = r.u32(at + 4);
    const body = at + SECTION_HEADER_BYTES;
    if (length > end - body) r.bad('TILE_LAYER_CORRUPT', `Section ${code} of layer ${layer} overruns the layer.`);
    out.push({ code, at: body, length });
    at = body + length + ((4 - (length % 4)) % 4);
  }
  return out;
}

function offsets(r: Reader, arr: Uint32Array, expectedLength: number, last: number | null, what: string): Uint32Array {
  if (arr.length !== expectedLength)
    r.bad('TILE_LAYER_CORRUPT', `${what} has ${arr.length} entries, expected ${expectedLength}.`);
  if (expectedLength && arr[0] !== 0) r.bad('TILE_LAYER_CORRUPT', `${what} must start at 0.`);
  for (let i = 1; i < arr.length; i++)
    if (arr[i]! < arr[i - 1]!) r.bad('TILE_LAYER_CORRUPT', `${what} is not monotonic.`);
  if (last !== null && expectedLength && arr[arr.length - 1] !== last)
    r.bad('TILE_LAYER_CORRUPT', `${what} ends at ${arr[arr.length - 1]}, expected ${last}.`);
  return arr;
}

function readFeatureTableSections(
  r: Reader,
  sections: RawSection[],
  n: number,
  strings: string[],
  layer: string,
): FeatureTable {
  const one = (code: number) => sections.find((s) => s.code === code);
  const need = (code: number, what: string) =>
    one(code) ?? r.bad('TILE_LAYER_CORRUPT', `Layer ${layer} lacks ${what}.`);
  const u32s = (code: number, what: string, expected: number) => {
    const s = need(code, what);
    const arr = r.typed(Uint32Array, s.at, s.length, what);
    if (arr.length !== expected)
      r.bad('TILE_LAYER_CORRUPT', `${what} of ${layer} has ${arr.length} entries, expected ${expected}.`);
    return arr;
  };
  const idTypeSection = need(SECTION.ID_TYPE, 'feature id types');
  const idType = r.typed(Uint8Array, idTypeSection.at, idTypeSection.length, 'id types');
  if (idType.length !== n)
    r.bad('TILE_LAYER_CORRUPT', `id types of ${layer} has ${idType.length} entries, expected ${n}.`);
  const table: FeatureTable = {
    featureCount: n,
    idType,
    idLo: u32s(SECTION.ID_LO, 'id low words', n),
    idHi: u32s(SECTION.ID_HI, 'id high words', n),
    idSeq: u32s(SECTION.ID_SEQ, 'id sequences', n),
    renderId: u32s(SECTION.RENDER_ID, 'render ids', n),
    attributes: [],
    provenanceKeys: [],
    provenance: null,
    tagStart: null,
    tagKeys: null,
    tagValues: null,
    strings,
  };
  const stringRef = (i: number, what: string) => {
    if (i >= strings.length)
      r.bad('TILE_LAYER_CORRUPT', `${what} in ${layer} references string ${i} of ${strings.length}.`);
    return strings[i]!;
  };
  for (const s of sections.filter((s) => s.code === SECTION.ATTRIBUTE)) {
    if (s.length < 8) r.bad('TILE_LAYER_CORRUPT', `Attribute section of ${layer} is too short.`);
    const name = stringRef(r.u32(s.at), 'attribute name');
    const type = ATTRIBUTE_NAMES[r.u32(s.at + 4)];
    if (!type) continue; // unknown attribute encoding from a newer minor version
    const Ctor = type === 'f32' ? Float32Array : type === 'i32' ? Int32Array : Uint32Array;
    const values = r.typed(Ctor as typeof Uint32Array, s.at + 8, s.length - 8, `attribute ${name}`);
    if (values.length !== n)
      r.bad('TILE_LAYER_CORRUPT', `Attribute ${name} of ${layer} has ${values.length} values, expected ${n}.`);
    if (type === 'string')
      for (const v of values as Uint32Array)
        if (v !== NO_VALUE_U32 && v >= strings.length) stringRef(v, `attribute ${name}`);
    table.attributes.push({ name, type, values });
  }
  const pk = one(SECTION.PROVENANCE_KEYS);
  if (pk) {
    const keys = r.typed(Uint32Array, pk.at, pk.length, 'provenance keys');
    if (keys.length > 16) r.bad('TILE_LAYER_CORRUPT', `Layer ${layer} declares more than 16 provenance keys.`);
    table.provenanceKeys = [...keys].map((k) => stringRef(k, 'provenance key'));
    table.provenance = u32s(SECTION.PROVENANCE, 'provenance', n);
  }
  const ts = one(SECTION.TAG_START);
  if (ts) {
    const tagStart = r.typed(Uint32Array, ts.at, ts.length, 'tag starts');
    const keys = u32s(SECTION.TAG_KEYS, 'tag keys', tagStart[tagStart.length - 1] ?? 0);
    const values = u32s(SECTION.TAG_VALUES, 'tag values', keys.length);
    offsets(r, tagStart, n + 1, keys.length, `tag starts of ${layer}`);
    for (let i = 0; i < keys.length; i++) {
      stringRef(keys[i]!, 'tag key');
      stringRef(values[i]!, 'tag value');
    }
    table.tagStart = tagStart;
    table.tagKeys = keys;
    table.tagValues = values;
  }
  return table;
}

function decodeFeatureLayer(
  r: Reader,
  name: string,
  start: number,
  end: number,
  strings: string[],
  extentLog2: number,
): FeatureLayer {
  const n = r.u32(start);
  const geometry =
    GEOMETRY_NAMES[r.u8(start + 5)] ?? r.bad('TILE_LAYER_CORRUPT', `Layer ${name} has an unknown geometry type.`);
  const baseElevation = r.f32(start + 8);
  if (!Number.isFinite(baseElevation)) r.bad('TILE_LAYER_CORRUPT', `Layer ${name} has a non-finite base elevation.`);
  const sectionCount = r.u32(start + 12);
  if (n > (end - start) / 4)
    r.bad('TILE_LAYER_CORRUPT', `Layer ${name} declares ${n} features in ${end - start} bytes.`);
  const sections = readSections(r, start + LAYER_HEADER_BYTES, end, sectionCount, name);
  const table = readFeatureTableSections(r, sections, n, strings, name);
  const need = (code: number, what: string) =>
    sections.find((s) => s.code === code) ?? r.bad('TILE_LAYER_CORRUPT', `Layer ${name} lacks ${what}.`);
  const ps = need(SECTION.PART_START, 'part starts');
  const rs = need(SECTION.RING_START, 'ring starts');
  const vs = need(SECTION.VERTEX_START, 'vertex starts');
  const pos = need(SECTION.POSITIONS, 'positions');
  const ringStart = r.typed(Uint32Array, rs.at, rs.length, 'ring starts');
  const vertexStart = r.typed(Uint32Array, vs.at, vs.length, 'vertex starts');
  const positions = r.typed(Int16Array, pos.at, pos.length, 'positions');
  const partStart = offsets(
    r,
    r.typed(Uint32Array, ps.at, ps.length, 'part starts'),
    n + 1,
    Math.max(0, ringStart.length - 1),
    `part starts of ${name}`,
  );
  offsets(r, ringStart, ringStart.length, Math.max(0, vertexStart.length - 1), `ring starts of ${name}`);
  offsets(r, vertexStart, vertexStart.length, positions.length / 2, `vertex starts of ${name}`);
  if (positions.length % 2) r.bad('TILE_LAYER_CORRUPT', `Positions of ${name} are not pairs.`);
  const es = sections.find((s) => s.code === SECTION.ELEVATION);
  const elevation = es ? r.typed(Uint16Array, es.at, es.length, 'elevation') : null;
  if (elevation && elevation.length !== positions.length / 2)
    r.bad('TILE_LAYER_CORRUPT', `Elevation of ${name} does not match its vertices.`);
  return {
    type: 'features',
    name,
    geometry,
    extentLog2,
    baseElevation,
    ...table,
    partStart,
    ringStart,
    vertexStart,
    positions,
    elevation,
  };
}

function decodeMeshLayer(
  r: Reader,
  name: string,
  start: number,
  end: number,
  strings: string[],
  id: TileId,
  extentLog2: number,
): MeshLayer {
  const n = r.u32(start);
  const flags = r.u8(start + 6);
  const base = r.f32(start + 8);
  if (!Number.isFinite(base)) r.bad('TILE_LAYER_CORRUPT', `Layer ${name} has a non-finite base elevation.`);
  const sectionCount = r.u32(start + 12);
  if (n > (end - start) / 4)
    r.bad('TILE_LAYER_CORRUPT', `Layer ${name} declares ${n} features in ${end - start} bytes.`);
  const sections = readSections(r, start + LAYER_HEADER_BYTES, end, sectionCount, name);
  const features = readFeatureTableSections(r, sections, n, strings, name);
  const one = (code: number) => sections.find((s) => s.code === code);
  const useFloat = (flags & 1) === 1;
  let position: Float32Array;
  if (useFloat) {
    const s = one(SECTION.MESH_POSITION_F32) ?? r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} lacks float positions.`);
    position = r.typed(Float32Array, s.at, s.length, 'mesh positions');
    if (position.length % 3) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} positions are not triples.`);
    for (const v of position)
      if (!Number.isFinite(v)) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} has non-finite positions.`);
  } else {
    const s = one(SECTION.MESH_POSITION_Q) ?? r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} lacks positions.`);
    const h = one(SECTION.MESH_HEIGHT_Q) ?? r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} lacks heights.`);
    const xz = r.typed(Int16Array, s.at, s.length, 'mesh positions');
    const y = r.typed(Uint16Array, h.at, h.length, 'mesh heights');
    if (xz.length !== y.length * 2) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} position and height counts differ.`);
    const step = gridStepMeters(id, extentLog2);
    position = new Float32Array(y.length * 3);
    for (let v = 0; v < y.length; v++) {
      position[v * 3] = xz[v * 2]! * step;
      position[v * 3 + 1] = base + y[v]! / HEIGHT_STEPS_PER_METER;
      position[v * 3 + 2] = xz[v * 2 + 1]! * step;
    }
  }
  const vertexCount = position.length / 3;
  let normal: Float32Array | null = null;
  let normalOct: Int8Array | null = null;
  const ns = one(SECTION.MESH_NORMAL_OCT);
  if (ns) {
    const oct = r.typed(Int8Array, ns.at, ns.length, 'mesh normals');
    normalOct = oct;
    if (oct.length !== vertexCount * 2) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} normal count differs from vertices.`);
    normal = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      const [x, y, z] = octDecode(oct[v * 2]!, oct[v * 2 + 1]!);
      normal[v * 3] = x;
      normal[v * 3 + 1] = y;
      normal[v * 3 + 2] = z;
    }
  }
  const i16 = one(SECTION.MESH_INDEX16);
  const i32 = one(SECTION.MESH_INDEX32);
  const index = i16
    ? r.typed(Uint16Array, i16.at, i16.length, 'mesh indices')
    : i32
      ? r.typed(Uint32Array, i32.at, i32.length, 'mesh indices')
      : r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} lacks indices.`);
  for (let i = 0; i < index.length; i++)
    if (index[i]! >= vertexCount) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} index out of range.`);
  const ss = one(SECTION.SUBMESHES) ?? r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} lacks submeshes.`);
  const rawSub = r.typed(Uint32Array, ss.at, ss.length, 'submeshes');
  if (rawSub.length % 4) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} submesh table is malformed.`);
  const submeshes: Submesh[] = [];
  for (let i = 0; i < rawSub.length; i += 4) {
    const role = rawSub[i]!;
    if (role >= strings.length) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} submesh role is out of range.`);
    const sub = {
      materialRole: strings[role]!,
      featureIndex: rawSub[i + 1]!,
      indexStart: rawSub[i + 2]!,
      indexCount: rawSub[i + 3]!,
    };
    if (sub.indexStart + sub.indexCount > index.length || (n > 0 && sub.featureIndex >= n))
      r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} submesh ${i / 4} is out of range.`);
    submeshes.push(sub);
  }
  let vertexFeature: Uint16Array | Uint32Array | null = null;
  const vf16 = one(SECTION.VERTEX_FEATURE16);
  const vf32 = one(SECTION.VERTEX_FEATURE32);
  if (vf16 || vf32) {
    vertexFeature = vf16
      ? r.typed(Uint16Array, vf16.at, vf16.length, 'vertex features')
      : r.typed(Uint32Array, vf32!.at, vf32!.length, 'vertex features');
    if (vertexFeature.length !== vertexCount) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} vertex feature count differs.`);
    for (const f of vertexFeature) if (f >= n) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} vertex feature out of range.`);
  }
  const vertexAttributes: Record<string, { itemSize: number; array: Float32Array }> = {};
  for (const s of sections.filter((s) => s.code === SECTION.VERTEX_ATTRIBUTE)) {
    if (s.length < 8) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} vertex attribute is too short.`);
    const key = r.u32(s.at);
    if (key >= strings.length) r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} vertex attribute name is out of range.`);
    const itemSize = r.u32(s.at + 4);
    const array = r.typed(Float32Array, s.at + 8, s.length - 8, 'vertex attribute');
    if (itemSize < 1 || itemSize > 16 || array.length !== itemSize * vertexCount)
      r.bad('TILE_LAYER_CORRUPT', `Mesh ${name} vertex attribute ${strings[key]} has the wrong size.`);
    vertexAttributes[strings[key]!] = { itemSize, array };
  }
  return {
    type: 'mesh',
    name,
    positionEncoding: useFloat ? 'float32' : 'quantized',
    vertexCount,
    position,
    normal,
    normalOct,
    index,
    vertexFeature,
    submeshes,
    vertexAttributes,
    features,
  };
}

/** Reads only the header (z/x/y, profile, version, layer directory) without decoding layers. */
export function readTileHeader(input: ArrayBuffer | Uint8Array) {
  const buffer = toArrayBuffer(input);
  const r = new Reader(buffer, 'unknown');
  if (buffer.byteLength < HEADER_BYTES)
    r.bad('TILE_TRUNCATED', `Tile is ${buffer.byteLength} bytes, shorter than the header.`);
  for (let i = 0; i < 4; i++)
    if (r.u8(i) !== TILE_MAGIC[i]) r.bad('TILE_MAGIC', 'Not a tile: the magic bytes do not match.');
  const major = r.u16(4);
  const minor = r.u16(6);
  if (major !== FORMAT_MAJOR)
    throw new TileError(
      'TILE_VERSION_UNSUPPORTED',
      `Tile format ${major}.${minor} is not supported by this reader (${FORMAT_MAJOR}.x).`,
      {
        stage: 'decode',
        hint:
          major > FORMAT_MAJOR
            ? 'Upgrade the runtime to a version that supports this tile format.'
            : 'Rebuild the tiles with a current builder.',
      },
    );
  const headerBytes = r.u16(8);
  const profile = PROFILES[r.u8(10)] ?? r.bad('TILE_HEADER_CORRUPT', 'Unknown content profile.');
  const extentLog2 = r.u8(11);
  if (extentLog2 < 8 || extentLog2 > 20) r.bad('TILE_HEADER_CORRUPT', `Invalid grid extent 2^${extentLog2}.`);
  const id = { z: r.u8(12), x: r.u32(16), y: r.u32(20) };
  if (!isValidTileId(id)) r.bad('TILE_HEADER_CORRUPT', `Invalid tile id ${JSON.stringify(id)}.`);
  const layerCount = r.u16(14);
  const dirOffset = r.u32(24);
  const stringsOffset = r.u32(28);
  const stringsLength = r.u32(32);
  const total = r.u32(36);
  const entryBytes = r.u16(40);
  if (headerBytes < HEADER_BYTES || entryBytes < DIRECTORY_ENTRY_BYTES)
    r.bad('TILE_HEADER_CORRUPT', 'Header or directory entry is too small.');
  if (total > buffer.byteLength)
    r.bad('TILE_TRUNCATED', `Tile declares ${total} bytes but only ${buffer.byteLength} are present.`);
  r.check(dirOffset, layerCount * entryBytes, 'layer directory');
  r.check(stringsOffset, stringsLength, 'string table');
  const entries = [];
  for (let i = 0; i < layerCount; i++) {
    const at = dirOffset + i * entryBytes;
    entries.push({
      nameIndex: r.u32(at),
      encoding: r.u8(at + 4),
      geometry: r.u8(at + 5),
      offset: r.u32(at + 8),
      length: r.u32(at + 12),
      featureCount: r.u32(at + 16),
    });
  }
  return {
    buffer,
    reader: r,
    id,
    profile,
    version: { major, minor },
    extentLog2,
    stringsOffset,
    stringsLength,
    entries,
  };
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    if (
      input.byteOffset % 4 === 0 &&
      input.buffer instanceof ArrayBuffer &&
      input.byteLength === input.buffer.byteLength
    )
      return input.buffer;
    // Uint8Array.prototype.slice always copies (Node's Buffer#slice would return a view into a shared pool).
    return Uint8Array.prototype.slice.call(input).buffer as ArrayBuffer;
  }
  if (input instanceof ArrayBuffer) return input;
  throw new TileError('TILE_INPUT_INVALID', 'decodeTile expects an ArrayBuffer or Uint8Array.', { stage: 'decode' });
}

function readStrings(r: Reader, at: number, length: number): string[] {
  const end = at + length;
  const count = r.u32(at);
  if (count > (length - 8) / 4)
    r.bad('TILE_STRINGS_CORRUPT', `String table declares ${count} strings in ${length} bytes.`);
  const offsetsAt = at + 4;
  const dataAt = offsetsAt + (count + 1) * 4;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bytes = new Uint8Array(r.buffer);
  const out = new Array<string>(count);
  let previous = r.u32(offsetsAt);
  if (previous !== 0) r.bad('TILE_STRINGS_CORRUPT', 'String offsets must start at 0.');
  for (let i = 0; i < count; i++) {
    const next = r.u32(offsetsAt + (i + 1) * 4);
    if (next < previous || dataAt + next > end) r.bad('TILE_STRINGS_CORRUPT', `String ${i} is out of range.`);
    try {
      out[i] = decoder.decode(bytes.subarray(dataAt + previous, dataAt + next));
    } catch {
      r.bad('TILE_STRINGS_CORRUPT', `String ${i} is not valid UTF-8.`);
    }
    previous = next;
  }
  return out;
}

/** Synchronous, pure decoder. Throws TileError (with code/stage/message/hint) for any malformed input. */
export function decodeTile(input: ArrayBuffer | Uint8Array, options: DecodeOptions = {}): DecodedTile {
  try {
    const head = readTileHeader(input);
    const r = new Reader(head.buffer, tileKey(head.id));
    const strings = readStrings(r, head.stringsOffset, head.stringsLength);
    const wanted = options.layers ? new Set(options.layers) : null;
    const tile: DecodedTile = {
      id: head.id,
      profile: head.profile,
      version: head.version,
      extentLog2: head.extentLog2,
      layers: {},
      skippedLayers: [],
    };
    for (const entry of head.entries) {
      if (entry.nameIndex >= strings.length) r.bad('TILE_HEADER_CORRUPT', 'Layer name is out of range.');
      const name = strings[entry.nameIndex]!;
      if (Object.prototype.hasOwnProperty.call(tile.layers, name))
        r.bad('TILE_HEADER_CORRUPT', `Layer ${name} appears twice.`);
      r.check(entry.offset, entry.length, `layer ${name}`);
      if (entry.length < LAYER_HEADER_BYTES || entry.offset % 4)
        r.bad('TILE_LAYER_CORRUPT', `Layer ${name} is malformed.`);
      if ((wanted && !wanted.has(name)) || (entry.encoding !== ENCODING_FEATURES && entry.encoding !== ENCODING_MESH)) {
        tile.skippedLayers.push(name);
        continue;
      }
      const end = entry.offset + entry.length;
      const layer =
        entry.encoding === ENCODING_FEATURES
          ? decodeFeatureLayer(r, name, entry.offset, end, strings, head.extentLog2)
          : decodeMeshLayer(r, name, entry.offset, end, strings, head.id, head.extentLog2);
      const declared = layer.type === 'features' ? layer.featureCount : layer.features.featureCount;
      if (declared !== entry.featureCount)
        r.bad('TILE_LAYER_CORRUPT', `Layer ${name} feature count differs from the directory.`);
      tile.layers[name] = layer;
    }
    return tile;
  } catch (error) {
    if (error instanceof TileError) throw error;
    // Defensive: any unexpected engine error is converted to a structured one.
    throw new TileError(
      'TILE_DECODE_FAILED',
      `Tile could not be decoded: ${(error as Error)?.message ?? String(error)}.`,
      { stage: 'decode' },
    );
  }
}

/** Non-throwing variant for callers that prefer result objects. */
export function tryDecodeTile(input: ArrayBuffer | Uint8Array, options?: DecodeOptions) {
  try {
    return { ok: true as const, tile: decodeTile(input, options) };
  } catch (error) {
    return { ok: false as const, diagnostic: (error as TileError).toDiagnostic() };
  }
}

// ------------------------------------------------------------------------------------------------ readers

function readProperties(table: FeatureTable, i: number): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const a of table.attributes) {
    const v = a.values[i]!;
    if (a.type === 'string') out[a.name] = v === NO_VALUE_U32 ? null : table.strings[v]!;
    else if (a.type === 'f32') out[a.name] = Number.isNaN(v) ? null : v;
    else if (a.type === 'i32') out[a.name] = v === NO_VALUE_I32 ? null : v;
    else out[a.name] = v === NO_VALUE_U32 ? null : v;
  }
  return out;
}

export function readProvenance(table: FeatureTable, i: number): Record<string, Provenance> {
  const out: Record<string, Provenance> = {};
  if (!table.provenance) return out;
  const bits = table.provenance[i]!;
  table.provenanceKeys.forEach((k, slot) => {
    const level = (bits >>> (slot * 2)) & 3;
    if (level) out[k] = PROVENANCE_LEVELS[level - 1]!;
  });
  return out;
}

function readTags(table: FeatureTable, i: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!table.tagStart) return out;
  for (let t = table.tagStart[i]!; t < table.tagStart[i + 1]!; t++)
    out[table.strings[table.tagKeys![t]!]!] = table.strings[table.tagValues![t]!]!;
  return out;
}

/** Materialises one feature's metadata (id, renderId, properties, provenance, tags). */
export function readFeatureMetaAt(table: FeatureTable, i: number): MeshFeature {
  return {
    id: featureIdAt(table, i),
    renderId: table.renderId[i]!,
    properties: readProperties(table, i),
    provenance: readProvenance(table, i),
    tags: readTags(table, i),
  };
}

export function readFeatureMeta(table: FeatureTable): MeshFeature[] {
  const out: MeshFeature[] = [];
  for (let i = 0; i < table.featureCount; i++) out.push(readFeatureMetaAt(table, i));
  return out;
}

/** Materialises one planned feature, including geometry in grid integers and elevation in metres. */
export function readFeature(layer: FeatureLayer, i: number): TileFeature {
  const geometry: number[][][] = [];
  const elevation: number[][][] = [];
  for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++) {
    const rings: number[][] = [];
    const ringHeights: number[][] = [];
    for (let ring = layer.ringStart[p]!; ring < layer.ringStart[p + 1]!; ring++) {
      const a = layer.vertexStart[ring]!;
      const b = layer.vertexStart[ring + 1]!;
      rings.push(Array.from(layer.positions.subarray(a * 2, b * 2)));
      if (layer.elevation)
        ringHeights.push(
          Array.from(layer.elevation.subarray(a, b), (h) => layer.baseElevation + h / HEIGHT_STEPS_PER_METER),
        );
    }
    geometry.push(rings);
    elevation.push(ringHeights);
  }
  const feature: TileFeature = { ...readFeatureMetaAt(layer, i), geometry };
  if (layer.elevation) feature.elevation = elevation;
  return feature;
}

export function readFeatures(layer: FeatureLayer): TileFeature[] {
  const out: TileFeature[] = [];
  for (let i = 0; i < layer.featureCount; i++) out.push(readFeature(layer, i));
  return out;
}
