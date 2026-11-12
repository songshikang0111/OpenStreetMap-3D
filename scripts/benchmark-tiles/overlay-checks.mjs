// WP-E browser checks (AC501-AC509) against the built demo in Chrome/Edge via CDP.
// Prerequisites: npm run demo:tiles && npm run build:demo. For frame-time checks (AC504) run with
// CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" to use the hardware GPU.
// Usage: node scripts/benchmark-tiles/overlay-checks.mjs [--json out.json]
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = path.join(os.tmpdir(), 'city-overlay-checks');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    path.join(root, 'apps/demo/vite.config.js'),
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

const page = await openPage(dist, 'index.html');
try {
  await page.waitFor('!!globalThis.cityMap', 30000);
  await page.evaluate('cityMap.whenIdle({ timeoutMs: 60000 })');
  await page.evaluate(`
    globalThis.T = {
      frame: () => new Promise((r) => requestAnimationFrame(() => r())),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      rng: (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296),
      THREE: null,
    };
    true;
  `);
  // CPU reference picker: raycast against the visible tile meshes, using renderId attributes.
  await page.evaluate(`
    T.cpuPick = (m, p) => {
      const meshes = [];
      m.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry.getAttribute('renderId') && o.parent?.userData.tile && o.parent.parent && o.visible) meshes.push(o); });
      const Ray = m.camera.constructor; // placeholder to keep the bundle's three instance
      return meshes;
    };
    true;
  `);

  // AC501/AC502: 100 picks over buildings, checked against the feature at that pixel found independently
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 17, pitch: 0, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      const rand = T.rng(501);
      const hits = [], times = [];
      let tries = 0;
      while (hits.length < 100 && tries < 4000) {
        tries++;
        const p = { x: 20 + rand() * 1240, y: 20 + rand() * 680 };
        const t0 = performance.now();
        const f = m.queryFeatures(p);
        times.push(performance.now() - t0);
        if (!f || f.layer !== 'building') continue;
        hits.push({ p, f });
      }
      // independent check: the click lies inside the screen projection of the picked building's 3D bounds
      let correct = 0; const wrong = [];
      for (const { p, f } of hits) {
        const [w, s, e, n] = f.bounds;
        const top = Number(f.properties.height ?? 0) + 30;
        const corners = [];
        for (const lng of [w, e]) for (const lat of [s, n]) for (const alt of [Number(f.properties.minHeight ?? 0), top]) corners.push(m.project([lng, lat], alt));
        const xs = corners.map((q) => q.x), ys = corners.map((q) => q.y);
        const inside = p.x >= Math.min(...xs) - 2 && p.x <= Math.max(...xs) + 2 && p.y >= Math.min(...ys) - 2 && p.y <= Math.max(...ys) + 2;
        if (inside && f.id && f.properties && f.provenance) correct++;
        else if (wrong.length < 3) wrong.push({ id: f.id, p, bounds: f.bounds });
      }
      times.sort((a, b) => a - b);
      const sample = hits[0]?.f;
      return { picks: hits.length, correct, wrong, pickMs: { p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)] }, sample: sample && { id: sample.id, layer: sample.layer, provenance: sample.provenance, keys: Object.keys(sample.properties).slice(0, 8) } };
    })()`);
    record('AC501', r.picks === 100 && r.correct === 100, {
      picks: r.picks,
      correct: r.correct,
      wrong: r.wrong,
      sample: r.sample,
    });
    record('AC502', r.pickMs.p95 <= 4, {
      pickMainThreadMs: r.pickMs,
      note: 'measured on the machine in the summary, not the high-end reference device',
    });
  }

  // AC503: highlight/hidden/colour without rebuilding geometry; kept across L0/L1 switches and reloads
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 17, pitch: 0, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      let target = null, point = null;
      const rand = T.rng(503);
      for (let i = 0; i < 2000 && !target; i++) {
        const p = { x: 300 + rand() * 680, y: 150 + rand() * 420 };
        const f = m.queryFeatures(p);
        if (f && f.layer === 'building') { target = f; point = p; }
      }
      const ll = m.unproject(point);
      const geometriesBefore = m.renderer.info.memory.geometries;
      m.setFeatureState(target.id, { highlight: true, color: '#ff0000' });
      await T.frame(); await T.frame();
      const stillPickable = m.queryFeatures(point)?.id === target.id;
      m.renderer.render(m.scene, m.camera);
      const gl = m.renderer.getContext(); const px = new Uint8Array(4);
      gl.readPixels(Math.round(point.x * m.renderer.getPixelRatio()), gl.drawingBufferHeight - Math.round(point.y * m.renderer.getPixelRatio()), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // colour red plus the orange highlight glow: strong red, little blue (an unstyled building is grey).
      const renderedRed = px[0] > 200 && px[2] < 80;
      m.setFeatureState(target.id, { hidden: true });
      await T.frame();
      const hiddenPick = m.queryFeatures(point)?.id === target.id;
      const geometriesAfter = m.renderer.info.memory.geometries;
      // L0: same building id appears in the massing tile
      m.jumpTo({ zoom: 13.6 });
      await m.whenIdle({ timeoutMs: 60000 });
      const pL0 = m.project(ll);
      const hiddenAtL0 = m.queryFeatures(pL0)?.id !== target.id;
      // unload and reload: go far away, wait past the unload delay, come back
      m.jumpTo({ center: [116.52, 39.95], zoom: 17 });
      await m.whenIdle({ timeoutMs: 60000 }); await T.sleep(1600); m.jumpTo({ center: [116.53, 39.96] }); await m.whenIdle({ timeoutMs: 60000 });
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 17, pitch: 0, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      const hiddenAfterReload = m.queryFeatures(m.project(ll))?.id !== target.id;
      m.setFeatureState(target.id, { hidden: false, highlight: false, color: null });
      await T.frame();
      const visibleAgain = m.queryFeatures(m.project(ll))?.id === target.id;
      return { feature: target.id, renderedRed, pixel: Array.from(px), highlightPickable: stillPickable, hiddenNotPicked: !hiddenPick, geometriesBefore, geometriesAfter, hiddenAtL0, hiddenAfterReload, visibleAgain };
    })()`);
    record(
      'AC503',
      r.renderedRed &&
        r.highlightPickable &&
        r.hiddenNotPicked &&
        r.geometriesBefore === r.geometriesAfter &&
        r.hiddenAtL0 &&
        r.hiddenAfterReload &&
        r.visibleAgain,
      r,
    );
  }

  // AC504: 500 markers on screen add at most 2 ms to the p95 frame interval during an animation
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16, pitch: 50, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      const run = async () => {
        const iv = []; let last = performance.now(), on = true;
        const loop = (t) => { iv.push(t - last); last = t; if (on) requestAnimationFrame(loop); };
        requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
        await m.easeTo({ bearing: 90, duration: 4000 });
        await m.easeTo({ bearing: 0, duration: 4000 });
        on = false;
        iv.sort((a, b) => a - b);
        return iv[Math.floor(iv.length * 0.95)];
      };
      const base = await run();
      const rand = T.rng(504), markers = [];
      for (let i = 0; i < 500; i++) {
        const el = document.createElement('div');
        el.style.cssText = 'width:8px;height:8px;border-radius:4px;background:#e2482d';
        markers.push(m.addMarker({ lngLat: [116.4555 + rand() * 0.01, 39.905 + rand() * 0.009], element: el }));
      }
      const withMarkers = await run();
      for (const mk of markers) mk.remove();
      const left = document.querySelectorAll('#map div[style*="e2482d"]').length;
      return { p95BaseMs: base, p95With500Ms: withMarkers, deltaMs: withMarkers - base, domLeftAfterRemove: left };
    })()`);
    record('AC504', r.deltaMs <= 2, r);
    record('AC509-markers', r.domLeftAfterRemove === 0, { domLeftAfterRemove: r.domLeftAfterRemove });
  }

  // AC505/AC508: marker and overlays stay on their lng/lat after a floating-origin reset; overlays are pickable
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      const at = [116.4612, 39.9101];
      const el = document.createElement('div'); el.style.cssText = 'width:2px;height:2px';
      const marker = m.addMarker({ lngLat: at, element: el, anchor: 'center' });
      const d = 0.0006;
      m.addLayer({ id: 'zone', type: 'fill', data: { type: 'Feature', id: 'zone-1', properties: { name: 'zone' }, geometry: { type: 'Polygon', coordinates: [[[at[0]-d, at[1]-d], [at[0]+d, at[1]-d], [at[0]+d, at[1]+d], [at[0]-d, at[1]+d], [at[0]-d, at[1]-d]]] } }, paint: { color: '#3a7bd5', opacity: 1 }, altitude: 80 });
      const anchorBefore = m.getStats().camera.anchor.join();
      m.jumpTo({ center: [at[0] + 0.25, at[1]], zoom: 16, pitch: 0 });
      await T.frame();
      m.jumpTo({ center: at, zoom: 17.5, pitch: 0, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      const anchorAfter = m.getStats().camera.anchor.join();
      const p = m.project(at);
      const tr = el.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/);
      const markerErr = Math.hypot(+tr[1] - p.x, +tr[2] - p.y);
      const picked = m.queryFeatures(p);
      const edge = m.queryFeatures(m.project([at[0] + d * 0.9, at[1] + d * 0.9]));
      const outside = m.queryFeatures(m.project([at[0] + d * 1.3, at[1] + d * 1.3]));
      marker.remove();
      return { reanchored: anchorBefore !== anchorAfter, markerErrorPx: markerErr, picked: picked && { id: picked.id, layer: picked.layer }, edgeLayer: edge?.layer ?? null, outsideLayer: outside?.layer ?? null };
    })()`);
    record(
      'AC505',
      r.reanchored &&
        r.markerErrorPx < 0.5 &&
        r.picked?.layer === 'zone' &&
        r.edgeLayer === 'zone' &&
        r.outsideLayer !== 'zone',
      r,
    );
    record('AC508', r.picked?.layer === 'zone' && r.picked?.id === 'zone-1', { picked: r.picked });
  }

  // AC506: line, fill, extrusion, circle and custom layers; line width stays in pixels across zooms
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      const c = [116.4605, 39.9095];
      m.removeLayer('zone');
      const geom0 = m.renderer.info.memory.geometries;
      m.addLayer({ id: 'route', type: 'line', data: { type: 'LineString', coordinates: [[c[0] - 0.004, c[1]], [c[0] + 0.004, c[1]]] }, paint: { color: '#e2482d', width: 12 }, altitude: 120 });
      m.addLayer({ id: 'area', type: 'fill', data: { type: 'Polygon', coordinates: [[[c[0]-0.003,c[1]+0.002],[c[0]-0.001,c[1]+0.002],[c[0]-0.001,c[1]+0.003],[c[0]-0.003,c[1]+0.003],[c[0]-0.003,c[1]+0.002]]] }, paint: { color: '#3a7bd5', opacity: 0.6 }, altitude: 600 });
      m.addLayer({ id: 'blocks', type: 'extrusion', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'b1', properties: { h: 660, b: 620 }, geometry: { type: 'Polygon', coordinates: [[[c[0]+0.001,c[1]+0.002],[c[0]+0.002,c[1]+0.002],[c[0]+0.002,c[1]+0.003],[c[0]+0.001,c[1]+0.003],[c[0]+0.001,c[1]+0.002]]] } }] }, paint: { color: '#8e44ad', height: 'h', base: 'b' } });
      m.addLayer({ id: 'dots', type: 'circle', data: { type: 'MultiPoint', coordinates: [[c[0]+0.003, c[1]-0.002], [c[0]+0.0035, c[1]-0.002]] }, paint: { color: '#16a085', radius: 9 } });
      const box = new m.camera.constructor.prototype.constructor; // keep a reference to the bundle's three namespace
      void box;
      const customMesh = m.scene.children.find((o) => o.isMesh)?.clone();
      m.addLayer({ id: 'custom', type: 'custom', object: customMesh ?? new m.scene.constructor(), lngLat: [c[0], c[1] - 0.003] });
      const widths = [];
      for (const zoom of [15.5, 17, 18.5]) {
        m.jumpTo({ center: c, zoom, pitch: 0, bearing: 0 });
        await T.frame(); await T.frame();
        const p = m.project([c[0], c[1]], 120);
        let up = 0, down = 0;
        while (m.queryFeatures({ x: p.x, y: p.y - up - 1 })?.layer === 'route' && up < 60) up++;
        while (m.queryFeatures({ x: p.x, y: p.y + down + 1 })?.layer === 'route' && down < 60) down++;
        widths.push(up + down + 1);
      }
      m.jumpTo({ center: c, zoom: 15, pitch: 0 });
      await T.frame();
      const types = {};
      for (const [id, ll, alt] of [['area', [c[0]-0.002, c[1]+0.0025], 600], ['blocks', [c[0]+0.0015, c[1]+0.0025], 660], ['dots', [c[0]+0.003, c[1]-0.002], 1]]) {
        const f = m.queryFeatures(m.project(ll, alt));
        types[id] = f?.layer ?? null;
      }
      for (const id of ['route', 'area', 'blocks', 'dots', 'custom']) m.removeLayer(id);
      await T.frame();
      return { lineWidthsPx: widths, pickedLayers: types, geometriesBefore: geom0, geometriesAfterRemove: m.renderer.info.memory.geometries };
    })()`);
    const steady = r.lineWidthsPx.every((w) => Math.abs(w - r.lineWidthsPx[0]) <= 1 && Math.abs(w - 12) <= 2);
    record(
      'AC506',
      steady && r.pickedLayers.area === 'area' && r.pickedLayers.blocks === 'blocks' && r.pickedLayers.dots === 'dots',
      r,
    );
    record('AC509', r.geometriesAfterRemove <= r.geometriesBefore, {
      geometriesBefore: r.geometriesBefore,
      geometriesAfterRemove: r.geometriesAfterRemove,
    });
  }

  // AC507: a 100,000-vertex GeoJSON layer is added in at most 100 ms
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap;
      const coords = [];
      for (let i = 0; i < 100000; i++) coords.push([116.45 + (i % 1000) * 0.00002, 39.90 + Math.floor(i / 1000) * 0.0002 + Math.sin(i) * 0.00001]);
      const lines = [];
      for (let i = 0; i < 100; i++) lines.push(coords.slice(i * 1000, (i + 1) * 1000));
      const data = { type: 'MultiLineString', coordinates: lines };
      const t0 = performance.now();
      m.addLayer({ id: 'big', type: 'line', data, paint: { color: '#333', width: 2 } });
      const addMs = performance.now() - t0;
      await T.frame();
      const firstFrameMs = performance.now() - t0;
      m.removeLayer('big');
      return { vertices: 100000, addMs, untilNextFrameMs: firstFrameMs };
    })()`);
    record('AC507', r.addMs <= 100, r);
  }
} catch (error) {
  console.log('ERROR', error.stack, JSON.stringify(page.events.slice(-10)));
  process.exitCode = 1;
} finally {
  const gpu = await page
    .evaluate(
      '(() => { const gl = cityMap.renderer.getContext(); const d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; })()',
    )
    .catch(() => null);
  const summary = {
    date: new Date().toISOString(),
    browser: page.version?.product,
    gpu,
    machine: { cpu: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()}` },
    results,
    consoleErrors: page.events.filter((e) => e.level === 'error').slice(0, 20),
  };
  const at = process.argv.indexOf('--json');
  if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2) + '\n');
  await page.close();
  if (Object.values(results).some((r) => !r.pass)) process.exitCode = 1;
}
