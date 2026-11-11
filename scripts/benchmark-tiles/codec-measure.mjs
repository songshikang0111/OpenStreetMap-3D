// WP-B task B5: tile size and Node decode-time measurement on synthetic representative L1/L0 tiles.
// Usage: node scripts/benchmark-tiles/codec-measure.mjs [--json out.json]
// Synthetic densities follow the phase-one samples (Kyoto Gion ~1,740 buildings/km², Beijing CBD ~130/km² with
// multi-part towers, a grade-separated interchange). These are format measurements only; WP-C re-measures on real
// tiles. Node timings are not GPU or browser performance evidence.
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { encodeTile, decodeTile, readFeatures } from '../../packages/tiles/dist/index.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const STEP = 0.029; // metres per grid unit at z16, 40°N
const q = (m) => Math.round(m / STEP);

function polygon(r, cx, cz, w, d, vertices) {
  const ring = [];
  for (let i = 0; i < vertices; i++) {
    const a = (i / vertices) * Math.PI * 2;
    const k = 0.85 + r() * 0.3;
    ring.push(q(cx + (Math.cos(a) * w * k) / 2), q(cz + (Math.sin(a) * d * k) / 2));
  }
  return ring;
}

function buildings(r, count, { tall = false, parts = 1, vertices = [5, 14] } = {}) {
  const features = [];
  let renderId = 0;
  for (let i = 0; i < count; i++) {
    const cx = (r() - 0.5) * 460;
    const cz = (r() - 0.5) * 460;
    const size = tall ? 25 + r() * 40 : 6 + r() * 14;
    const height = tall ? 40 + r() * 250 : 3 + r() * 12;
    const id = 100000000 + Math.floor(r() * 9e8);
    for (let p = 0; p < parts; p++) {
      const v = vertices[0] + Math.floor(r() * (vertices[1] - vertices[0]));
      features.push({
        id: p ? `way/${id + p}` : `way/${id}`,
        renderId: renderId++,
        geometry: [[polygon(r, cx, cz, size * (1 - p * 0.2), size * (1 - p * 0.2), v)]],
        properties: {
          height: Math.round(height * (1 - p * 0.15) * 10) / 10,
          minHeight: p ? Math.round(height * 0.3) : null,
          levels: Math.round(height / 3.2),
          roofShape: r() < 0.7 ? 'flat' : ['gabled', 'hipped', 'pyramidal'][Math.floor(r() * 3)],
          roofHeight: null,
          roofDirection: null,
          facade: tall ? 'curtain-wall' : ['brick-row', 'plaster-grid', 'wood-lattice'][Math.floor(r() * 3)],
          facadeSeed: Math.floor(r() * 2 ** 31),
          usage: ['residential', 'commercial', 'office', 'retail'][Math.floor(r() * 4)],
          partOf: p ? `way/${id}` : null,
          materialHint: null,
          colour: null,
          roofColour: null,
        },
        provenance: {
          height: r() < 0.3 ? 'observed' : r() < 0.5 ? 'derived' : 'inferred',
          roofShape: r() < 0.7 ? 'inferred' : 'observed',
        },
        tags: r() < 0.2 ? { name: `Building ${Math.floor(r() * 500)}`, building: 'yes' } : { building: 'yes' },
      });
    }
  }
  return {
    type: 'features',
    geometry: 'polygon',
    attributes: [
      { name: 'height', type: 'f32' },
      { name: 'minHeight', type: 'f32' },
      { name: 'levels', type: 'f32' },
      { name: 'roofShape', type: 'string' },
      { name: 'roofHeight', type: 'f32' },
      { name: 'roofDirection', type: 'f32' },
      { name: 'facade', type: 'string' },
      { name: 'facadeSeed', type: 'u32' },
      { name: 'usage', type: 'string' },
      { name: 'partOf', type: 'string' },
      { name: 'materialHint', type: 'string' },
      { name: 'colour', type: 'string' },
      { name: 'roofColour', type: 'string' },
    ],
    provenanceKeys: ['height', 'minHeight', 'levels', 'roofShape', 'roofHeight'],
    features,
  };
}

