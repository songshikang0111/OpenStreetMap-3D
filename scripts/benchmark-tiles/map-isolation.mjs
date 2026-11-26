// Real WebGL checks for padded MapLibre cameras, physical viewport ownership, and concurrent maps.
// Run after demo:tiles and build:demo, optionally passing a JSON output path.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

async function hostProbe() {
  const frame = () =>
    new Promise((resolve) => {
      mlMap.once('render', resolve);
      mlMap.triggerRepaint();
    });
  const buildings = await fetch('./tiles/beijing-cbd-grow-9/buildings.geojson').then((r) => r.json());
  const tallest = buildings.features.reduce((a, b) => (a.properties.height > b.properties.height ? a : b));
  const ring = tallest.geometry.coordinates[0].slice(0, -1);
  const at = ring.reduce(([x, y], p) => [x + p[0] / ring.length, y + p[1] / ring.length], [0, 0]);
  const vertices = buildings.features.flatMap((f) => f.geometry.coordinates[0]);
  const results = [];
  for (const [width, height, dpr, left, top, right, bottom] of [
    [800, 600, 1, 0, 0, 0, 0],
    [800, 600, 1, 200, 0, 0, 0],
    [800, 600, 1, 0, 100, 0, 0],
    [681, 451, 1.5, 0, 10, 150, 60],
    [712, 510, 2, 200, 100, 30, 20],
    [800, 600, 1, 0, 0, 0, 0],
  ]) {
    const container = mlMap.getContainer();
    container.style.width = width + 'px';
    container.style.height = height + 'px';
    mlMap.setPixelRatio(dpr);
    mlMap.resize();
    const expectedBuffer = [mlMap.getCanvas().width, mlMap.getCanvas().height];
    mlMap.jumpTo({ center: at, zoom: 16, pitch: 0, bearing: 0, padding: { left, top, right, bottom } });
    await frame();
    await cityLayer.whenIdle({ timeoutMs: 60000 });
    await frame();
    const p = mlMap.project(at);
    const picked = cityLayer.queryFeatures(p);
    const repicked = cityLayer.queryFeatures(p);
    mlMap.jumpTo({ pitch: 58, bearing: 27 });
    await frame();
    let visible = 0,
      worst = 0;
    for (const position of vertices) {
      const a = mlMap.project(position),
        b = cityLayer.project(position);
      if (a.x < 0 || a.y < 0 || a.x > width || a.y > height) continue;
      if (!b) throw Error('Visible footprint vertex has no layer projection');
      visible++;
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
    results.push({
      width,
      height,
      dpr,
      padding: [left, top, right, bottom],
      expectedBuffer,
      actualBuffer: [mlMap.getCanvas().width, mlMap.getCanvas().height],
      picked: picked?.id,
      repicked: repicked?.id,
      kind: picked?.layer,
      visible,
      worst,
    });
  }
  const retry = createMapLibreLayer({ id: 'retry-probe', tiles: './tiles/beijing-cbd-grow-9/tileset.json' });
  const canvas = mlMap.getCanvas();
  const countBefore = mlMap.getContainer().childElementCount;
  const waiting = retry.ready().then(
    () => false,
    (e) => /WebGL/i.test(e.message),
  );
  const getContext = canvas.getContext;
  let rejected = false;
  try {
    canvas.getContext = () => null;
    retry.onAdd(mlMap, null);
  } catch (error) {
    rejected = /WebGL/i.test(error.message);
  } finally {
    delete canvas.getContext;
  }
  if (canvas.getContext !== getContext) throw Error('Unable to restore host context');
  const rejectedReady = await waiting;
  const unchanged = mlMap.getCanvas() === canvas && mlMap.getContainer().childElementCount === countBefore;
  mlMap.addLayer(retry);
  await retry.ready();
  const sameContext = retry.renderer.getContext() === canvas.getContext('webgl2');
  mlMap.removeLayer(retry.id);
  await frame();
  return { cameras: results, retry: { rejected, rejectedReady, unchanged, sameContext } };
}

async function mapsProbe() {
  const tiles = './tiles/beijing-cbd-grow-9/tileset.json';
  const container = document.createElement('div');
  container.style.cssText = 'width:320px;height:240px';
  document.body.append(container);
  const opts = { container, tiles, center: [0, 0], zoom: 16, pitch: 0, bearing: 0 };
  const getContext = HTMLCanvasElement.prototype.getContext;
  let rejected = false;
  try {
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
    await createCityMap(opts);
  } catch (error) {
    rejected = /WebGL/i.test(error.message);
  } finally {
    HTMLCanvasElement.prototype.getContext = getContext;
  }
  const childrenAfterFailure = container.childElementCount,
    positionAfterFailure = container.style.position;
  const second = await createCityMap(opts);
  const first = cityMap;
  const layer = {
    id: 'swatch',
    type: 'fill',
    altitude: 2,
    paint: { color: '#000000' },
    data: {
      type: 'Feature',
      id: 'sample',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-0.001, -0.001],
            [0.001, -0.001],
            [0.001, 0.001],
            [-0.001, 0.001],
            [-0.001, -0.001],
          ],
        ],
      },
    },
  };
  const style = (color) => ({
    schemaVersion: 2,
    id: 'highlight-' + color.slice(1),
    extends: 'plain',
    featureState: { highlight: { emissive: color, emissiveIntensity: 1 } },
  });
  async function swatch(map) {
    const renderer = map.renderer,
      original = renderer.render;
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('No render')), 15000);
        renderer.render = function (scene, camera) {
          original.call(this, scene, camera);
          const gl = this.getContext(),
            pixel = new Uint8Array(4);
          gl.readPixels(
            gl.drawingBufferWidth >> 1,
            gl.drawingBufferHeight >> 1,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel,
          );
          clearTimeout(timeout);
          resolve(Array.from(pixel));
        };
        map.requestRender();
      });
    } finally {
      renderer.render = original;
    }
  }
  try {
    first.jumpTo({ center: [0, 0], zoom: 16, pitch: 0, bearing: 0 });
    for (const map of [first, second]) {
      map.addLayer(layer);
      map.setFeatureState('sample', { highlight: true });
    }
    await first.setStyle(style('#ff0000'));
    await second.setStyle(style('#00ff00'));
    const before = [await swatch(first), await swatch(second)];
    await second.dispose();
    const after = await swatch(first);
    return { rejected, childrenAfterFailure, positionAfterFailure, before, after };
  } finally {
    await second.dispose();
    container.remove();
  }
}

