// WP-C supplement (C2): L0 road bands face up, L0 massing uses the L1 facade palette, bridges get parapets, piers and
// stairs, and small low buildings carry no roof equipment (decision E7).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTiles } from '../packages/builder/dist/index.js';
import { decodeTile, readFeatureMetaAt } from '../packages/tiles/dist/index.js';
import { generateTile, ROLE_LIST } from '../packages/generators/dist/index.js';
import { roofEquipment, ROOF_EQUIPMENT_MIN_HEIGHT, ROOF_EQUIPMENT_MIN_LOW_AREA } from '../src/building-rules.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = (name) => path.join(root, 'public/data', `${name}.json`);

async function tilesOf(dir, z) {
  const out = [];
  for (const x of await readdir(path.join(dir, String(z))))
    for (const f of await readdir(path.join(dir, String(z), x)))
      out.push(decodeTile(new Uint8Array(await readFile(path.join(dir, String(z), x, f)))));
  return out;
}

/** Every triangle's winding agrees with its stored normal (front faces visible, nothing culled by accident). */
function windingErrors(batch) {
  let bad = 0;
  const p = batch.position,
    n = batch.normal;
  const tri = batch.index;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const ux = p[b * 3] - p[a * 3],
      uy = p[b * 3 + 1] - p[a * 3 + 1],
      uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3],
      vy = p[c * 3 + 1] - p[a * 3 + 1],
      vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue;
    if (cx * n[a * 3] + cy * n[a * 3 + 1] + cz * n[a * 3 + 2] < 0) bad++;
  }
  return bad;
}

let built;
async function beijing() {
  if (built) return built;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-c2-'));
  const { report } = await buildTiles({ input: sample('beijing-cbd'), output: dir });
  built = { dir, report, l0: await tilesOf(dir, 14), l1: await tilesOf(dir, 16) };
  return built;
}
test.after(async () => built && rm(built.dir, { recursive: true, force: true }));

test('C2: L0 major-road bands and L1 structure decks are generated with upward-facing tops', async () => {
  const { l0, l1 } = await beijing();
  let roadTriangles = 0;
  for (const t of l0) {
    const g = generateTile(t);
    const road = ROLE_LIST.indexOf('road');
    for (const b of g.batches.filter((b) => b.layer === 'ground')) {
      for (let t = 0; t < b.index.length; t += 3) if (b.roleIndex[b.index[t]] === road) roadTriangles++;
      assert.equal(windingErrors(b), 0, `L0 ${t.id.z}/${t.id.x}/${t.id.y} road winding`);
      // every band top is lifted above the ground and faces +y
      let up = 0;
      for (let v = 0; v < b.vertexCount; v++) if (b.normal[v * 3 + 1] > 0.99) up++;
      assert.ok(up > 0);
    }
  }
  assert.ok(roadTriangles > 500, `L0 road triangles ${roadTriangles}`);
  for (const t of l1) {
    const g = generateTile(t);
    for (const b of g.batches.filter((b) => b.layer === 'structure'))
      assert.equal(windingErrors(b), 0, `L1 ${t.id.z}/${t.id.x}/${t.id.y} structure winding`);
  }
});

test('C2: an L0 massing prism has the wall colour and facade attributes of the same building at L1', async () => {
  const { l0, l1 } = await beijing();
  const colours = (tiles) => {
    const out = new Map();
    for (const t of tiles) {
      const layer = t.layers.building;
      if (!layer) continue;
      const byRid = new Map();
      for (let i = 0; i < layer.featureCount; i++) byRid.set(layer.renderId[i], readFeatureMetaAt(layer, i).id);
      for (const b of generateTile(t).batches) {
        if (b.layer !== 'building') continue;
        for (let v = 0; v < b.vertexCount; v++) {
          const role = ROLE_LIST[b.roleIndex[v]];
          if (role !== 'wall' && role !== 'glass') continue;
          // vertical walls only (skip trims and roofs written in the wall colour)
          if (Math.abs(b.normal[v * 3 + 1]) > 0.01 || !b.facade || b.facade.aFacade[v * 4 + 2] <= 0) continue;
          const id = byRid.get(b.renderId[v]);
          if (!id || out.has(id)) continue;
          out.set(id, {
            role,
            color: [b.color[v * 3], b.color[v * 3 + 1], b.color[v * 3 + 2]].map((c) => c.toFixed(4)).join(','),
            style: b.facade.aStyle[v * 2],
          });
        }
      }
    }
    return out;
  };
  const a = colours(l0),
    b = colours(l1);
  let same = 0,
    compared = 0;
  for (const [id, c0] of a) {
    const c1 = b.get(id);
    if (!c1) continue;
    compared++;
    if (c0.color === c1.color && c0.role === c1.role && c0.style === c1.style) same++;
  }
  assert.ok(compared > 100, `compared ${compared}`);
  // Buildings whose L1 wall is split by a roof (eaves) or a landmark claim may differ; nearly all must match.
  assert.ok(same / compared > 0.97, `${same} of ${compared} L0 prisms match their L1 wall colour and style`);
});

