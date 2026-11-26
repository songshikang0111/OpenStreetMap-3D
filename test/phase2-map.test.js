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