function roads(r, count, { elevated = 0 } = {}) {
  const features = [];
  for (let i = 0; i < count; i++) {
    const n = 4 + Math.floor(r() * 20);
    const line = [];
    const elev = [];
    let x = (r() - 0.5) * 460;
    let z = (r() - 0.5) * 460;
    const lift = i < elevated ? 6 + r() * 12 : 0;
    for (let v = 0; v < n; v++) {
      x += (r() - 0.5) * 40;
      z += (r() - 0.5) * 40;
      line.push(q(x), q(z));
      elev.push(lift * Math.sin((v / (n - 1)) * Math.PI));
    }
    features.push({
      id: `way/${200000000 + i}`,
      renderId: i,
      geometry: [[line]],
      elevation: [[elev]],
      properties: {
        class: ['primary', 'secondary', 'residential', 'footway', 'service'][i % 5],
        width: 3 + r() * 20,
        lanes: Math.floor(r() * 4),
        surface: 'asphalt',
        bridge: lift ? 1 : 0,
        tunnel: 0,
        layer: lift ? 1 : 0,
        oneway: 0,
      },
      provenance: { width: 'inferred', elevation: lift ? 'derived' : 'inferred' },
      tags: r() < 0.5 ? { name: `Road ${i % 40}`, highway: 'primary' } : { highway: 'residential' },
    });
  }
  return { type: 'features', geometry: 'line', elevation: true, features };
}

function ground(r, count, elevated = false) {
  const features = [];
  for (let i = 0; i < count; i++) {
    const ring = polygon(
      r,
      (r() - 0.5) * 440,
      (r() - 0.5) * 440,
      10 + r() * 60,
      6 + r() * 30,
      8 + Math.floor(r() * 40),
    );
    const geometry = [[ring]];
    const f = {
      id: `way/${300000000 + i}#${i % 4}`,
      renderId: i,
      geometry,
      properties: { kind: ['pavement', 'sidewalk', 'plaza'][i % 3] },
    };
    f.elevation = [[Array.from({ length: ring.length / 2 }, () => (elevated ? r() * 8 : 0))]];
    features.push(f);
  }
  return { type: 'features', geometry: 'polygon', elevation: true, features };
}

function trees(r, count) {
  const features = [];
  for (let i = 0; i < count; i++)
    features.push({
      id: i % 3 ? `generated/${400000000 + i}` : `node/${500000000 + i}`,
      renderId: i,
      geometry: [[[q((r() - 0.5) * 460), q((r() - 0.5) * 460)]]],
      properties: { shape: 'round', height: 6 + r() * 10, crown: 3 + r() * 4, leafType: 'broadleaved', species: null },
      provenance: { position: i % 3 ? 'inferred' : 'observed', height: 'inferred' },
    });
  return { type: 'features', geometry: 'point', features };
}

function simplePolys(r, count, kind) {
  return {
    type: 'features',
    geometry: 'polygon',
    features: Array.from({ length: count }, (_, i) => ({
      id: `way/${600000000 + i}`,
      renderId: i,
      geometry: [
        [polygon(r, (r() - 0.5) * 400, (r() - 0.5) * 400, 30 + r() * 120, 20 + r() * 80, 12 + Math.floor(r() * 60))],
      ],
      properties: { kind },
    })),
  };
}

function landmarkMesh(r, triangles) {
  const vertexCount = triangles * 2;
  const position = [];
  const normal = [];
  for (let v = 0; v < vertexCount; v++) {
    position.push((r() - 0.5) * 60, r() * 300, (r() - 0.5) * 60);
    normal.push(0, 1, 0);
  }
  const index = [];
  for (let t = 0; t < triangles; t++)
    index.push(Math.floor(r() * vertexCount), Math.floor(r() * vertexCount), Math.floor(r() * vertexCount));
  return {
    type: 'mesh',
    position,
    normal,
    index,
    submeshes: [
      {
        materialRole: 'landmark',
        featureIndex: 0,
        indexStart: 0,
        indexCount: index.length / 2 - ((index.length / 2) % 3),
      },
      {
        materialRole: 'glass',
        featureIndex: 0,
        indexStart: index.length / 2 - ((index.length / 2) % 3),
        indexCount: index.length - (index.length / 2 - ((index.length / 2) % 3)),
      },
    ],
    features: [{ id: 'way/123456', renderId: 0, properties: { name: 'Tower' } }],
  };
}

