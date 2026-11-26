// r186/AC411 diagnostic. Run after demo:tiles and build:demo. Optional argument: JSON evidence path.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const dist = process.env.CITY_DEMO_DIST ?? fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url));

// Runs in the demo page. Read the compiled PBR uniform after a draw. The observer delegates to the original
// render method, restores it immediately, and never dispatches a Three texture disposal event.
async function probe(hosted) {
  async function frame(renderer, repaint) {
    const original = renderer.render;
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(Error('PBR draw timed out')), 30000);
        renderer.render = function (scene, camera) {
          const result = original.call(this, scene, camera);
          let lut;
          scene.traverse((object) => {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              if (!lut && material?.isMeshStandardMaterial && renderer.properties.has(material))
                lut = renderer.properties.get(material).uniforms?.dfgLUT?.value;
            }
          });
          if (lut?.name === 'DFG_LUT' && renderer.info.render.triangles > 0) {
            const gl = renderer.getContext(),
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
            resolve({ lut, pixel: Array.from(pixel), triangles: renderer.info.render.triangles });
          }
          return result;
        };
        repaint();
      });
    } finally {
      clearTimeout(timeout);
      renderer.render = original;
    }
  }
  const survivor = hosted ? globalThis.cityLayer : globalThis.cityMap;
  const repaint = hosted ? () => mlMap.triggerRepaint() : () => survivor.requestRender();
  const tiles = './tiles/beijing-cbd-grow-9/tileset.json';
  let first, container;
  if (hosted) {
    first = createMapLibreLayer({ id: 'lifetime-probe', tiles, style: 'light' });
    mlMap.addLayer(first);
    await first.ready();
  } else {
    container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:-400px;width:320px;height:240px';
    document.body.append(container);
    first = await createCityMap({ container, tiles, zoom: 16.5, pitch: 60, center: [116.4605, 39.9095] });
  }
  await Promise.all([first.whenIdle({ timeoutMs: 60000 }), survivor.whenIdle({ timeoutMs: 60000 })]);
  const a = first.renderer,
    b = survivor.renderer;
  const firstFrame = await frame(a, hosted ? repaint : () => first.requestRender());
  const secondFrame = await frame(b, repaint);
  const lut = firstFrame.lut;
  const counts = (r) => ({ ...r.info.memory, programs: r.info.programs.length });
  const before = {
    name: lut.name,
    dimensions: [lut.image.width, lut.image.height],
    sameTexture: lut === secondFrame.lut,
    sameContext: a.getContext() === b.getContext(),
    listeners: lut._listeners.dispose.length,
    first: counts(a),
    second: counts(b),
    secondPixel: secondFrame.pixel,
  };
  // Only weak references to the first renderer and GL wrapper cross the boundary to the separate GC/evaluation task.
  globalThis.dfgProbe = { renderer: new WeakRef(a), gl: new WeakRef(a.getContext()), lut };
  if (hosted) mlMap.removeLayer(first.id);
  else await first.dispose();
  container?.remove();
  const next = await frame(b, repaint);
  const after = {
    first: counts(a),
    second: counts(b),
    listeners: lut._listeners.dispose.length,
    firstContextLost: a.getContext().isContextLost(),
    secondContextLost: b.getContext().isContextLost(),
    secondPixel: next.pixel,
    secondTriangles: next.triangles,
  };
  return { before, after };
}

const report = {};
for (const hosted of [false, true]) {
  const page = await openPage(
    dist,
    hosted ? 'maplibre.html?preserve=1' : 'index.html?tiles=./tiles/beijing-cbd-grow-9/tileset.json',
    { width: 640, height: 480 },
  );
  try {
    await page.waitFor(
      hosted
        ? 'globalThis.cityLayer?.renderer && mlMap.isStyleLoaded()'
        : '!!globalThis.cityMap && !!globalThis.createCityMap',
    );
    const observed = await page.evaluate('(' + probe.toString() + ')(' + hosted + ')');
    await page.send('HeapProfiler.collectGarbage');
    const gc = await page.evaluate(
      '({rendererAlive:!!dfgProbe.renderer.deref(),contextWrapperAlive:!!dfgProbe.gl.deref(),listeners:dfgProbe.lut._listeners.dispose.length})',
    );
    const { before, after } = observed;
    assert.ok(before.sameTexture);
    assert.equal(before.sameContext, hosted);
    assert.equal(after.first.geometries, 0);
    assert.equal(after.first.programs, 0);
    assert.equal(after.firstContextLost, !hosted);
    assert.ok(!after.secondContextLost && after.secondTriangles > 0);
    report[hosted ? 'mapLibre' : 'standalone'] = {
      browser: page.version.product,
      ...observed,
      afterRequestedGC: gc,
      strictZero: after.first.textures === 0,
    };
  } finally {
    await page.close();
  }
}
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], json);
process.stdout.write(json);
