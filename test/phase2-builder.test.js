// WP-C acceptance tests on real phase-one samples (AC303-AC305, AC307, AC309-AC310).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTiles, BuildInterrupted } from '../packages/builder/dist/index.js';
import {
  decodeTile,
  readFeatures,
  readFeatureMeta,
  parseTileKey,
  defaultExtentLog2,
} from '../packages/tiles/dist/index.js';
import { parseOSM } from '../src/osm.js';
import { normalizeRaw } from '../src/core/contract.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = (name) => path.join(root, 'public/data', `${name}.json`);
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'city-tiles-'));

async function filesOf(dir) {
  const out = {};
  async function walk(d, rel = '') {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === '.build') continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p, `${rel}${entry.name}/`);
      else out[`${rel}${entry.name}`] = await readFile(p);
    }
  }
  await walk(dir);
  return out;
}

function assertSameFiles(a, b, label) {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${label}: file lists`);
  for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), `${label}: ${k} differs`);
}

test('AC303: one global planning cell and z12/z14 cells give identical tiles', async () => {
  for (const name of ['beijing-lingxiu-d', 'bibury-village']) {
    const base = await tmp();
    try {
      const one = await buildTiles({ input: sample(name), output: path.join(base, 'one'), cellZoom: -1 });
      for (const cellZoom of [12, 14]) {
        const many = await buildTiles({ input: sample(name), output: path.join(base, `z${cellZoom}`), cellZoom });
        assert.deepEqual(many.report.hashes, one.report.hashes, `${name} cell zoom ${cellZoom}`);
      }
      assert.ok(Object.keys(one.report.hashes).length > 3);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }
});

test('AC304: rebuilding the same input and options is byte-identical', async () => {
  const base = await tmp();
  try {
    await buildTiles({ input: sample('beijing-lingxiu-d'), output: path.join(base, 'a') });
    await buildTiles({ input: sample('beijing-lingxiu-d'), output: path.join(base, 'b') });
    assertSameFiles(await filesOf(path.join(base, 'a')), await filesOf(path.join(base, 'b')), 'rebuild');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('AC309: interrupting any stage and resuming gives the uninterrupted bytes', async () => {
  const base = await tmp();
  try {
    const input = sample('bibury-village');
    await buildTiles({ input, output: path.join(base, 'clean') });
    const clean = await filesOf(path.join(base, 'clean'));
    const stages = [
      { stage: 'ingest', count: 1 },
      { stage: 'plan', count: 1 },
      { stage: 'cut', count: 1 },
      { stage: 'encode', count: 3 },
      { stage: 'encode', count: 9 },
      { stage: 'finalize', count: 1 },
    ];
    let seed = 309;
    for (let i = 0; i < 6; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const failAfter = stages[seed % stages.length];
      const out = path.join(base, `run${i}`);
      await assert.rejects(buildTiles({ input, output: out, failAfter }), BuildInterrupted);
      await buildTiles({ input, output: out, resume: true });
      assertSameFiles(await filesOf(out), clean, `resume after ${failAfter.stage}#${failAfter.count}`);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('AC305: tile buildings equal the phase-one building set and each appears in exactly one L1 tile', async () => {
  const base = await tmp();
  try {
    for (const name of ['beijing-lingxiu-d', 'bibury-village', 'amsterdam-canals', 'beijing-cbd']) {
      const raw = JSON.parse(await readFile(sample(name), 'utf8'));
      const [south, west, north, east] = raw.metadata.bbox;
      const data = parseOSM(
        normalizeRaw(raw, {
          area: { south, west, north, east },
          origin: { lat: raw.metadata.center[0], lon: raw.metadata.center[1] },
        }),
        1,
      );
      const phase1 = new Set(
        data.buildings.map((b) =>
          b.id.startsWith('w') ? `way/${b.id.slice(1)}` : b.id.replace(/^r(\d+)-(\d+)$/, 'relation/$1#$2'),
        ),
      );
      const out = path.join(base, name);
      const { report } = await buildTiles({ input: sample(name), output: out });
      const seen = new Map();
      for (const key of Object.keys(report.hashes).filter((k) => k.startsWith('16/'))) {
        const tile = decodeTile(await readFile(path.join(out, key)));
        const landmark = tile.layers.landmark;
        const features = [
          ...(tile.layers.building ? readFeatures(tile.layers.building) : []),
          ...(landmark ? readFeatureMeta(landmark.features) : []),
        ];
        for (const f of features) {
          assert.ok(!seen.has(f.id), `${f.id} appears in ${seen.get(f.id)} and ${key}`);
          seen.set(f.id, key);
        }
      }
      assert.deepEqual([...seen.keys()].sort(), [...phase1].sort(), `${name} building identities`);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

/** Edges of polygon features that lie on the line x = X (vertical) or y = Y (horizontal), in global grid units. */
function boundaryCoverage(tile, layerName, axis, value) {
  const layer = tile.layers[layerName];
  if (!layer || layer.type !== 'features') return [];
  const e = 2 ** tile.extentLog2;
  const ox = tile.id.x * e + e / 2,
    oy = tile.id.y * e + e / 2;
  const spans = [];
  for (let ring = 0; ring + 1 < layer.vertexStart.length; ring++) {
    const a0 = layer.vertexStart[ring],
      a1 = layer.vertexStart[ring + 1];
    for (let v = a0; v < a1; v++) {
      const w = v + 1 < a1 ? v + 1 : a0;
      const p = [layer.positions[v * 2] + ox, layer.positions[v * 2 + 1] + oy];
      const q = [layer.positions[w * 2] + ox, layer.positions[w * 2 + 1] + oy];
      const h = (i) => (layer.elevation ? layer.baseElevation + layer.elevation[i] / 16 : 0);
      if (axis === 'x' && p[0] === value && q[0] === value)
        spans.push({ lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]), p, q, hp: h(v), hq: h(w) });
      if (axis === 'y' && p[1] === value && q[1] === value)
        spans.push({ lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]), p, q, hp: h(v), hq: h(w) });
    }
  }
  return spans;
}

