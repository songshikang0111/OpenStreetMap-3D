import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTiles } from '@city-ink/builder';
import { generateTile } from '@city-ink/generators';
import { decodeTile, defaultExtentLog2, encodeTile, gridStepMeters, lngLatToTile, readFeatures } from '@city-ink/tiles';
import { assignBuildingRelations } from '../packages/builder/dist/building-relations.js';
import { cutTiles } from '../packages/builder/dist/cut.js';
import { fromGrid } from '../packages/builder/dist/geo.js';
import { FeatureStore } from '../packages/builder/dist/ingest/store.js';
import { parseOSM } from '../src/osm.js';
import { wantedRelation } from '../packages/builder/dist/ingest/filter.js';

const box = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const tile = lngLatToTile(4.89, 52.37, 14);
const e = defaultExtentLog2(tile.z);
const extent = 2 ** e;
const step = gridStepMeters(tile, e);
const point = ([x, y]) => fromGrid([tile.x * extent + x / step, tile.y * extent + y / step], tile.z, e);

test('tagged parts require explicit membership or exactly one complete containing outline, including its holes', () => {
  const footprint = (id, outer, part = false, holes = []) => ({
    id: `w${id}`,
    osmType: 'way',
    osmId: id,
    outer,
    holes,
    part,
  });
  const buildings = [
    footprint(1, box(0, 0, 100, 100), false, [box(5, 5, 10, 10)]),
    footprint(2, box(40, 40, 20, 20)),
    footprint(3, box(80, 80, 5, 5), true), // unique
    footprint(4, box(50, 50, 5, 5), true), // inside both outlines
    footprint(5, box(7, 7, 3, 3), true), // within a hole
    footprint(6, box(0, 0, 20, 20), true), // covers a hole despite every corner falling on solid ground
    footprint(7, box(120, 120, 5, 5), true), // outside
    footprint(8, box(80, 80, 5, 5), true), // explicit relation takes precedence
    footprint(9, box(80, 80, 5, 5), true), // contradictory explicit relations
  ];
  const relation = (id, refs) => ({
    type: 'relation',
    id,
    tags: { type: 'building' },
    members: refs.map((ref) => ({ type: 'way', role: 'part', ref })),
  });
  assert.ok(wantedRelation({ type: 'building' }));
  assignBuildingRelations(buildings, [relation(11, [8, 9]), relation(12, [9])]);
  assert.deepEqual(
    buildings.slice(2).map((b) => [b.compoundId ?? null, b.membershipSource ?? null]),
    [
      ['way/1', 'derived'],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
      ['relation/11', 'observed'],
      [null, null],
    ],
  );
});

test('small-building union preserves courtyard and islands in encoded geometry and generated roofs; density uses fixed metric cells', () => {
  const record = (id, polygons, anchor) => ({
    id: `way/${id}`,
    layer: 'building',
    cell: 'all',
    anchor: point(anchor),
    geometry: [polygons.map((ring) => ring.map(point))],
    properties: { area: 20, height: 4, minHeight: 0 },
    provenance: { height: 'observed', minHeight: 'inferred' },
    tags: {},
  });
  const records = [
    record(1, [box(5, 5, 5, 5), box(6, 6, 2, 2)], [7.5, 7.5]),
    record(2, [box(9, 5, 4, 5)], [11, 7.5]),
    record(3, [box(15, 5, 3, 3)], [16.5, 6.5]),
    ...[5, 45, 55, 95, 105].map((y, i) => ({
      id: `node/${i + 1}`,
      layer: 'tree',
      anchor: point([5, y]),
      properties: {},
      provenance: {},
      tags: {},
      geometry: [],
      cell: 'all',
    })),
  ];
  const cut = (rows) =>
    [
      ...cutTiles(rows, { levels: [{ id: 'L0', zoom: 14, profile: 'massing' }], data: { project: {} } }).tiles.values(),
    ][0];
  const bytes = encodeTile(cut(records));
  assert.deepEqual(bytes, encodeTile(cut([...records].reverse())));
  const decoded = decodeTile(bytes);
  const buildings = readFeatures(decoded.layers.building);
  assert.equal(buildings.length, 1);
  assert.deepEqual(buildings[0].geometry.map((poly) => poly.length).sort(), [1, 2]);
  assert.equal(buildings[0].provenance.height, 'observed');
  assert.deepEqual(
    readFeatures(decoded.layers.treeDensity)
      .map((f) => f.properties.density)
      .sort(),
    [1, 4],
  );
  const batches = generateTile(decoded).batches;
  let area = 0;
  for (const roof of batches)
    for (let i = 0; i < roof.index.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) =>
        Array.from(roof.position.slice(roof.index[i + j] * 3, roof.index[i + j] * 3 + 3)),
      );
      area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    }
  assert.ok(Math.abs(area - (8 * 5 - 2 * 2 + 3 * 3)) < 1.5, `rendered roof area ${area}`);
});

