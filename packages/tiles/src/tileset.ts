// tileset.json types and strict validation (02 section 4). Mirrors schemas/tileset.schema.json.
import type { Diagnostic, ValidationResult } from './diagnostics.js';
import type { Bounds } from './mercator.js';
import { SUPPORTED_MAX_LATITUDE } from './mercator.js';

export const TILESET_SCHEMA_VERSION = 1;
export const LAYER_NAMES = [
  'building',
  'landmark',
  'road',
  'structure',
  'water',
  'green',
  'tree',
  'ground',
  'treeDensity',
] as const;

export interface TilesetLevel {
  id: string;
  zoom: number;
  profile: 'massing' | 'full';
  geometricErrorMeters: number;
}

export interface Tileset {
  schemaVersion: number;
  name: string;
  tiles: string[];
  bounds: Bounds;
  center: [lng: number, lat: number, zoom: number];
  levels: TilesetLevel[];
  coverage: { zoom: number; index: string };
  generator: { id: string; version: string; compatibleRuntime: string };
  layers: string[];
  attributes?: Record<string, string[]>;
  source: {
    kind: 'osm-pbf' | 'osm-json' | 'project' | 'synthetic';
    file?: string;
    sha256?: string;
    timestamp?: string;
  };
  attribution: { text: string; url: string; license: string };
  build?: { seed?: number; options?: Record<string, unknown>; configHash?: string };
  ground: { elevation: 'flat'; value: number };
  /** Reserved for terrain (M6). */
  terrain?: null;
  /** Reserved for external height sources (M6). */
  heightSources?: unknown[];
  extensions?: Record<string, unknown>;
}

type Check = (value: unknown, path: string, out: Diagnostic[]) => void;

const diag = (out: Diagnostic[], path: string, message: string, code = 'TILESET_INVALID', hint?: string) => {
  const d: Diagnostic = { code, stage: 'tileset', path, message };
  if (hint) d.hint = hint;
  out.push(d);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num =
  (min = -Infinity, max = Infinity, integer = false): Check =>
  (v, p, out) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
      diag(out, p, `Expected ${integer ? 'an integer' : 'a number'} in [${min}, ${max}].`);
  };
const str =
  (pattern?: RegExp): Check =>
  (v, p, out) => {
    if (typeof v !== 'string' || !v.length || (pattern && !pattern.test(v)))
      diag(out, p, `Expected a non-empty string${pattern ? ` matching ${pattern}` : ''}.`);
  };
const oneOf =
  (values: readonly unknown[]): Check =>
  (v, p, out) => {
    if (!values.includes(v)) diag(out, p, `Expected one of ${values.map((x) => JSON.stringify(x)).join(', ')}.`);
  };
const array =
  (item: Check, min = 0, max = Infinity): Check =>
  (v, p, out) => {
    if (!Array.isArray(v) || v.length < min || v.length > max)
      return diag(out, p, `Expected an array of ${min}..${max} items.`);
    v.forEach((x, i) => item(x, `${p}[${i}]`, out));
  };
const object =
  (fields: Record<string, [Check, boolean]>, open = false): Check =>
  (v, p, out) => {
    if (!isObject(v)) return diag(out, p, 'Expected an object.');
    for (const [k, [check, required]] of Object.entries(fields)) {
      if (v[k] === undefined) {
        if (required) diag(out, `${p}.${k}`, 'Missing required field.');
      } else check(v[k], `${p}.${k}`, out);
    }
    if (!open)
      for (const k of Object.keys(v))
        if (!(k in fields))
          diag(
            out,
            `${p}.${k}`,
            'Unknown field.',
            'TILESET_UNKNOWN_FIELD',
            'Remove the field or move it under "extensions".',
          );
  };
const any: Check = () => {};

const level = object({
  id: [str(/^L\d+$/), true],
  zoom: [num(0, 22, true), true],
  profile: [oneOf(['massing', 'full']), true],
  geometricErrorMeters: [num(0, 1e6), true],
});

