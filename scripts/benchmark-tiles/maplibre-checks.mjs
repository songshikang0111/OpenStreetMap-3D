// WP-H checks (AC801-AC806): City Ink as a MapLibre GL JS custom layer, in Chrome/Edge via CDP.
// Prerequisites: npm run demo:tiles && npm run build:demo
// Usage: CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" \
//        node scripts/benchmark-tiles/maplibre-checks.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const results = {};
const record = (ac, pass, detail) => {
  results[ac] = { pass, ...detail };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${ac} ${JSON.stringify(detail).slice(0, 400)}`);
};
const maplibreVersion = JSON.parse(
  readFileSync(path.join(root, 'node_modules/maplibre-gl/package.json'), 'utf8'),
).version;

const page = await openPage(path.join(root, 'apps/demo/dist'), 'maplibre.html?preserve=1');
try {
  await page.waitFor(
    '!!globalThis.cityLayer && !!globalThis.mlMap && mlMap.loaded() && !!mlMap.getLayer("city3d")',
    60000,
  );
  await page.evaluate('cityLayer.ready().then(() => cityLayer.whenIdle({ timeoutMs: 60000 }))');

  // AC801: the 04 section 8 usage: basemap boxes hidden, our buildings drawn
  {
    const r = await page.evaluate(`(() => {
      const s = cityLayer.getStats();
      return { boxesVisibility: mlMap.getLayoutProperty('building-3d', 'visibility'), visibleTiles: s.tiles.visible, drawCalls: s.drawCalls, maplibre: mlMap.version ?? null };
    })()`);
    const errors = page.events.filter((e) => e.level === 'error');
    record('AC801', r.boxesVisibility === 'none' && r.visibleTiles > 0 && errors.length === 0, {
      ...r,
      consoleErrors: errors.length,
    });
  }

  // AC802: building base outlines land where MapLibre puts the same lng/lat (50 cameras, zoom 14-19, pitch 0-75)
  {
    const r = await page.evaluate(`(async () => {
      const gj = await fetch('./tiles/beijing-cbd-grow-9/buildings.geojson').then((x) => x.json());
      const verts = gj.features.slice(0, 60).flatMap((f) => f.geometry.coordinates[0].slice(0, 4));
      let seed = 802; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const c0 = mlMap.getCenter();
      let worst = 0, points = 0;
      for (let i = 0; i < 50; i++) {
        mlMap.jumpTo({ center: [c0.lng + (rand() - 0.5) * 0.01, c0.lat + (rand() - 0.5) * 0.008], zoom: 14 + rand() * 5, pitch: rand() * 75, bearing: rand() * 360 - 180 });
        await new Promise((res) => mlMap.once('render', res));
        for (const v of verts) {
          const a = mlMap.project(v), b = cityLayer.project(v);
          if (!b || a.x < 0 || a.y < 0 || a.x > 1280 || a.y > 720) continue;
          worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y)); points++;
        }
      }
      mlMap.jumpTo({ center: c0, zoom: 16, pitch: 60, bearing: -20 });
      return { cameras: 50, points, worstPx: worst };
    })()`);
    record('AC802', r.points > 500 && r.worstPx <= 2, {
      ...r,
      note: 'host camera vs layer camera on footprint vertices; tile placement accuracy is covered by AC203/AC307 (grid quantisation <= 3 cm)',
    });
  }
  await page.evaluate('cityLayer.whenIdle({ timeoutMs: 60000 })');

  // AC803/AC804: host layers above the city stay visible; removing the layer restores the host image and frees GPU objects
  {
    const r = await page.evaluate(`(async () => {
      const frame = () => new Promise((res) => { mlMap.once('render', res); mlMap.triggerRepaint(); });
      // Count pixels of a green text symbol drawn by MapLibre directly over a building. With no glyphs URL
      // MapLibre rasterises the local font, which also works offline.
      const greenText = (p) => {
        const gl = mlMap.getCanvas().getContext('webgl2');
        const ratio = mlMap.getPixelRatio(), w = Math.ceil(100 * ratio), h = Math.ceil(48 * ratio);
        const rgba = new Uint8Array(w * h * 4);
        gl.readPixels(Math.round(p.x * ratio - w/2), Math.round(gl.drawingBufferHeight - p.y * ratio - h/2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        let n = 0;
        for (let i = 0; i < rgba.length; i += 4) if (rgba[i] < 80 && rgba[i+1] > 200 && rgba[i+2] < 80) n++;
        return n;
      };
      const gj = await fetch('./tiles/beijing-cbd-grow-9/buildings.geojson').then((x) => x.json());
      const tall = gj.features.sort((a, b) => b.properties.height - a.properties.height)[0];
      const ring = tall.geometry.coordinates[0];
      const at = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      mlMap.jumpTo({ center: at, zoom: 16.5, pitch: 0, bearing: 0 });
      await cityLayer.whenIdle({ timeoutMs: 60000 }); await frame();
      const under = cityLayer.queryFeatures(mlMap.project(at));
      mlMap.addSource('probe', { type: 'geojson', data: { type: 'Point', coordinates: at } });
      mlMap.addLayer({ id: 'probe', type: 'symbol', source: 'probe',
        layout: { 'text-field': 'CITY', 'text-font': ['sans-serif'], 'text-size': 30, 'text-allow-overlap': true },
        paint: { 'text-color': '#00ff00' } });
      for (let i = 0; i < 200 && !mlMap.isSourceLoaded('probe'); i++) await frame();
      await frame(); await frame();
      const p = mlMap.project(at);
      let greenLabelPixels = 0;
      for (let i = 0; i < 120 && greenLabelPixels < 30; i++) {
        await frame();
        greenLabelPixels = greenText(p);
      }
      mlMap.removeLayer('probe'); mlMap.removeSource('probe');
      // host image without the city layer, before and after add/remove
      const renderer = cityLayer.renderer;
      mlMap.removeLayer('city3d'); await frame(); await frame();
      const before = mlMap.getCanvas().toDataURL();
      const layer2 = createMapLibreLayer({ id: 'city3d', tiles: './tiles/beijing-cbd-grow-9/tileset.json' });
      const willAttach = layer2.ready(); mlMap.addLayer(layer2); await willAttach; await layer2.whenIdle({ timeoutMs: 60000 }); await frame();
      const r2 = layer2.renderer; const geomWhileOn = r2.info.memory.geometries;
      mlMap.removeLayer('city3d'); await frame(); await frame();
      const after = mlMap.getCanvas().toDataURL();
      return { buildingUnderProbe: under?.layer ?? null, greenLabelPixels, hostImageRestored: before === after, geometriesWhileOn: geomWhileOn, geometriesAfterRemove: r2.info.memory.geometries, firstRendererAfterRemove: renderer.info.memory.geometries, hostStillLoaded: mlMap.loaded() };
    })()`);
    record(
      'AC803',
      ['building', 'landmark'].includes(r.buildingUnderProbe) && r.greenLabelPixels >= 30 && r.hostImageRestored,
      {
        buildingUnderProbe: r.buildingUnderProbe,
        greenLabelPixels: r.greenLabelPixels,
        hostImageRestored: r.hostImageRestored,
        note: 'host symbol with a locally rasterised text-field above the city layer',
      },
    );
    record(
      'AC804',
      r.geometriesWhileOn > 0 && r.geometriesAfterRemove === 0 && r.firstRendererAfterRemove === 0 && r.hostStillLoaded,
      {
        geometriesWhileOn: r.geometriesWhileOn,
        geometriesAfterRemove: r.geometriesAfterRemove,
        hostStillLoaded: r.hostStillLoaded,
      },
    );
  }
} catch (error) {
  console.log('ERROR', error.stack, JSON.stringify(page.events.slice(-8)));
  process.exitCode = 1;
} finally {
  await page.close();
}

// AC805: the main entry does not import maplibre-gl; the peer dependency is optional
{
  const manifest = JSON.parse(readFileSync(path.join(root, 'packages/map/package.json'), 'utf8'));
  const mainFiles = [
    'index.js',
    'map.js',
    'transform.js',
    'selection.js',
    'tile-object.js',
    'controls.js',
    'pool.js',
    'styles.js',
  ];
  const imports = mainFiles.flatMap((f) =>
    [...readFileSync(path.join(root, 'packages/map/dist', f), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    ),
  );
  const bundle = readFileSync(path.join(root, 'packages/map/bundle/city-map.js'), 'utf8');
  record(
    'AC805',
    !imports.some((i) => i.includes('maplibre')) &&
      !/maplibre-gl/.test(bundle) &&
      manifest.peerDependenciesMeta?.['maplibre-gl']?.optional === true,
    {
      mainImports: [...new Set(imports)],
      optionalPeer: manifest.peerDependenciesMeta?.['maplibre-gl'],
    },
  );
  record('AC806', manifest.peerDependencies['maplibre-gl'] === '>=6.16.0 <7.0.0' && maplibreVersion === '6.16.0', {
    tested: maplibreVersion,
    declared: manifest.peerDependencies['maplibre-gl'],
  });
}
const at = process.argv.indexOf('--json');
if (at > 0)
  writeFileSync(
    process.argv[at + 1],
    JSON.stringify(
      {
        date: new Date().toISOString(),
        machine: { cpu: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()}` },
        maplibre: maplibreVersion,
        results,
      },
      null,
      2,
    ) + '\n',
  );
if (Object.values(results).some((r) => !r.pass)) process.exitCode = 1;