test('compound tiers keep the top and elevated base across a planning-cell boundary, including suppressed outlines', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-massing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const edge = extent * step;
  const way = (id, points, tags) => ({
    type: 'way',
    id,
    tags,
    geometry: [...points, points[0]].map((q) => {
      const [lon, lat] = point(q);
      return { lat, lon };
    }),
  });
  // Four adjacent volumes on either side of a z14 seam occupy their outline completely.
  const parts = [10, 20, 30, 40].map((h, i) =>
    way(i + 1, box(edge - 16 + i * 8, 30, 8, 16), { 'building:part': 'yes', min_height: '5', height: String(h) }),
  );
  const outline = way(90, box(edge - 16, 30, 32, 16), { building: 'yes', height: '40' });
  const members = [
    { type: 'way', ref: 90, role: 'outline' },
    ...parts.map((p) => ({ type: 'way', ref: p.id, role: 'part' })),
  ];
  const [west, north] = point([edge - 50, 5]),
    [east, south] = point([edge + 50, 80]);
  const pathToInput = path.join(dir, 'fixture.json');
  await writeFile(
    pathToInput,
    JSON.stringify({
      metadata: { bbox: [south, west, north, east] },
      elements: [...parts, outline, { type: 'relation', id: 100, tags: { type: 'building' }, members }],
    }),
  );
  const input = { input: pathToInput, ruleTrees: false, landmarks: false };
  const result = await buildTiles({ ...input, cellZoom: -1, output: path.join(dir, 'global') });
  const split = await buildTiles({ ...input, cellZoom: 14, concurrency: 2, output: path.join(dir, 'cells') });
  assert.deepEqual(split.report.hashes, result.report.hashes);
  const far = [],
    near = [];
  for (const file of Object.keys(result.report.hashes).filter((name) => name.endsWith('.c3t'))) {
    const decoded = decodeTile(await readFile(path.join(dir, 'global', file)));
    if (decoded.layers.building)
      (decoded.profile === 'massing' ? far : near).push(...readFeatures(decoded.layers.building));
  }
  assert.deepEqual(near.map((r) => r.id).sort(), ['way/1', 'way/2', 'way/3', 'way/4']);
  assert.ok(near.every((r) => r.properties.partOf === 'relation/100' && r.provenance.partOf === 'observed'));
  assert.deepEqual(
    far.map((r) => r.id),
    ['relation/100#0', 'relation/100#1', 'relation/100#2'],
  );
  assert.equal(Math.min(...far.map((r) => r.properties.minHeight)), 5);
  assert.equal(Math.max(...far.map((r) => r.properties.height)), 40);
  assert.equal(far.at(-1).provenance.height, 'observed');
});

test('disk neighbourhood retains distant tagged parts for outline suppression at a cell edge', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-outline-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const region = [4, 52, 4.01, 52.01];
  const store = new FeatureStore(dir);
  const ways = [];
  const insert = (id, x, width, tags) => {
    const bounds = [x, 52.002, x + width, 52.003];
    const outer = box(x, 52.002, width, 0.001);
    const geometry = [...outer, outer[0]].map(([lon, lat]) => ({ lon, lat }));
    const row = { type: 'way', id, tags, geometry };
    ways.push(row);
    store.add(row, bounds, region);
  };
  try {
    insert(1, 4.001, 0.008, { building: 'yes' });
    insert(2, 4.001, 0.003, { 'building:part': 'yes' });
    insert(3, 4.0055, 0.0035, { 'building:part': 'yes' });
  } finally {
    store.close();
  }
  const parse = (elements) =>
    parseOSM({ metadata: { bbox: [52, 4, 52.01, 4.01] }, elements })
      .buildings.map((b) => b.id)
      .sort();
  const neighbourhood = store.neighbourhood([4.0049, 52.002, 4.0051, 52.003]);
  assert.deepEqual(parse(ways), ['w2', 'w3']);
  assert.deepEqual(parse(neighbourhood), parse(ways));
});
