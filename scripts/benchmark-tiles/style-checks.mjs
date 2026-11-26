// WP-G browser checks (AC703, AC704, AC705, AC706, AC709) against the built demo in Chrome via CDP.
// Prerequisites: npm run demo:tiles && npm run build:demo
// Usage: CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" \
//   node scripts/benchmark-tiles/style-checks.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = path.join(root, 'apps/demo/dist');
const results = {};
const record = (ac, pass, detail) => {
  results[ac] = { pass, ...detail };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${ac} ${JSON.stringify(detail).slice(0, 400)}`);
};
const report = JSON.parse(readFileSync(path.join(dist, 'tiles/beijing-cbd-grow-9/report.json'), 'utf8'));
const pack = readFileSync(path.join(root, 'examples/phase2/styles/toon-pack.mjs'), 'utf8');

const page = await openPage(dist, 'index.html?hud=0&panel=0');
try {
  await page.waitFor('!!globalThis.cityMap', 30000);
  // Whole sample at L1: every L1 tile loaded.
  await page.evaluate(
    `cityMap.jumpTo({ center: [116.4605, 39.9095], zoom: 16.2, pitch: 0, bearing: 0 }); cityMap.whenIdle({ timeoutMs: 90000 })`,
  );
  const stats = () => page.evaluate('JSON.stringify(cityMap.getStats({ raw: true }))').then(JSON.parse);

  // AC704: switching built-in styles makes no request, rebuilds no geometry, and takes <= 100 ms (non-reference).
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap; const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      // Settle first: the triangle budget may still be showing or hiding detail groups (first upload of a hidden mesh).
      await m.whenIdle({ timeoutMs: 60000 }); await frame(); await frame();
      // renderer.info.memory counts only geometries already submitted. A changed shadow pass can upload an
      // existing mesh for the first time. Compare the actual tile BufferGeometry objects across every switch.
      const geometryIds = () => {
        const ids = [];
        m.scene.traverse((object) => { if (object.geometry && object.parent?.userData.tile) ids.push(object.geometry.uuid); });
        return ids.sort().join();
      };
      const geometries = geometryIds(); let sameGeometry = Boolean(geometries);
      const before = m.getStats(); const times = [];
      for (const id of ['dark', 'plain', 'light', 'dark', 'light']) {
        const t0 = performance.now(); await m.setStyle(id); await frame(); times.push(performance.now() - t0); sameGeometry &&= geometries === geometryIds();
      }
      const after = m.getStats();
      return { times, sameGeometry, requests: after.requests.started - before.requests.started, geometriesBefore: before.renderer.geometries, geometriesAfter: after.renderer.geometries };
    })()`);
    // The first switch to a style compiles its programs once; later switches reuse them.
    const warm = r.times.slice(2);
    record('AC704', r.requests === 0 && r.sameGeometry && Math.max(...warm) <= 100, {
      ...r,
      maxWarmMs: Math.max(...warm),
      note: 'setStyle + next frame; measured on the machine in the summary, not the reference device',
    });
  }

  // AC703 in the browser: an invalid spec is rejected with a field path and the map keeps its style.
  {
    const r = await page.evaluate(`(async () => {
      try { await cityMap.setStyle({ schemaVersion: 2, id: 'bad', roles: { wall: { color: 'blue' } } }); return { threw: false }; }
      catch (e) { return { threw: true, code: e.code, path: e.errors?.[0]?.path, style: cityMap.getStats({ raw: true }).raw.style }; }
    })()`);
    record('AC703-browser', r.threw && r.code === 'STYLE_INVALID' && r.path === '$.roles.wall.color', r);
  }

  // AC705: a rule colours buildings above 150 m; pixels of the tallest tower change, others keep their colour.
  {
    const r = await page.evaluate(`(async () => {
      const m = cityMap; const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      await m.setStyle({ schemaVersion: 2, id: 'rule-test', extends: 'plain',
        rules: [{ layer: 'building', when: ['>', ['get', 'height'], 150], set: { wall: { color: '#ff0000' } } }] });
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 16, pitch: 50, bearing: -20 });
      await m.whenIdle({ timeoutMs: 60000 }); await frame();
      const gl = m.renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      m.requestRender(); await frame();
      const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] < 90 && px[i + 2] < 90) red++;
      await m.setStyle('plain'); await frame();
      const px2 = new Uint8Array(w * h * 4); m.requestRender(); await frame(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px2);
      let red2 = 0; for (let i = 0; i < px2.length; i += 4) if (px2[i] > 150 && px2[i + 1] < 90 && px2[i + 2] < 90) red2++;
      return { redPixelsWithRule: red, redPixelsWithout: red2 };
    })()`);
    record('AC705-browser', r.redPixelsWithRule > 500 && r.redPixelsWithout < 50, r);
  }

  // AC706: ProvenanceFilter at runtime, no new requests; "observed heights only" leaves exactly the buildings the
  // build report counts as observed.
  {
    // A large second map so that every L1 tile of the sample is loaded at once.
    await page.evaluate(`(async () => {
      const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:0;top:0;width:2600px;height:2600px';
      document.body.appendChild(el);
      globalThis.bigMap = await createCityMap({ container: el, tiles: './tiles/beijing-cbd-grow-9/tileset.json',
        center: [116.4605, 39.9095], zoom: 16.4, pitch: 0, bearing: 0, interactive: false,
        // Force full-sample residency for this census; the viewport LOD budget is tested separately.
        quality: { residentBytes: 512 * 2**20, visibleTriangles: 4_000_000 } });
      await bigMap.whenIdle({ timeoutMs: 120000 }); return true;
    })()`);
    const big = () => page.evaluate('JSON.stringify(bigMap.getStats({ raw: true }))').then(JSON.parse);
    const before = await big();
    await page.evaluate(`bigMap.setFilter({ buildings: { minHeightProvenance: 'observed' } }); true`);
    const observed = (await big()).raw.buildings;
    await page.evaluate(`bigMap.setFilter({ buildings: { minHeightProvenance: 'derived' } }); true`);
    const derived = (await big()).raw.buildings;
    await page.evaluate(`bigMap.setFilter({}); true`);
    const all = (await big()).raw.buildings;
    const after = await big();
    await page.evaluate('bigMap.dispose().then(() => true)');
    const h = report.provenance.building.height;
    const expectObserved = h.observed;
    const expectDerived = h.observed + h.derived;
    record(
      'AC706',
      observed.shown === expectObserved &&
        derived.shown === expectDerived &&
        all.flattened === 0 &&
        all.total === h.observed + h.derived + h.inferred &&
        after.requests.started === before.requests.started,
      {
        reportHeight: h,
        loadedL1Buildings: all.total,
        observedOnly: observed,
        derivedOrBetter: derived,
        all,
        newRequests: after.requests.started - before.requests.started,
      },
    );
    // trees and roofs switches (no new requests)
    const r = await page.evaluate(`(async () => {
      const m = cityMap; await m.whenIdle({ timeoutMs: 60000 });
      const before = m.getStats({raw:true});
      m.setFilter({ roofs: { inferred: false }, trees: { inferred: false }, details: false });
      await m.whenIdle({ timeoutMs: 60000 });
      const mid = m.getStats({raw:true});
      m.setFilter({}); await m.whenIdle({ timeoutMs: 60000 });
      const after = m.getStats({raw:true});
      return { requests: after.requests.started - before.requests.started, before: before.raw.featureVisibility,
        filtered: mid.raw.featureVisibility, restored: after.raw.featureVisibility,
        idleWorkers: mid.workers.busy === 0 && mid.workers.queued === 0 && after.workers.busy === 0 && after.workers.queued === 0 };
    })()`);
    record(
      'AC706-switches',
      r.requests === 0 &&
        r.idleWorkers &&
        r.filtered.hiddenTrees > r.before.hiddenTrees &&
        r.filtered.hiddenDetails > r.before.hiddenDetails &&
        r.restored.hiddenTrees === r.before.hiddenTrees &&
        r.restored.hiddenDetails === r.before.hiddenDetails,
      r,
    );
  }

  // AC709: an independent custom StylePack draws tiles and tracks loads and unloads through its hooks.
  {
    const r = await page.evaluate(`(async () => {
      const THREE = await loadThree();
      const url = URL.createObjectURL(new Blob([${JSON.stringify(pack)}], { type: 'text/javascript' }));
      const pack = (await import(url)).default(THREE);
      const m = cityMap;
      await m.setStyle(pack);
      m.jumpTo({ center: [116.4605, 39.9095], zoom: 17, pitch: 50, bearing: 0 });
      await m.whenIdle({ timeoutMs: 60000 });
      const ready = () => m.getStats({ raw: true }).raw.tiles.filter((t) => t.state === 'ready').map((t) => t.key).sort();
      const loadedAfterLoad = [...pack.loaded].sort();
      const readyAfterLoad = ready();
      m.jumpTo({ center: [116.6, 40.1], zoom: 17 });
      await m.whenIdle({ timeoutMs: 60000 });
      await new Promise((r) => setTimeout(r, 3000)); m.requestRender(); await m.whenIdle({ timeoutMs: 60000 });
      const loadedAway = [...pack.loaded].sort(), readyAway = ready();
      const stats = m.getStats({ raw: true });
      await m.setStyle('light');
      return { pack: stats.raw.pack, loadedAfterLoad: loadedAfterLoad.length, readyAfterLoad: readyAfterLoad.length,
        sameAfterLoad: JSON.stringify(loadedAfterLoad) === JSON.stringify(readyAfterLoad),
        loadedAway: loadedAway.length, readyAway: readyAway.length, sameAway: JSON.stringify(loadedAway) === JSON.stringify(readyAway) };
    })()`);
    record(
      'AC709',
      r.pack === 'toon-example' &&
        r.sameAfterLoad &&
        r.loadedAfterLoad > 0 &&
        r.sameAway &&
        r.loadedAway < r.loadedAfterLoad,
      r,
    );
  }
  const errors = page.events.filter((e) => e.level === 'error');
  record('console', errors.length === 0, { errors: errors.slice(0, 3) });
} finally {
  await page.close();
}
const json = process.argv.indexOf('--json');
if (json > 0)
  writeFileSync(
    process.argv[json + 1],
    JSON.stringify(
      { date: new Date().toISOString(), gpuFlags: process.env.CITY_BROWSER_FLAGS ?? null, results },
      null,
      2,
    ),
  );
if (Object.values(results).some((r) => !r.pass)) process.exitCode = 1;
