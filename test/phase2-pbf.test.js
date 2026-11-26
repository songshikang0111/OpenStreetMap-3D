// WP-F PBF ingest: a synthetic .osm.pbf written here (dense nodes, a tagged way, a multipolygon relation) is decoded
// by the streaming reader, filtered, and built into tiles; oversize inputs are rejected with a clipping hint.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { decodeTile, readFeatures } from '@city-ink/tiles';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { readPbf } from '../packages/builder/dist/ingest/pbf.js';
import { ingestPbf, bboxAreaKm2 } from '../packages/builder/dist/ingest/index.js';
import { buildTiles } from '../packages/builder/dist/index.js';
import { parseOSM } from '../src/osm.js';

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
function samplePbf({ includeBuildingRelation = false, riverbank = false } = {}) {
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
    'part',
    'waterway',
    'riverbank',
    'water',
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
    { id: 3, refs: square(135.7758, 35.003, 0.0004), tags: riverbank ? [[s('natural'), s('water')]] : [] },
    { id: 4, refs: square(135.7759, 35.0031, 0.0001), tags: riverbank ? [[s('building'), s('yes')]] : [] },
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
    ...packed(2, [s('type'), s(riverbank ? 'waterway' : 'building')], false, false),
    ...packed(3, [s('multipolygon'), s(riverbank ? 'riverbank' : 'yes')], false, false),
    ...packed(8, [s('outer'), s('inner')], false, false),
    ...packed(9, [3, 4], true, true),
    ...packed(10, [1, 1], false, false),
  ]);
  // The building relation has no direct way members. Its spatial index must use its child multipolygon.
  const buildingRelation = bytesField(4, [
    ...varField(1, 78),
    ...packed(2, [s('type')], false, false),
    ...packed(3, [s('building')], false, false),
    ...packed(8, [s('part')], false, false),
    ...packed(9, [77], true, true),
    ...packed(10, [2], false, false),
  ]);
  const data = [
    ...stringTable,
    ...bytesField(2, dense),
    ...bytesField(2, wayGroup),
    ...bytesField(2, relation),
    ...(includeBuildingRelation ? bytesField(2, buildingRelation) : []),
    ...varField(17, 100),
  ];
  return Buffer.concat([block('OSMHeader', header), block('OSMData', data)]);
}

