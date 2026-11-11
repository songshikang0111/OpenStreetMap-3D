import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateTileset, satisfiesRange, resolveTileUrl } from '../dist/index.js';

export const EXAMPLE = {
  schemaVersion: 1,
  name: 'beijing',
  tiles: ['{z}/{x}/{y}.c3t'],
  bounds: [116.1, 39.7, 116.75, 40.2],
  center: [116.397, 39.908, 15],
  levels: [
    { id: 'L0', zoom: 14, profile: 'massing', geometricErrorMeters: 12 },
    { id: 'L1', zoom: 16, profile: 'full', geometricErrorMeters: 0.5 },
  ],
  coverage: { zoom: 16, index: 'coverage.bin' },
  generator: { id: 'builder', version: '2.0.0', compatibleRuntime: '>=2.0.0 <3.0.0' },
  layers: ['building', 'landmark', 'road', 'structure', 'water', 'green', 'tree', 'ground'],
  attributes: { building: ['height', 'minHeight', 'roofShape', 'facade', 'provenance'] },
  source: {
    kind: 'osm-pbf',
    file: 'beijing-latest.osm.pbf',
    sha256: 'a'.repeat(64),
    timestamp: '2026-11-01T00:00:00Z',
  },
  attribution: {
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL-1.0',
  },
  build: { seed: 1, options: { inferRoofs: false, landscape: false }, configHash: 'abc' },
  ground: { elevation: 'flat', value: 0 },
};

test('the 02 section 4 example validates', () => {
  const result = validateTileset(structuredClone(EXAMPLE));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.valid, true);
});

test('invalid tilesets are rejected with paths', () => {
  const cases = [
    [(t) => (t.extra = 1), '$.extra', 'TILESET_UNKNOWN_FIELD'],
    [(t) => delete t.attribution, '$.attribution'],
    [(t) => (t.bounds = [10, 0, 5, 1]), '$.bounds'],
    [(t) => (t.bounds = [0, -85, 1, 1]), '$.bounds'],
    [(t) => (t.center = [0, 0, 15]), '$.center'],
    [(t) => (t.levels[1].zoom = 13), '$.levels[1].zoom'],
    [(t) => (t.coverage.zoom = 14), '$.coverage.zoom'],
    [(t) => (t.ground.value = 3), '$.ground.value'],
    [(t) => (t.tiles = ['tiles.bin']), '$.tiles[0]'],
    [(t) => (t.attribution.url = 'ftp://x'), '$.attribution.url'],
    [(t) => (t.levels[0].profile = 'lod'), '$.levels[0].profile'],
  ];
  for (const [mutate, path, code = 'TILESET_INVALID'] of cases) {
    const t = structuredClone(EXAMPLE);
    mutate(t);
    const result = validateTileset(t);
    assert.equal(result.valid, false, path);
    assert.ok(
      result.diagnostics.some((d) => d.path === path && d.code === code),
      `${path}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  const newer = validateTileset({ ...structuredClone(EXAMPLE), schemaVersion: 2 });
  assert.equal(newer.diagnostics[0].code, 'TILESET_VERSION_UNSUPPORTED');
  assert.equal(validateTileset(null).valid, false);
});

test('the JSON Schema file agrees with the example and declares the reserved fields', () => {
  const schema = JSON.parse(readFileSync(new URL('../../../schemas/tileset.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  for (const k of Object.keys(EXAMPLE)) assert.ok(schema.properties[k], `schema declares ${k}`);
  for (const k of schema.required) assert.ok(k in EXAMPLE, `example has required ${k}`);
  assert.ok(schema.properties.terrain && schema.properties.heightSources, 'terrain and height sources reserved');
});

test('version ranges and tile URL resolution', () => {
  assert.equal(satisfiesRange('2.1.0', '>=2.0.0 <3.0.0'), true);
  assert.equal(satisfiesRange('3.0.0', '>=2.0.0 <3.0.0'), false);
  assert.equal(satisfiesRange('1.9.9', '>=2.0.0 <3.0.0 || 1.9.9'), true);
  assert.equal(
    resolveTileUrl(EXAMPLE, 'https://cdn.example.com/city/beijing/tileset.json', 16, 1, 2),
    'https://cdn.example.com/city/beijing/16/1/2.c3t',
  );
});