const dist = process.env.CITY_DEMO_DIST ?? fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url));
const result = {};
for (const [name, url, ready, probe] of [
  ['host', 'maplibre.html?preserve=1', 'globalThis.cityLayer?.renderer && mlMap.isStyleLoaded()', hostProbe],
  ['standalone', 'index.html?tiles=./tiles/beijing-cbd-grow-9/tileset.json', '!!globalThis.cityMap', mapsProbe],
]) {
  const page = await openPage(dist, url, { width: 800, height: 600 });
  try {
    await page.waitFor(ready, 60000);
    result.browser = page.version.product;
    result[name] = await page.evaluate('(' + probe.toString() + ')()');
  } finally {
    await page.close();
  }
}
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(result.host.retry, { rejected: true, rejectedReady: true, unchanged: true, sameContext: true });
for (const run of result.host.cameras) {
  assert.ok(run.visible > 50 && run.worst <= 2);
  assert.ok(['building', 'landmark'].includes(run.kind));
  assert.equal(run.picked, result.host.cameras[0].picked);
  assert.equal(run.repicked, run.picked);
  assert.deepEqual(run.actualBuffer, run.expectedBuffer);
}
const { rejected, childrenAfterFailure, positionAfterFailure, before, after } = result.standalone;
assert.ok(rejected);
assert.equal(childrenAfterFailure, 0);
assert.equal(positionAfterFailure, '');
assert.ok(before[0][0] > before[0][1] + 100);
assert.ok(before[1][1] > before[1][0] + 100);
assert.deepEqual(after, before[0]);
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