test('C2: bridges get parapets, handrails and piers, and OSM steps become stair flights', async () => {
  const { l1, report } = await beijing();
  const kinds = {};
  let structureTriangles = 0;
  for (const t of l1) {
    const layer = t.layers.structure;
    if (!layer) continue;
    for (let i = 0; i < layer.featureCount; i++) {
      const k = readFeatureMetaAt(layer, i).properties.kind;
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    for (const b of generateTile(t).batches) if (b.layer === 'structure') structureTriangles += b.index.length / 3;
  }
  for (const k of ['deck', 'rail', 'rail.walk', 'pier', 'stairs'])
    assert.ok(kinds[k] > 0, `${k}: ${JSON.stringify(kinds)}`);
  assert.ok(structureTriangles > 10000, `structure triangles ${structureTriangles}`);
  assert.ok(
    report.counts.structure >= Object.values(kinds).reduce((s, n) => s + n, 0) - kinds.rail - kinds['rail.walk'],
  );
});

test('E7: no rooftop equipment on small low buildings; large or tall roofs keep it', () => {
  const box = (w, d) => [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
  const b = (w, d, height) => ({
    id: `w${w}${d}${height}`,
    tags: { building: 'yes' },
    outer: box(w, d),
    holes: [],
    area: w * d,
    height,
    minHeight: 0,
    levels: Math.round(height / 3),
  });
  assert.deepEqual(roofEquipment(b(15, 20, 7)), [], 'two-storey 300 m² house');
  assert.deepEqual(roofEquipment(b(30, 40, ROOF_EQUIPMENT_MIN_HEIGHT - 0.5)), [], 'low 1,200 m² building');
  assert.ok(roofEquipment(b(30, 40, ROOF_EQUIPMENT_MIN_HEIGHT + 3)).length > 0, 'five-storey 1,200 m² building');
  assert.ok(roofEquipment(b(40, 50, 8)).length > 0, `low hall above ${ROOF_EQUIPMENT_MIN_LOW_AREA} m²`);
});

test('C2/AC303: parapets, piers and stairs do not depend on the planning-cell partition', async () => {
  const { report } = await beijing();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-c2-one-'));
  try {
    const one = await buildTiles({ input: sample('beijing-cbd'), output: dir, cellZoom: -1 });
    assert.deepEqual(one.report.hashes, report.hashes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('near details: complete walls are collected for frames, sills and balconies only on request', async () => {
  const { l1 } = await beijing();
  const { nearbyFacadeFrames } = await import('../src/facade-layout.js');
  let walls = 0,
    frames = 0;
  for (const t of l1) {
    assert.equal(generateTile(t).nearWalls, undefined);
    const g = generateTile(t, { collectNearWalls: true });
    walls += g.nearWalls.length;
    for (const w of g.nearWalls) assert.ok(w.renderId > 0 && w.len > 7 && w.layout.bays >= 1);
    if (g.nearWalls.length) {
      const w = g.nearWalls[0];
      frames += nearbyFacadeFrames(g.nearWalls, {
        x: w.a[0] + w.normal[0] * 20,
        y: 20,
        z: w.a[1] + w.normal[2] * 20,
      }).length;
    }
  }
  assert.ok(walls > 200, `walls ${walls}`);
  assert.ok(frames > 100, `frames ${frames}`);
});