test('PBF decodes signed int64 offsets and rejects truncated or oversized framing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-pbf-offsets-'));
  const file = path.join(dir, 'offset.osm.pbf');
  try {
    // int64 -1_000_000_000 as a ten-byte two's-complement varint.
    const negative = [128, 236, 148, 163, 252, 255, 255, 255, 255, 1];
    const node = bytesField(1, [...varField(1, zz(1)), ...varField(8, zz(25)), ...varField(9, zz(-50))]);
    const data = block('OSMData', [...bytesField(2, node), ...varField(19, 2e9), ...key(20, 0), ...negative]);
    await writeFile(file, data);
    const nodes = [];
    await readPbf(file, { node: (id, lat, lon) => nodes.push([id, lat, lon]) });
    assert.deepEqual(nodes, [[1, 2.0000025, -1.000005]]);
    await writeFile(file, block('OSMHeader', bytesField(4, str('HistoricalInformation'))));
    await assert.rejects(readPbf(file, {}), /Unsupported required OSM PBF feature: HistoricalInformation/);
    for (const bad of [data.subarray(0, -1), data.subarray(0, 3), Buffer.from([255, 255, 255, 255])]) {
      await writeFile(file, bad);
      await assert.rejects(readPbf(file, {}), /Truncated PBF|Invalid PBF/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test('PBF and JSON keep riverbank holes, independent member buildings, and only one outer water surface', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-member-'));
  try {
    const pbf = path.join(dir, 'members.osm.pbf'),
      json = path.join(dir, 'members.json');
    await writeFile(pbf, samplePbf({ riverbank: true }));
    const elements = [];
    const header = await readPbf(pbf, {
      wantNodeTags: true,
      node: (id, lat, lon, tags) => elements.push({ type: 'node', id, lat, lon, tags }),
      way: ({ id, refs, tags }) => elements.push({ type: 'way', id, nodes: refs, tags }),
      relation: (r) => elements.push({ type: 'relation', ...r }),
    });
    const [w, s, e, n] = header.bbox;
    const raw = { metadata: { bbox: [s, w, n, e] }, elements };
    await writeFile(json, JSON.stringify(raw));
    // Check known source objects as well as equivalence: both encodings use the same parser.
    for (const input of [raw, (await ingestPbf(pbf)).raw]) {
      const parsed = parseOSM(input);
      assert.deepEqual(parsed.buildings.map((b) => b.osmId).sort(), [1, 2, 4]);
      assert.equal(parsed.water.length, 1);
      assert.deepEqual(parsed.water[0].sourceIds, ['r77-0']);
      assert.equal(parsed.water[0].holes.length, 1);
    }
    const fromPbf = await buildTiles({ input: pbf, output: path.join(dir, 'pbf') });
    const fromJson = await buildTiles({ input: json, output: path.join(dir, 'json') });
    assert.deepEqual(fromPbf.report.hashes, fromJson.report.hashes);
    assert.equal(fromPbf.report.counts.water, 1);
    assert.equal(fromPbf.report.counts.building, 3);
    const buildings = [];
    for (const file of Object.keys(fromPbf.report.hashes).filter((file) => file.startsWith('16/'))) {
      const tile = decodeTile(await readFile(path.join(dir, 'pbf', file)));
      if (tile.layers.building) buildings.push(...readFeatures(tile.layers.building).map((f) => f.id));
    }
    assert.deepEqual(buildings.sort(), ['way/1', 'way/2', 'way/4']);
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
    await writeFile(input, samplePbf({ includeBuildingRelation: true }));
    // Large envelope selects the disk-backed path, while the sparse input makes this suitable for CI.
    const config = { input, bbox: [135.734, 34.96, 135.83, 35.055], ruleTrees: false };
    const global = await buildTiles({ ...config, output: path.join(dir, 'global'), cellZoom: -1 });
    const tiled = await buildTiles({ ...config, output: path.join(dir, 'cells'), cellZoom: 12, concurrency: 2 });
    assert.deepEqual(tiled.report.hashes, global.report.hashes);
    assert.deepEqual(tiled.report.counts, global.report.counts);
    const full = [];
    for (const file of Object.keys(tiled.report.hashes).filter((k) => k.startsWith('16/'))) {
      const tile = decodeTile(await readFile(path.join(dir, 'cells', file)));
      if (tile.layers.building) full.push(...readFeatures(tile.layers.building));
    }
    const part = full.find((f) => f.id === 'relation/77#0');
    assert.equal(part.properties.partOf, 'relation/78');
    assert.equal(part.provenance.partOf, 'observed');
    assert.deepEqual(tiled.report.incompleteRelations, global.report.incompleteRelations);
    const interrupted = path.join(dir, 'interrupted');
    await assert.rejects(
      buildTiles({ ...config, output: interrupted, cellZoom: 12, failAfter: { stage: 'partition', count: 1 } }),
    );
    const stages = [];
    const resumed = await buildTiles({
      ...config,
      output: interrupted,
      cellZoom: 12,
      resume: true,
      onProgress: (p) => stages.push(p),
    });
    assert.ok(stages.some((p) => p.detail === 'verified feature store'));
    assert.deepEqual(resumed.report.hashes, tiled.report.hashes);
    let overlapping;
    await buildTiles({
      ...config,
      output: interrupted,
      cellZoom: 12,
      resume: true,
      onProgress: (p) => {
        if (!overlapping)
          overlapping = assert.rejects(
            buildTiles({ ...config, output: interrupted }),
            (e) => e.code === 'TILES_OUTPUT_BUSY',
          );
      },
    });
    await overlapping;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