function sampleAt(spans, t, axis) {
  const k = axis === 'x' ? 1 : 0;
  const levels = spans
    .filter((s) => s.lo < t && t < s.hi)
    .map((s) => {
      const u = (t - s.p[k]) / (s.q[k] - s.p[k]);
      return s.hp + (s.hq - s.hp) * u;
    })
    .sort((a, b) => a - b);
  // identical levels from overlapping pieces count once
  return levels.filter((h, i) => i === 0 || Math.abs(h - levels[i - 1]) > 0.01);
}

test('AC307: ground, water and green are seamless across L1 tile edges (random boundary samples)', async () => {
  const base = await tmp();
  try {
    let samples = 0,
      covered = 0;
    for (const name of ['beijing-cbd', 'amsterdam-canals']) {
      const out = path.join(base, name);
      const { report } = await buildTiles({ input: sample(name), output: out });
      const keys = new Set(
        Object.keys(report.hashes)
          .filter((k) => k.startsWith('16/'))
          .map((k) => k.replace(/\.c3t$/, '')),
      );
      const tiles = new Map();
      const load = async (k) =>
        tiles.get(k) ?? tiles.set(k, decodeTile(await readFile(path.join(out, `${k}.c3t`)))).get(k);
      let rng = 307;
      const next = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (const key of [...keys].sort()) {
        const id = parseTileKey(key);
        const e = 2 ** defaultExtentLog2(16);
        for (const [neighbour, axis, value] of [
          [`16/${id.x + 1}/${id.y}`, 'x', (id.x + 1) * e],
          [`16/${id.x}/${id.y + 1}`, 'y', (id.y + 1) * e],
        ]) {
          if (!keys.has(neighbour)) continue;
          const A = await load(key),
            B = await load(neighbour);
          for (const layer of ['ground', 'water', 'green']) {
            const sa = boundaryCoverage(A, layer, axis, value),
              sb = boundaryCoverage(B, layer, axis, value);
            const start = axis === 'x' ? id.y * e : id.x * e;
            for (let i = 0; i < 20; i++) {
              const t = start + Math.floor(next() * e) + 0.5;
              const ha = sampleAt(sa, t, axis),
                hb = sampleAt(sb, t, axis);
              samples++;
              // Several surfaces can stack at one point (bridge deck over paving): compare the sets of levels.
              assert.equal(ha.length, hb.length, `${name} ${layer} coverage differs at ${key}|${neighbour} t=${t}`);
              if (ha.length) {
                covered++;
                ha.forEach((h, k) =>
                  assert.ok(Math.abs(h - hb[k]) <= 0.01, `${name} ${layer} elevation ${ha} vs ${hb}`),
                );
              }
            }
          }
        }
      }
    }
    assert.ok(samples >= 20 && covered >= 20, `${samples} samples, ${covered} covered`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('AC307: road centrelines are cut at identical grid points and elevations on both sides', async () => {
  const base = await tmp();
  try {
    const out = path.join(base, 'beijing');
    const { report } = await buildTiles({ input: sample('beijing-cbd'), output: out });
    const keys = new Set(
      Object.keys(report.hashes)
        .filter((k) => k.startsWith('16/'))
        .map((k) => k.replace(/\.c3t$/, '')),
    );
    let crossings = 0;
    for (const key of keys) {
      const id = parseTileKey(key);
      const right = `16/${id.x + 1}/${id.y}`;
      if (!keys.has(right)) continue;
      const e = 2 ** 14;
      const X = (id.x + 1) * e;
      const ends = async (k) => {
        const t = decodeTile(await readFile(path.join(out, `${k}.c3t`)));
        const ox = t.id.x * e + e / 2,
          oy = t.id.y * e + e / 2;
        const set = new Set();
        for (const f of readFeatures(t.layers.road))
          f.geometry.forEach((part, pi) =>
            part.forEach((ring, ri) => {
              for (let v = 0; v < ring.length; v += 2)
                if (ring[v] + ox === X)
                  set.add(`${f.id}@${ring[v + 1] + oy}:${Math.round(f.elevation[pi][ri][v / 2] * 100)}`);
            }),
          );
        return set;
      };
      const a = await ends(key),
        b = await ends(right);
      assert.deepEqual([...a].sort(), [...b].sort(), `${key}|${right}`);
      crossings += a.size;
    }
    assert.ok(crossings >= 20, `${crossings} road crossings checked`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('AC310: the build report and the CLI follow the phase-one output contract', async () => {
  const base = await tmp();
  try {
    const out = path.join(base, 'cli');
    const result = execFileSync(
      process.execPath,
      [
        path.join(root, 'bin/city.js'),
        'tiles',
        'build',
        '--input',
        sample('bibury-village'),
        '--output',
        out,
        '--json',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const lines = result.trim().split('\n');
    assert.equal(lines.length, 1, 'stdout holds exactly one JSON result');
    const json = JSON.parse(lines[0]);
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.status, 'succeeded');
    assert.ok(Array.isArray(json.artifacts) && Array.isArray(json.diagnostics));
    const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
    for (const k of ['counts', 'provenance', 'incompleteRelations', 'fallbacks', 'tiles', 'diagnostics', 'hashes'])
      assert.ok(k in report, k);
    assert.ok(report.counts.building > 0);
    const shares = report.provenance.building.height;
    assert.equal(shares.observed + shares.derived + shares.inferred, report.counts.building);
    const validate = JSON.parse(
      execFileSync(process.execPath, [path.join(root, 'bin/city.js'), 'tiles', 'validate', out, '--json'], {
        encoding: 'utf8',
      }),
    );
    assert.equal(validate.status, 'succeeded');
    let code = 0;
    try {
      execFileSync(
        process.execPath,
        [path.join(root, 'bin/city.js'), 'tiles', 'validate', path.join(base, 'missing'), '--json'],
        { stdio: 'pipe' },
      );
    } catch (error) {
      code = error.status;
      assert.equal(JSON.parse(error.stdout).diagnostics[0].code, 'TILESET_MISSING');
    }
    assert.equal(code, 1);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
