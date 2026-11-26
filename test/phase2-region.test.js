import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runTilesCLI } from '@city-ink/builder';
import { RegionMask } from '../packages/builder/dist/region.js';
const square = (x, y, r) => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
  [x - r, y - r],
];
const poly = (rings) => ({ type: 'Polygon', coordinates: rings });
test('region holes split roads, interpolate elevations, preserve whole structures and clip filled areas', () => {
  const mask = new RegionMask(poly([square(0, 0, 4), square(0, 0, 1)]));
  const road = {
    id: 'way/2',
    properties: {},
    layer: 'road',
    geometry: [
      [
        [
          [-5, 0],
          [5, 0],
        ],
      ],
    ],
    elevation: [[[0, 100]]],
  };
  const [clipped] = mask.clip(road);
  assert.deepEqual(clipped.geometry, [
    [
      [
        [-4, 0],
        [-1, 0],
      ],
    ],
    [
      [
        [1, 0],
        [4, 0],
      ],
    ],
  ]);
  assert.deepEqual(clipped.elevation, [[[10, 40]], [[60, 90]]]);
  const inside = [
    [
      [
        [-3, 0],
        [-2, 0],
        [-2, 2],
      ],
    ],
  ];
  const joined = mask.clip({ ...road, geometry: inside, elevation: [[[10, 20, 30]]] });
  assert.deepEqual(joined[0].geometry, inside);
  assert.deepEqual(joined[0].elevation, [[[10, 20, 30]]]);
  const [water] = mask.clip({ layer: 'water', geometry: [[square(0, 0, 7)]] });
  assert.equal(water.geometry[0].length, 2);
  assert.equal(mask.clip({ layer: 'tree', anchor: [0, 0] }).length, 0);
  assert.equal(mask.clip({ layer: 'structure', properties: { kind: 'pier' }, anchor: [2, 0] }).length, 1);
  assert.throws(
    () =>
      new RegionMask(
        poly([
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
          ],
        ]),
      ),
    /closed/,
  );
});
test('CLI polygon geometry participates in resume identity even with identical bounding boxes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'city-mask-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raw = JSON.parse(await readFile('public/data/bibury-village.json'));
  const [s, w, n, e] = raw.metadata.bbox;
  const shell = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
  const file = path.join(root, 'mask.json'),
    output = path.join(root, 'tiles');
  const args = [
    'build',
    '--input',
    'public/data/bibury-village.json',
    '--polygon',
    file,
    '--output',
    output,
    '--resume',
  ];
  const build = async (rings) => {
    await writeFile(file, JSON.stringify({ type: 'Feature', properties: {}, geometry: poly(rings) }));
    const r = await runTilesCLI(args, { stderr: { write() {} } });
    assert.equal(r.status, 'succeeded', JSON.stringify(r.diagnostics));
    return JSON.parse(await readFile(path.join(output, 'report.json')));
  };
  const before = await build([shell]);
  const after = await build([shell, square((w + e) / 2, (s + n) / 2, 0.002)]);
  assert.ok(before.counts.building > after.counts.building && after.counts.building > 0);
  assert.notDeepEqual(before.hashes, after.hashes);
  assert.equal((await runTilesCLI(['validate', output])).status, 'succeeded');
});