const SCENARIOS = {
  'L1 dense low-rise (Kyoto-like, ~430 buildings)': (r) => ({
    id: { z: 16, x: 57200, y: 26000 },
    profile: 'full',
    layers: {
      building: buildings(r, 430),
      road: roads(r, 120),
      ground: ground(r, 60),
      tree: trees(r, 300),
      green: simplePolys(r, 10, 'park'),
      water: simplePolys(r, 2, 'river'),
    },
  }),
  'L1 very dense old town (~900 buildings)': (r) => ({
    id: { z: 16, x: 57200, y: 26001 },
    profile: 'full',
    layers: {
      building: buildings(r, 900, { vertices: [4, 10] }),
      road: roads(r, 200),
      ground: ground(r, 90),
      tree: trees(r, 150),
    },
  }),
  'L1 high-rise CBD (Beijing-like, 40 towers x 3 parts + landmark)': (r) => ({
    id: { z: 16, x: 53958, y: 24829 },
    profile: 'full',
    layers: {
      building: buildings(r, 40, { tall: true, parts: 3, vertices: [8, 40] }),
      road: roads(r, 150),
      ground: ground(r, 80),
      tree: trees(r, 600),
      green: simplePolys(r, 12, 'grass'),
      landmark: landmarkMesh(r, 12000),
    },
  }),
  'L1 interchange (elevated roads, ground with elevation)': (r) => ({
    id: { z: 16, x: 53960, y: 24830 },
    profile: 'full',
    layers: {
      building: buildings(r, 60),
      road: roads(r, 260, { elevated: 120 }),
      structure: roads(r, 140, { elevated: 140 }),
      ground: ground(r, 200, true),
      tree: trees(r, 200),
    },
  }),
  'L0 massing (16 child tiles of mixed density, simplified)': (r) => ({
    id: { z: 14, x: 13489, y: 6207 },
    profile: 'massing',
    extentLog2: 15,
    layers: {
      building: buildings(r, 2500, { vertices: [4, 7] }),
      road: roads(r, 300),
      green: simplePolys(r, 40, 'park'),
      water: simplePolys(r, 6, 'river'),
    },
  }),
};

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const results = [];
for (const [name, make] of Object.entries(SCENARIOS)) {
  const tile = make(rng(name.length * 97));
  const bytes = encodeTile(tile);
  const gz = gzipSync(bytes, { level: 6 }).length;
  const layers = {};
  for (const [layerName, layer] of Object.entries(tile.layers)) {
    const only = encodeTile({ ...tile, layers: { [layerName]: layer } });
    layers[layerName] = { raw: only.length, gzip: gzipSync(only, { level: 6 }).length };
  }
  for (let i = 0; i < 50; i++) decodeTile(bytes); // warm-up
  const decodeMs = [];
  const materializeMs = [];
  for (let i = 0; i < 200; i++) {
    const copy = bytes.slice().buffer;
    const t0 = performance.now();
    const t = decodeTile(copy);
    const t1 = performance.now();
    for (const l of Object.values(t.layers)) if (l.type === 'features') readFeatures(l);
    materializeMs.push(performance.now() - t1);
    decodeMs.push(t1 - t0);
  }
  results.push({
    scenario: name,
    profile: tile.profile,
    rawBytes: bytes.length,
    gzipBytes: gz,
    layers,
    decodeMs: { p50: +percentile(decodeMs, 50).toFixed(3), p95: +percentile(decodeMs, 95).toFixed(3) },
    materializeObjectsMs: {
      p50: +percentile(materializeMs, 50).toFixed(3),
      p95: +percentile(materializeMs, 95).toFixed(3),
    },
  });
}

const report = {
  date: new Date().toISOString(),
  machine: {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
  },
  method:
    'encodeTile on synthetic tiles; gzip level 6; decodeTile timed over 200 warm runs on fresh buffer copies (Node, single thread). materializeObjectsMs is the optional readFeatures() object conversion, not needed by the runtime.',
  budgets: {
    L1: { medianKB: 60, p95KB: 250, maxKB: 1024 },
    L0: { medianKB: 40, p95KB: 150, maxKB: 500 },
    decodeMsAC207: 5,
  },
  results,
};
const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(report, null, 2) + '\n');
for (const r of results)
  console.log(
    `${r.scenario.padEnd(64)} raw ${(r.rawBytes / 1024).toFixed(1).padStart(7)} KB  gzip ${(r.gzipBytes / 1024).toFixed(1).padStart(6)} KB  decode p50 ${r.decodeMs.p50} ms p95 ${r.decodeMs.p95} ms  objects p95 ${r.materializeObjectsMs.p95} ms`,
  );
