// WP-D unit tests for the DOM-free parts of @city-ink/map (camera transform, tile selection, worker pool).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Transform, selectTiles } from '../packages/map/dist/index.js';
import { WorkerPool } from '../packages/map/dist/pool.js';
import { Coverage, lngLatToTile, childTiles } from '../packages/tiles/dist/index.js';

const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

test('AC403 (Node): project and unproject are inverse on the ground', () => {
  const r = rng(403);
  const t = new Transform();
  t.resize(1280, 720);
  for (let c = 0; c < 50; c++) {
    t.anchor = [116.4 + r() * 0.1, 39.9 + r() * 0.05];
    t.set({
      center: [116.4 + r() * 0.1, 39.9 + r() * 0.05],
      zoom: 13 + r() * 6,
      pitch: r() * 75,
      bearing: r() * 360 - 180,
    });
    for (let i = 0; i < 20; i++) {
      const p = { x: r() * 1280, y: 300 + r() * 420 };
      const ll = t.unproject(p);
      if (!ll) continue;
      const q = t.project(ll);
      assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1e-6, `${JSON.stringify(p)} -> ${JSON.stringify(q)}`);
    }
  }
});

test('the centre projects to the viewport centre and the camera height follows MapLibre', () => {
  const t = new Transform();
  t.resize(1000, 800);
  t.anchor = [116.46, 39.91];
  t.set({ center: [116.46, 39.91], zoom: 16, pitch: 0, bearing: 0 });
  const c = t.project([116.46, 39.91]);
  assert.ok(Math.abs(c.x - 500) < 1e-9 && Math.abs(c.y - 400) < 1e-9);
  // camera height = cameraToCenterDistance (px) × metres per pixel at the centre
  const expected = t.cameraToCenterDistance * t.unitsPerPixel;
  assert.ok(Math.abs(t.camera.position.y - expected) < 1e-6);
  // north is up and east is right at bearing 0
  const north = t.project([116.46, 39.911]);
  const east = t.project([116.461, 39.91]);
  assert.ok(north.y < 400 && Math.abs(north.x - 500) < 1e-6);
  assert.ok(east.x > 500 && Math.abs(east.y - 400) < 1e-6);
  t.set({ bearing: 90 });
  const eastUp = t.project([116.461, 39.91]);
  assert.ok(eastUp.y < 400, 'bearing 90 puts east at the top');
});

test('re-anchoring changes world coordinates but not screen positions', () => {
  const t = new Transform();
  t.resize(800, 600);
  t.anchor = [116.4, 39.9];
  t.set({ center: [116.5, 39.95], zoom: 15, pitch: 50, bearing: 30 });
  const before = t.project([116.51, 39.955]);
  t.anchor = [116.5, 39.95];
  t.update();
  const after = t.project([116.51, 39.955]);
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-6);
});

const tileset = {
  bounds: [116.44, 39.89, 116.48, 39.93],
  levels: [
    { id: 'L0', zoom: 14, profile: 'massing', geometricErrorMeters: 12 },
    { id: 'L1', zoom: 16, profile: 'full', geometricErrorMeters: 0.5 },
  ],
};

test('selection refines to L1 near the camera, stays at L0 far away, and respects coverage', () => {
  const t = new Transform();
  t.resize(1280, 720);
  t.anchor = [116.46, 39.91];
  const all = [];
  for (const l0 of [lngLatToTile(116.45, 39.92, 14), lngLatToTile(116.47, 39.9, 14)]) all.push(...childTiles(l0, 16));
  const coverage = Coverage.fromTiles(
    16,
    all.filter((_, i) => i % 5 !== 0),
  );
  const opts = { maximumScreenSpaceError: 16, prefetchMargin: 0, hysteresis: 0.18, maxDistance: 20000 };
  t.set({ center: [116.46, 39.91], zoom: 17, pitch: 0, bearing: 0 });
  const near = selectTiles(t, tileset, coverage, opts, new Set());
  assert.ok(near.length > 0 && near.every((d) => d.id.z === 16), JSON.stringify(near.map((d) => d.key)));
  assert.ok(
    near.every((d) => coverage.has(d.id)),
    'no tile outside coverage',
  );
  t.set({ zoom: 12.5 });
  const far = selectTiles(t, tileset, coverage, opts, new Set());
  assert.ok(far.length > 0 && far.every((d) => d.id.z === 14));
  // priorities are sorted by distance
  for (let i = 1; i < near.length; i++) assert.ok(near[i].priority >= near[i - 1].priority);
});

