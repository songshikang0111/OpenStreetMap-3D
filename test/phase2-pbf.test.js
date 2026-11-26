// WP-F PBF ingest: a synthetic .osm.pbf written here (dense nodes, a tagged way, a multipolygon relation) is decoded
// by the streaming reader, filtered, and built into tiles; oversize inputs are rejected with a clipping hint.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { readPbf } from '../packages/builder/dist/ingest/pbf.js';
import { ingestPbf, bboxAreaKm2 } from '../packages/builder/dist/ingest/index.js';
import { buildTiles } from '../packages/builder/dist/index.js';

// --- a tiny protobuf writer ------------------------------------------------------------------------------------
const varint = (n) => {
  const out = [];
  while (n >= 128) {
    out.push(n % 128 | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const key = (f, w) => varint(f * 8 + w);
const bytesField = (f, b) => [...key(f, 2), ...varint(b.length), ...b];
const varField = (f, n) => [...key(f, 0), ...varint(n)];
const str = (s) => [...Buffer.from(s)];
const packed = (f, values, signed, delta) => {
  let prev = 0;
  const body = values.flatMap((v) => {
    const d = delta ? v - prev : v;
    prev = v;
    return varint(signed ? zz(d) : d);
  });
  return bytesField(f, body);
};
function block(type, payload) {
  const blob = [...varField(2, payload.length), ...bytesField(3, [...deflateSync(Buffer.from(payload))])];
  const header = [...bytesField(1, str(type)), ...varField(3, blob.length)];
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([len, Buffer.from(header), Buffer.from(blob)]);
}

/** A 4-building block near Kyoto: dense nodes, one tagged way per building, one multipolygon with a hole. */
function samplePbf() {
  const strings = [
    '',
    'building',
    'yes',
    'type',
    'multipolygon',
    'outer',
    'inner',
    'natural',
    'tree',
    'highway',
    'residential',
    'building:levels',
    '12',
  ];
  const s = (x) => strings.indexOf(x);
  const nodes = [];
  let id = 1000;
  const square = (lon, lat, size) => {
    const ids = [];
    for (const [dx, dy] of [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ]) {
      nodes.push({ id: ++id, lat: lat + dy, lon: lon + dx });
      ids.push(id);
    }
    return [...ids, ids[0]];
  };
  const ways = [
    {
      id: 1,
      refs: square(135.775, 35.003, 0.0002),
      tags: [
        [s('building'), s('yes')],
        [s('building:levels'), s('12')],
      ],
    },
    { id: 2, refs: square(135.7754, 35.003, 0.0002), tags: [[s('building'), s('yes')]] },
    { id: 3, refs: square(135.7758, 35.003, 0.0004), tags: [] },
    { id: 4, refs: square(135.7759, 35.0031, 0.0001), tags: [] },
  ];
  const road = [];
  for (let i = 0; i < 5; i++) {
    nodes.push({ id: ++id, lat: 35.0028, lon: 135.7748 + i * 0.0004 });
    road.push(id);
  }
  ways.push({ id: 5, refs: road, tags: [[s('highway'), s('residential')]] });
  nodes.push({ id: 5000, lat: 35.0035, lon: 135.7751, tags: [[s('natural'), s('tree')]] });
  // header
  const header = bytesField(1, [
    ...varField(1, zz(135.774e9)),
    ...varField(2, zz(135.777e9)),
    ...varField(3, zz(35.004e9)),
    ...varField(4, zz(35.002e9)),
  ]);
  const stringTable = bytesField(
    1,
    strings.flatMap((x) => bytesField(1, str(x))),
  );
  const dense = bytesField(2, [
    ...packed(
      1,
      nodes.map((n) => n.id),
      true,
      true,
    ),
    ...packed(
      8,
      nodes.map((n) => Math.round(n.lat * 1e7)),
      true,
      true,
    ),
    ...packed(
      9,
      nodes.map((n) => Math.round(n.lon * 1e7)),
      true,
      true,
    ),
    ...packed(
      10,
      nodes.flatMap((n) => [...(n.tags ?? []).flat(), 0]),
      false,
      false,
    ),
  ]);
  const wayGroup = ways.flatMap((w) =>
    bytesField(3, [
      ...varField(1, w.id),
      ...packed(
        2,
        w.tags.map((t) => t[0]),
        false,
        false,
      ),
      ...packed(
        3,
        w.tags.map((t) => t[1]),
        false,
        false,
      ),
      ...packed(8, w.refs, true, true),
    ]),
  );
  const relation = bytesField(4, [
    ...varField(1, 77),
    ...packed(2, [s('type'), s('building')], false, false),
    ...packed(3, [s('multipolygon'), s('yes')], false, false),
    ...packed(8, [s('outer'), s('inner')], false, false),
    ...packed(9, [3, 4], true, true),
    ...packed(10, [1, 1], false, false),
  ]);
  const data = [
    ...stringTable,
    ...bytesField(2, dense),
    ...bytesField(2, wayGroup),
    ...bytesField(2, relation),
    ...varField(17, 100),
  ];
  return Buffer.concat([block('OSMHeader', header), block('OSMData', data)]);
}

test('F1/F2: the streaming PBF reader decodes dense nodes, ways and relations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-pbf-'));
  try {
    const file = path.join(dir, 'sample.osm.pbf');
    await writeFile(file, samplePbf());
    const seen = { nodes: 0, ways: [], relations: [], tree: null };
    const header = await readPbf(file, {
      wantNodeTags: true,
      node(id, lat, lon, tags) {
        seen.nodes++;
        if (tags?.natural === 'tree') seen.tree = { id, lat, lon };
      },
      way: (w) => seen.ways.push(w),
      relation: (r) => seen.relations.push(r),
    });
    assert.deepEqual(header.bbox, [135.774, 35.002, 135.777, 35.004]);
    assert.equal(seen.nodes, 22);
    assert.equal(seen.ways.length, 5);
    assert.deepEqual(seen.ways[0].tags, { building: 'yes', 'building:levels': '12' });
    assert.equal(seen.ways[0].refs.length, 5);
    assert.deepEqual(seen.tree, { id: 5000, lat: 35.0035, lon: 135.7751 });
    assert.deepEqual(seen.relations[0].members, [
      { type: 'way', ref: 3, role: 'outer' },
      { type: 'way', ref: 4, role: 'inner' },
    ]);

    const ingested = await ingestPbf(file);
    const types = ingested.raw.elements.map((e) => `${e.type}/${e.id}`).sort();
    assert.deepEqual(types, ['node/5000', 'relation/77', 'way/1', 'way/2', 'way/5']);
    const rel = ingested.raw.elements.find((e) => e.type === 'relation');
    assert.equal(rel.members[0].geometry.length, 5);

    const { report } = await buildTiles({ input: file, output: path.join(dir, 'tiles') });
    assert.equal(report.counts.building, 3);
    assert.equal(report.source?.kind ?? 'osm-pbf', 'osm-pbf');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AC603: inputs beyond the supported scale are rejected with a clipping hint', async () => {
  assert.ok(Math.abs(bboxAreaKm2([116, 39.9, 116.1, 40]) - 94.5) < 2);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-pbf-'));
  try {
    const file = path.join(dir, 'sample.osm.pbf');
    await writeFile(file, samplePbf());
    await assert.rejects(
      ingestPbf(file, { bbox: [4, 52, 6, 53] }),
      (e) => e.code === 'BUILD_AREA_TOO_LARGE' && /osmium extract/.test(e.hint),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PBF crop retains line crossings and enclosing polygons when every vertex is outside', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-pbf-'));
  try {
    const file = path.join(dir, 'sample.osm.pbf');
    await writeFile(file, samplePbf());
    const ids = async (bbox) =>
      (await ingestPbf(file, { bbox, marginDeg: 0 })).raw.elements.map((e) => e.type + '/' + e.id);
    assert.ok((await ids([135.77495, 35.00279, 135.775, 35.00281])).includes('way/5'));
    assert.ok((await ids([135.77502, 35.00302, 135.77505, 35.00305])).includes('way/1'));
    assert.ok((await ids([135.77583, 35.00302, 135.77585, 35.00305])).includes('relation/77'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AC607: an oversized connected water mask and bridge group keep local geometry and report the fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-group-'));
  try {
    const input = path.join(dir, 'long-water.json');
    const nodes = [
      [4.8, 52.0],
      [5.15, 52.0],
      [5.15, 52.002],
      [4.8, 52.002],
      [4.8, 52.0],
    ];
    const shape = nodes.map(([lon, lat]) => ({ lon, lat }));
    const raw = {
      metadata: { bbox: [51.999, 4.79, 52.003, 5.16] },
      elements: [
        { type: 'way', id: 10, tags: { natural: 'water' }, geometry: shape },
        {
          type: 'way',
          id: 20,
          tags: { highway: 'footway', bridge: 'yes' },
          nodes: [1, 2],
          geometry: [shape[0], shape[1]],
        },
      ],
    };
    await writeFile(input, JSON.stringify(raw));
    // A coarse output zoom isolates the group fallback from normal urban L1 detail.
    const { report } = await buildTiles({
      input,
      output: path.join(dir, 'tiles'),
      ruleTrees: false,
      landmarks: false,
      cellZoom: 11,
      levels: [
        { id: 'L0', zoom: 12, profile: 'massing', geometricErrorMeters: 12 },
        { id: 'L1', zoom: 13, profile: 'full', geometricErrorMeters: 1 },
      ],
    });
    const diagnostics = report.diagnostics.filter((d) => d.code === 'GROUP_TOO_LARGE');
    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.some((d) => d.featureId === 'way/20'));
    assert.ok(diagnostics.some((d) => /water group/.test(d.message)));
    assert.ok(report.counts.water > 0 && report.counts.road > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AC303/606: disk-indexed buffered PBF planning matches a single global cell', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pbf-store-'));
  try {
    const input = path.join(dir, 'sample.osm.pbf');
    await writeFile(input, samplePbf());
    // Large envelope selects the disk-backed path, while the sparse input makes this suitable for CI.
    const config = { input, bbox: [135.734, 34.96, 135.83, 35.055], ruleTrees: false };
    const global = await buildTiles({ ...config, output: path.join(dir, 'global'), cellZoom: -1 });
    const tiled = await buildTiles({ ...config, output: path.join(dir, 'cells'), cellZoom: 12, concurrency: 2 });
    assert.deepEqual(tiled.report.hashes, global.report.hashes);
    assert.deepEqual(tiled.report.counts, global.report.counts);
    assert.deepEqual(tiled.report.incompleteRelations, global.report.incompleteRelations);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