const tilesetCheck = object({
  schemaVersion: [num(1, 1e6, true), true],
  name: [str(/^[A-Za-z0-9._-]{1,64}$/), true],
  tiles: [array(str(/\{z\}.*\{x\}.*\{y\}/), 1, 8), true],
  bounds: [array(num(), 4, 4), true],
  center: [array(num(), 3, 3), true],
  levels: [array(level, 1, 8), true],
  coverage: [object({ zoom: [num(0, 22, true), true], index: [str(), true] }), true],
  generator: [
    object({ id: [str(), true], version: [str(/^\d+\.\d+\.\d+/), true], compatibleRuntime: [str(), true] }),
    true,
  ],
  layers: [array(str(/^[A-Za-z][A-Za-z0-9_]*$/), 0, 64), true],
  attributes: [
    (v, p, out) =>
      isObject(v)
        ? Object.entries(v).forEach(([k, x]) => array(str(), 0, 256)(x, `${p}.${k}`, out))
        : diag(out, p, 'Expected an object.'),
    false,
  ],
  source: [
    object({
      kind: [oneOf(['osm-pbf', 'osm-json', 'project', 'synthetic']), true],
      file: [str(), false],
      sha256: [str(/^[a-f0-9]{64}$/), false],
      timestamp: [str(), false],
    }),
    true,
  ],
  attribution: [object({ text: [str(), true], url: [str(/^https?:\/\//), true], license: [str(), true] }), true],
  build: [
    object({ seed: [num(0, 2 ** 32 - 1, true), false], options: [any, false], configHash: [str(), false] }),
    false,
  ],
  ground: [object({ elevation: [oneOf(['flat']), true], value: [num(0, 0), true] }), true],
  terrain: [
    (v, p, out) => v !== null && diag(out, p, 'Reserved for terrain; must be null in schema version 1.'),
    false,
  ],
  heightSources: [array(any, 0, 0), false],
  extensions: [(v, p, out) => !isObject(v) && diag(out, p, 'Expected an object.'), false],
});

/** Strict validation: unknown fields, wrong types, inconsistent levels and unsupported versions are rejected. */
export function validateTileset(json: unknown): ValidationResult<Tileset> {
  const out: Diagnostic[] = [];
  if (isObject(json) && typeof json.schemaVersion === 'number' && json.schemaVersion > TILESET_SCHEMA_VERSION) {
    diag(
      out,
      '$.schemaVersion',
      `Tileset schema version ${json.schemaVersion} is newer than supported (${TILESET_SCHEMA_VERSION}).`,
      'TILESET_VERSION_UNSUPPORTED',
      'Upgrade the runtime.',
    );
    return { valid: false, diagnostics: out };
  }
  tilesetCheck(json, '$', out);
  if (!out.length) {
    const t = json as unknown as Tileset;
    const [w, s, e, n] = t.bounds;
    if (!(w < e))
      diag(out, '$.bounds', 'west must be less than east; antimeridian-crossing tilesets are not supported.');
    if (!(s < n)) diag(out, '$.bounds', 'south must be less than north.');
    if (w < -180 || e > 180) diag(out, '$.bounds', 'Longitudes must be within [-180, 180].');
    if (s < -SUPPORTED_MAX_LATITUDE || n > SUPPORTED_MAX_LATITUDE)
      diag(out, '$.bounds', `Latitudes must be within ±${SUPPORTED_MAX_LATITUDE}°.`);
    const [cx, cy] = t.center;
    if (!(cx >= w && cx <= e && cy >= s && cy <= n)) diag(out, '$.center', 'center must lie inside bounds.');
    const ids = new Set<string>();
    let previous = -1;
    t.levels.forEach((l, i) => {
      if (ids.has(l.id)) diag(out, `$.levels[${i}].id`, `Duplicate level id ${l.id}.`);
      ids.add(l.id);
      if (l.zoom <= previous) diag(out, `$.levels[${i}].zoom`, 'Levels must be ordered by increasing zoom.');
      previous = l.zoom;
    });
    const maxZoom = t.levels[t.levels.length - 1]!.zoom;
    if (t.coverage.zoom !== maxZoom)
      diag(out, '$.coverage.zoom', `Coverage zoom must equal the finest level zoom (${maxZoom}).`);
    if (new Set(t.layers).size !== t.layers.length) diag(out, '$.layers', 'Layer names must be unique.');
  }
  return out.length ? { valid: false, diagnostics: out } : { valid: true, diagnostics: [], value: json as Tileset };
}

// ---------------------------------------------------------------------------------------------- version ranges

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Minimal range check supporting space-separated comparators (>=, >, <=, <, =) and `||` alternatives. */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split('||').some((set) =>
    set
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => {
        const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(comparator);
        const target = m && parseVersion(m[2]!);
        if (!target) return false;
        const c = compare(v, target);
        switch (m![1] ?? '=') {
          case '>=':
            return c >= 0;
          case '<=':
            return c <= 0;
          case '>':
            return c > 0;
          case '<':
            return c < 0;
          default:
            return c === 0;
        }
      }),
  );
}

/** Resolves a tile URL from a tileset template relative to the tileset.json location. */
export function resolveTileUrl(
  tileset: Pick<Tileset, 'tiles'>,
  tilesetUrl: string,
  z: number,
  x: number,
  y: number,
  template = 0,
): string {
  const path = tileset.tiles[template]!.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  return new URL(path, tilesetUrl).href;
}