class FakeWorker {
  constructor(behaviour) {
    this.behaviour = behaviour;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }
  postMessage(message) {
    setTimeout(() => {
      if (this.behaviour === 'crash') this.onerror?.({ message: 'module failed to load' });
      else
        this.onmessage?.({
          data: {
            type: 'result',
            job: message.job,
            tile: 'x',
            generated: {},
            features: [],
            decodeMs: 1,
            generateMs: 2,
          },
        });
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
}

test('worker pool: priority order, cancellation of queued jobs, and no hang when every worker dies', async () => {
  const pool = new WorkerPool(1, () => new FakeWorker('ok'));
  const order = [];
  const a = pool.run(new ArrayBuffer(1), 5, {});
  const b = pool.run(new ArrayBuffer(1), 9, {});
  const c = pool.run(new ArrayBuffer(1), 1, {});
  const bResult = b.promise.catch((e) => e);
  b.cancel();
  await Promise.all([a.promise.then(() => order.push('a')), c.promise.then(() => order.push('c'))]);
  assert.equal((await bResult).name, 'AbortError');
  assert.deepEqual(order, ['a', 'c']);
  pool.terminate();

  const dead = new WorkerPool(2, () => new FakeWorker('crash'));
  const jobs = [1, 2, 3, 4].map((p) => dead.run(new ArrayBuffer(1), p, {}).promise.catch((e) => e));
  const errors = await Promise.all(jobs);
  assert.ok(errors.every((e) => e instanceof Error));
  assert.ok(
    errors.some((e) => e.diagnostic?.code === 'WORKER_FAILED'),
    'queued jobs fail with WORKER_FAILED',
  );
  await assert.rejects(
    dead.run(new ArrayBuffer(1), 0, {}).promise,
    (error) => error.diagnostic?.code === 'WORKER_FAILED',
  );
  dead.terminate();
});

test('worker prepares per-role ink and bounded tree instances before transfer', async () => {
  const { prepareUpload } = await import('../packages/map/dist/upload-data.js');
  const { ROLE_LIST } = await import('@city-ink/generators');
  const { Matrix4, Vector3 } = await import('three');
  const roles = ['wall', 'roof', 'road', 'road.marking', 'water', 'ground.plaza'];
  const { ink, crowns, trunks, bounds } = prepareUpload({
    batches: [{ roleIndex: new Float32Array(roles.map((r) => ROLE_LIST.indexOf(r))), vertexCount: roles.length }],
    trees: { count: 2, data: new Float32Array([5, 2, 7, 10, 3, 0, -9, 1, 6, 6, 2, 4]) },
  });
  assert.deepEqual(Array.from(ink[0]), Array.from(new Float32Array([1.25, 1, 3, 3.5, 6, 3.2])));
  const top = (array, i) => new Vector3(0, 1, 0).applyMatrix4(new Matrix4().fromArray(array, 16 * i));
  assert.ok(top(crowns, 0).distanceTo(new Vector3(5, 12, 7)) < 0.00001);
  assert.ok(top(crowns, 1).distanceTo(new Vector3(-9, 7, 6)) < 0.00001);
  assert.ok(Math.abs(top(trunks, 0).y - (2 + 10 - 4.8 * 0.9)) < 0.00001);
  assert.deepEqual(bounds, [-10.1, 1, 4, 8, 12, 10]);
});

test('cancel an unpublished upload between batches and release its materials', async () => {
  const { prepareTileObject, MaterialLibrary, tileCost } = await import('../packages/map/dist/tile-object.js');
  const { prepareUpload } = await import('../packages/map/dist/upload-data.js');
  const batch = {
    layer: 'ground',
    role: 'ground',
    vertexCount: 3,
    position: new Float32Array(9),
    normal: new Float32Array(9),
    color: new Float32Array(9),
    roleIndex: new Float32Array(3),
    renderId: new Float32Array(3),
    index: new Uint32Array([0, 1, 2]),
    bounds: [0, 0, 0, 1, 0, 1],
  };
  const generated = {
    batches: [batch, batch],
    trees: { count: 0, data: new Float32Array(), renderId: new Float32Array() },
  };
  const materials = new MaterialLibrary();
  const prepare = () => prepareTileObject(generated, materials, 1, prepareUpload(generated));
  const first = prepare();
  assert.equal(first.next().done, false);
  assert.equal([...materials.entries()].length, 1);
  first.return();
  assert.equal([...materials.entries()].length, 0);
  const second = prepare();
  second.next();
  second.next();
  const complete = second.next();
  assert.equal(complete.done, true);
  assert.equal(complete.value.group.children.length, 2);
  const published = complete.value;
  assert.deepEqual(tileCost(generated, 1, 128), {
    bytes: published.bytes + published.state.data.byteLength + 128,
    triangles: published.triangles,
    draws: published.drawCalls,
  });
  assert.equal(tileCost(generated, 1, 128, new Set(['ground'])).triangles, 0);
  complete.value.dispose();
  assert.equal([...materials.entries()].length, 0);
});

test('live timing distributions retain the original percentile definition through eviction', async () => {
  const { RollingTimings } = await import('../packages/map/dist/timings.js');
  const window = new RollingTimings(11),
    values = [];
  assert.equal(window.percentile(0.5), null);
  const random = rng(4231);
  for (let i = 0; i < 150; i++) {
    const ms = Math.round(random() * 10) / 2;
    window.push(ms);
    values.push(ms);
    const current = values.slice(-11).sort((a, b) => a - b);
    for (const p of [0, 0.5, 0.95, 1])
      assert.equal(window.percentile(p), current[Math.min(current.length - 1, Math.floor(p * current.length))]);
    assert.deepEqual(window.values, values.slice(-11));
  }
});

test('refinement reserves complete sibling groups and pinned ancestors before spending the remaining budget', async () => {
  const { fitRefinements } = await import('../packages/map/dist/refinement-budget.js');
  const leaf = (x, priority) => ({ key: `16/${x}/0`, id: { z: 16, x, y: 0 }, level: 1, priority, sse: 100 });
  const target = [leaf(0, 1), leaf(1, 2), leaf(4, 3)];
  const costs = new Map(
    [
      ['14/0/0', 10],
      ['14/1/0', 10],
      ['16/0/0', 40],
      ['16/1/0', 40],
      ['16/4/0', 35],
    ].map(([key, n]) => [key, { bytes: n, triangles: n, draws: 1 }]),
  );
  const fit = (limits, ready = () => true) =>
    fitRefinements(target, [14, 16], costs, ready, new Set(), { bytes: 100, triangles: 100, draws: 8, ...limits });
  assert.deepEqual(
    fit({}).leaves.map((d) => d.key),
    ['16/0/0', '16/1/0', '14/1/0'],
  );
  assert.deepEqual(
    fit({ bytes: 99 }).leaves.map((d) => d.key),
    ['14/0/0', '16/4/0'],
  );
  assert.deepEqual(
    fit({ triangles: 79 }).leaves.map((d) => d.key),
    ['14/0/0', '16/4/0'],
  );
  const mandatory = fit({ bytes: 1 });
  assert.deepEqual(
    mandatory.leaves.map((d) => d.key),
    ['14/0/0', '14/1/0'],
  );
  assert.equal(mandatory.rootCost.bytes, 20);
  assert.deepEqual(
    fit({ bytes: 1 }, () => false).leaves.map((d) => d.key),
    target.map((d) => d.key),
  );
});

test('first-generation input buffers count toward sibling admission while geometry costs are unknown', async () => {
  const { fitRefinements } = await import('../packages/map/dist/refinement-budget.js');
  const leaves = [0, 1].map((x) => ({
    key: `16/${x}/0`,
    id: { z: 16, x, y: 0 },
    level: 1,
    priority: x,
    sse: 100,
  }));
  const costs = new Map([
    ['14/0/0', { bytes: 10, triangles: 1, draws: 1 }],
    ['16/0/0', { bytes: 85, triangles: 1, draws: 1 }],
  ]);
  const select = (inputBytes) => {
    costs.set('16/1/0', { bytes: inputBytes, triangles: 0, draws: 0, sourceOnly: true });
    return fitRefinements(leaves, [14, 16], costs, () => true, new Set(), {
      bytes: 100,
      triangles: 10,
      draws: 10,
    }).leaves.map((tile) => tile.key);
  };
  assert.deepEqual(select(5), ['16/0/0', '16/1/0']);
  assert.deepEqual(select(6), ['14/0/0']);
});
