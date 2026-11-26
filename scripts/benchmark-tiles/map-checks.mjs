// WP-D browser checks (AC401, AC403, AC405-AC412) against the built demo in Chrome/Edge via CDP.
// Prerequisites: npm run demo:tiles && npm run build:demo
// Usage: node scripts/benchmark-tiles/map-checks.mjs [--json out.json] [--headful]
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Unminified build so that function names in CPU profiles are meaningful (AC409); tiles come from apps/demo/public.
const dist = path.join(os.tmpdir(), 'city-map-checks');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    path.join(root, 'apps/demo/vite.config.js'),
    '--minify',
    'false',
    '--outDir',
    dist,
    '--emptyOutDir',
  ],
  { stdio: 'ignore' },
);
const results = {};
const record = (ac, pass, detail) => {
  results[ac] = { pass, ...detail };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${ac} ${JSON.stringify(detail).slice(0, 400)}`);
};

const page = await openPage(dist, 'index.html', { headless: !process.argv.includes('--headful') });
try {
  await page.waitFor('!!globalThis.cityMap && !!globalThis.createCityMap', 30000);
  await page.evaluate('cityMap.whenIdle({ timeoutMs: 60000 })');
  // helpers available to every scenario
  await page.evaluate(`
    globalThis.T = {
      raw: (m) => m.getStats({ raw: true }).raw,
      frame: () => new Promise((r) => requestAnimationFrame(() => r())),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      parent: (key, z) => { const [tz, x, y] = key.split('/').map(Number); const d = 2 ** (tz - z); return z + '/' + Math.floor(x / d) + '/' + Math.floor(y / d); },
      children: (key, z) => { const [tz, x, y] = key.split('/').map(Number); const d = 2 ** (z - tz); const out = []; for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) out.push(z + '/' + (x * d + i) + '/' + (y * d + j)); return out; },
      container: () => { const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px'; document.body.appendChild(el); return el; },
      tilesUrl: './tiles/beijing-cbd-grow-9/tileset.json',
    };
    true;
  `);

  // AC401: the 04 section 2 usage renders Beijing CBD
  {
    const s = await page.evaluate('JSON.stringify(cityMap.getStats())').then(JSON.parse);
    const errors = page.events.filter((e) => e.level === 'error');
    record('AC401', s.tiles.visible > 0 && s.drawCalls > 0 && errors.length === 0, {
      visible: s.tiles.visible,
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      errors: errors.length,
    });
  }

  // A two-pass pack isolates the render counter contract: picking and stats queries must not alter a completed frame.
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap, THREE = await loadThree();
      let firstCalls, bothCalls, firstTris, bothTris;
      await m.setStyle({ id: 'two-pass-probe', supportsTiles: true,
        createMaterial: () => new THREE.MeshBasicMaterial(),
        createPipeline: ({ renderer, scene, camera }) => ({
          resize() {}, dispose() {},
          render() {
            renderer.render(scene, camera);
            firstCalls = renderer.info.render.calls; firstTris = renderer.info.render.triangles;
            renderer.render(scene, camera);
            bothCalls = renderer.info.render.calls; bothTris = renderer.info.render.triangles;
          }
        })
      });
      await m.whenIdle({timeoutMs:60000});
      const s = m.getStats({raw:true});
      m.queryFeatures({x:640,y:360});
      const after = m.getStats();
      const flags = s.raw.workerSamples.map((sample) => sample.profile);
      await m.setStyle('light');
      await m.whenIdle({timeoutMs:60000});
      return { firstCalls, bothCalls, firstTris, bothTris, stable: after.triangles === s.triangles && after.drawCalls === s.drawCalls,
        counted: bothTris === s.triangles && bothCalls === s.drawCalls,
        gpuAvailable: s.raw.gpu.available, gpuSamples: s.raw.gpu.samples, gpuReason: s.raw.gpu.reason,
        workerProfiles: [...new Set(flags)] };
    })()`);
    record(
      'multi-pass-accounting',
      r.stable &&
        r.counted &&
        r.bothTris > r.firstTris &&
        r.bothCalls > r.firstCalls &&
        r.workerProfiles.includes('full') &&
        (r.gpuAvailable ? r.gpuSamples > 0 : !!r.gpuReason),
      r,
    );
  }

  // AC403: project/unproject are inverse on the ground (1,000 random points, <= 0.5 px)
  {
    const r = await page.evaluate(`(() => {
      const m = cityMap; let seed = 403; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16, pitch: 60, bearing: -20 });
      let worst = 0, n = 0;
      while (n < 1000) {
        const p = { x: rand() * 1280, y: 250 + rand() * 470 };
        const ll = m.unproject(p); if (!ll) continue;
        const q = m.project(ll); worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y)); n++;
      }
      return { points: n, worstPx: worst };
    })()`);
    record('AC403', r.worstPx <= 0.5, r);
  }

  // AC405: floating origin over a 60 km straight pan, anchored objects stay put
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16, pitch: 45, bearing: 30 });
      const fixed = [116.47, 39.91];
      const g = m.createAnchor(fixed, 10);
      let prev = null, maxJump = 0, anchorErrM = 0, resets = 0, lastAnchor = m.getStats().camera.anchor.join();
      for (let i = 0; i < 600; i++) {
        const c = m.getCenter();
        const d = 100 / (111320 * Math.cos(c[1] * Math.PI / 180));
        m.jumpTo({ center: [c[0] + d, c[1]] });
        const a = m.getStats().camera.anchor.join(); if (a !== lastAnchor) { resets++; lastAnchor = a; }
        const q = [c[0] + d + 0.002, c[1] + 0.001];
        const p = m.project(q);
        if (prev && p) maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.y - prev.y));
        prev = p;
        const back = m.worldToLngLat(g.position);
        anchorErrM = Math.max(anchorErrM, Math.hypot((back.lngLat[0] - fixed[0]) * 85000, (back.lngLat[1] - fixed[1]) * 111000), Math.abs(back.altitude - 10));
        if (i % 50 === 0) await T.frame();
      }
      g.removeFromParent();
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16, pitch: 60, bearing: -20 });
      return { steps: 600, km: 60, anchorResets: resets, maxScreenJumpPx: maxJump, anchorErrorMeters: anchorErrM };
    })()`);
    record('AC405', r.anchorResets >= 5 && r.maxScreenJumpPx < 0.5 && r.anchorErrorMeters < 0.01, r);
  }
  await page.evaluate('cityMap.whenIdle({ timeoutMs: 60000 })');

  // AC406: zoom 14 -> 17 -> 14 on a fixed path, checking every frame for holes
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 14, pitch: 30, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      let frames = 0, holes = 0; const examples = [];
      let running = true;
      const check = () => {
        const raw = T.raw(m);
        const visible = new Set(raw.tiles.filter((t) => t.visible).map((t) => t.key));
        for (const d of raw.desired) {
          const z = +d.split('/')[0];
          const covered = visible.has(d) || [14].some((pz) => pz < z && visible.has(T.parent(d, pz))) || (z === 14 && T.children(d, 16).filter((c) => raw.tiles.some((t) => t.key === c)).length > 0 && T.children(d, 16).every((c) => !raw.desired.includes(c) || visible.has(c)) && T.children(d, 16).some((c) => visible.has(c)));
          if (!covered) { holes++; if (examples.length < 5) examples.push({ frame: frames, tile: d }); }
        }
        frames++;
        if (running) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      for (let i = 0; i < 2; i++) {
        await m.easeTo({ zoom: 17, duration: 2500 });
        await T.sleep(400);
        await m.easeTo({ zoom: 14, duration: 2500 });
        await T.sleep(400);
      }
      await m.whenIdle({ timeoutMs: 60000 });
      running = false;
      return { frames, holeFrames: holes, examples };
    })()`);
    record('AC406', r.holeFrames === 0 && r.frames > 100, r);
  }

  // AC407: a still camera makes no requests; sub-metre jitter does not switch tiles
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16.5, pitch: 55, bearing: 10 });
      await m.whenIdle({ timeoutMs: 60000 });
      const before = m.getStats().requests.started;
      await T.sleep(2000);
      const still = m.getStats().requests.started - before;
      const visible0 = T.raw(m).tiles.filter((t) => t.visible).map((t) => t.key).sort().join();
      let switches = 0;
      for (let i = 0; i < 40; i++) {
        const d = (i % 2 ? 0.4 : -0.4) / 85000;
        m.jumpTo({ center: [116.4605 + d, 39.9095 + d / 2] });
        await T.frame();
        const v = T.raw(m).tiles.filter((t) => t.visible).map((t) => t.key).sort().join();
        if (v !== visible0) switches++;
      }
      await T.sleep(300);
      return { requestsWhileStill: still, jitterRequests: m.getStats().requests.started - before - still, tileSwitches: switches };
    })()`);
    record('AC407', r.requestsWhileStill === 0 && r.jitterRequests === 0 && r.tileSwitches === 0, r);
  }

  // AC408: moving away quickly cancels stale requests; the worker queue stays within budget
  {
    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: 2_000_000,
      uploadThroughput: 2_000_000,
    });
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      const s0 = m.getStats().requests;
      m.jumpTo({ center: [116.4560, 39.9050], zoom: 18, pitch: 70, bearing: 120 });
      let maxQueue = 0;
      for (let i = 0; i < 3; i++) { await T.frame(); }
      m.jumpTo({ center: [116.4650, 39.9140], zoom: 18, pitch: 70, bearing: -60 });
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) { const w = m.getStats().workers; maxQueue = Math.max(maxQueue, w.queued + w.busy); await T.frame(); }
      await m.whenIdle({ timeoutMs: 60000 });
      const s1 = m.getStats().requests;
      return { cancelled: s1.cancelled - s0.cancelled, started: s1.started - s0.started, maxWorkerQueue: maxQueue, budget: 12 };
    })()`);
    await page.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    record('AC408', r.cancelled > 0 && r.maxWorkerQueue <= r.budget, r);
  }

  // AC409: decode and generation never run on the main thread (CPU profile of the page's main thread)
  {
    await page.send('Profiler.enable');
    await page.send('Profiler.setSamplingInterval', { interval: 200 });
    await page.send('Profiler.start');
    await page.evaluate(`(async () => {
      const m2 = await createCityMap({ container: T.container(), tiles: T.tilesUrl, zoom: 16.5, pitch: 60, center: [116.4605, 39.9095] });
      await m2.whenIdle({ timeoutMs: 60000 });
      await m2.dispose();
      document.body.lastChild.remove();
    })()`);
    const { profile } = await page.send('Profiler.stop');
    const names = new Set(profile.nodes.map((n) => n.callFrame.functionName));
    const banned = [
      'decodeTile',
      'generateTile',
      'writeBuildingBody',
      'generateBuildings',
      'planBuildingEnvelopes',
      'prepareUpload',
    ];
    const found = banned.filter((n) => names.has(n));
    const workerFrames = profile.nodes.filter((n) => /\/assets\/worker/.test(n.callFrame.url)).length;
    record('AC409', found.length === 0 && workerFrames === 0 && names.has('prepareTileObject'), {
      mainThreadFunctions: names.size,
      bannedFound: found,
      workerChunkFramesOnMainThread: workerFrames,
      sawUpload: names.has('prepareTileObject'),
    });
  }

  // AC410: retries then tileerror with the parent kept; no requests for tiles absent from coverage
  {
    const r = await page.evaluate(`(async () => {
      const report = await fetch('./tiles/beijing-cbd-grow-9/report.json').then((x) => x.json());
      const existing = new Set(Object.keys(report.hashes).filter((k) => k.endsWith('.c3t')).map((k) => k.replace('.c3t', '')));
      const failing = [...existing].find((k) => k.startsWith('16/'));
      const requested = [], attempts = { n: 0 };
      const readAsset = async (url, o) => {
        const key = (url.match(/(\\d+\\/\\d+\\/\\d+)\\.c3t/) || [])[1];
        if (key) requested.push(key);
        if (key === failing) { attempts.n++; throw new TypeError('simulated network failure'); }
        const res = await fetch(url, { signal: o.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return o.responseType === 'json' ? res.json() : res.arrayBuffer();
      };
      const m2 = await createCityMap({ container: T.container(), tiles: T.tilesUrl, readAsset, zoom: 17.2, pitch: 0, center: [116.4605, 39.9095] });
      const errors = [];
      m2.on('tileerror', (e) => errors.push(e.tile));
      const [z, x, y] = failing.split('/').map(Number);
      const ll = [((x + 0.5) / 2 ** z) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z))) * 180) / Math.PI];
      m2.jumpTo({ center: ll, zoom: 17.2, pitch: 0 });
      const t0 = performance.now();
      while (!errors.length && performance.now() - t0 < 20000) await T.sleep(100);
      await T.sleep(500);
      const raw = T.raw(m2);
      const parentVisible = raw.tiles.some((t) => t.key === T.parent(failing, 14) && t.visible);
      const outside = requested.filter((k) => !existing.has(k));
      await m2.dispose();
      document.body.lastChild.remove();
      return { failing, attempts: attempts.n, tileerror: errors, parentVisible, requested: requested.length, requestedOutsideCoverage: outside.length };
    })()`);
    record(
      'AC410',
      r.tileerror.length === 1 && r.attempts === 3 && r.parentVisible && r.requestedOutsideCoverage === 0,
      r,
    );
  }

  // AC411: 20 round trips without growth; dispose releases GPU objects and terminates workers
  {
    const r = await page.evaluate(`(async () => {
      const created = [], terminated = [];
      const Native = globalThis.Worker;
      globalThis.Worker = class extends Native { constructor(...a) { super(...a); created.push(this); } terminate() { terminated.push(this); super.terminate(); } };
      const m2 = await createCityMap({ container: T.container(), tiles: './tiles/kyoto-gion-grow-9/tileset.json', pitch: 50 });
      globalThis.Worker = Native;
      const a = m2.getCenter();
      const b = [a[0] + 0.006, a[1] + 0.003];
      const samples = [];
      for (let i = 0; i < 20; i++) {
        m2.jumpTo({ center: b, zoom: 17, bearing: 40 }); await m2.whenIdle({ timeoutMs: 60000 });
        m2.jumpTo({ center: a, zoom: 16, bearing: 0 }); await m2.whenIdle({ timeoutMs: 60000 });
        await T.sleep(1400); await m2.whenIdle({ timeoutMs: 60000 });
        const s = m2.getStats(); samples.push({ resident: s.residentBytes, geometries: s.renderer.geometries });
      }
      const renderer = m2.renderer;
      await m2.dispose();
      document.body.lastChild.remove();
      let threw = false; try { m2.getZoom(); } catch (e) { threw = e.code === 'MAP_DISPOSED'; }
      return { samples, after: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0 }, workers: created.length, terminated: terminated.length, disposedThrows: threw };
    })()`);
    const first = r.samples[4],
      last = r.samples.at(-1);
    const grows = last.resident > first.resident * 1.1 || last.geometries > first.geometries * 1.1;
    // Three.js r186 keeps one global DFG_LUT texture for physically based materials, shared by every renderer and
    // never disposed by design; it is the only texture this check tolerates.
    record(
      'AC411',
      !grows &&
        r.after.geometries === 0 &&
        r.after.textures <= 1 &&
        r.after.programs === 0 &&
        r.terminated === r.workers &&
        r.disposedThrows,
      {
        note: 'textures <= 1: three.js global DFG_LUT singleton',
        residentFirst: first.resident,
        residentLast: last.resident,
        geometriesFirst: first.geometries,
        geometriesLast: last.geometries,
        after: r.after,
        workers: r.workers,
        terminated: r.terminated,
        disposedThrows: r.disposedThrows,
      },
    );
  }

  // AC412 (emulated only): one-finger pan and two-finger pinch through CDP touch events
  {
    const before = await page.evaluate('({ c: cityMap.getCenter(), z: cityMap.getZoom() })');
    const touch = (type, points) =>
      page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    await touch('touchStart', [[640, 400]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[640 + i * 15, 400 + i * 5]]);
    await touch('touchEnd', []);
    await page.evaluate('T.sleep(800)');
    const panned = await page.evaluate('({ c: cityMap.getCenter(), z: cityMap.getZoom() })');
    await touch('touchStart', [
      [600, 400],
      [700, 400],
    ]);
    for (let i = 1; i <= 10; i++)
      await touch('touchMove', [
        [600 - i * 10, 400],
        [700 + i * 10, 400],
      ]);
    await touch('touchEnd', []);
    await page.evaluate('T.sleep(300)');
    const pinched = await page.evaluate('({ c: cityMap.getCenter(), z: cityMap.getZoom() })');
    const moved = Math.hypot(panned.c[0] - before.c[0], panned.c[1] - before.c[1]) > 1e-6;
    record('AC412', moved && pinched.z > panned.z + 0.3, {
      platform: 'emulated touch in desktop Chrome (not a real mobile device: unverified)',
      panMoved: moved,
      zoomBefore: panned.z,
      zoomAfter: pinched.z,
    });
  }
} catch (error) {
  console.log('ERROR', error.stack, JSON.stringify(page.events.slice(-10)));
  process.exitCode = 1;
} finally {
  const summary = {
    date: new Date().toISOString(),
    browser: page.version?.product,
    machine: { cpu: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()}` },
    results,
    consoleErrors: page.events.filter((e) => e.level === 'error').slice(0, 20),
  };
  const at = process.argv.indexOf('--json');
  if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2) + '\n');
  await page.close();
  if (Object.values(results).some((r) => !r.pass)) process.exitCode = 1;
}
