// Exercise the release directory with the documented static server and Chrome's loopback-only CDP harness.
// Run after npm run demo:tiles && npm run build:demo. Any subset of the catalog can be checked.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve-static.mjs';
import { openPage } from './benchmark-tiles/browser.mjs';

const dist = fileURLToPath(new URL('../apps/demo/dist/', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(dist, 'tiles/catalog.json'), 'utf8'));
assert.ok(catalog.length, 'Build at least one demo sample');
const root = await mkdtemp(path.join(os.tmpdir(), 'city-demo-smoke-'));
let server, page;
try {
  await cp(dist, path.join(root, 'nested', 'demo'), { recursive: true });
  server = await createStaticServer(root);
  const start = server.url + '/nested/demo/';
  page = await openPage(root, start, { width: 800, height: 520 });
  await page.waitFor('!!window.cityMap');
  const options = await page.evaluate('[...document.querySelector("#city").options].map(o => o.textContent)');
  assert.deepEqual(
    options,
    catalog.map((s) => s.label),
  );
  const cities = [];
  for (const sample of catalog) {
    const tiles = './tiles/' + sample.name + '/tileset.json';
    if (cities.length) {
      await page.evaluate(
        `document.querySelector('#city').value = ${JSON.stringify(tiles)}; document.querySelector('#city').dispatchEvent(new Event('change'))`,
      );
      await page.waitFor(
        `new URLSearchParams(location.search).get('tiles') === ${JSON.stringify(tiles)} && !!window.cityMap`,
      );
    }
    await page.evaluate('cityMap.whenIdle({ timeoutMs: 90000 })');
    const { center, visible, marker, attribution, source } = await page.evaluate(`(() => {
      const marker = document.querySelector('.marker').getBoundingClientRect();
      return { center: cityMap.getCenter(), visible: cityMap.getStats().tiles.visible,
        marker: marker.width > 0 && marker.left < innerWidth && marker.right > 0 && marker.top < innerHeight && marker.bottom > 0,
        attribution: document.body.textContent.includes('© OpenStreetMap contributors'),
        source: document.getElementById('source').textContent };
    })()`);
    const manifest = JSON.parse(await readFile(path.join(dist, tiles), 'utf8'));
    assert.ok(center.every((n, i) => Math.abs(n - manifest.center[i]) < 1e-8));
    assert.ok(visible > 0 && marker && attribution, JSON.stringify({ sample, visible, marker, attribution }));
    assert.ok(source.includes(sample.retrievedAt.slice(0, 10)) && source.includes(sample.license));
    cities.push({ name: sample.name, visible });
  }

  await page.evaluate(`document.querySelector('#style').value = 'dark'; document.querySelector('#style').dispatchEvent(new Event('change'));
    document.querySelector('#observed').click();`);
  await page.waitFor(
    "cityMap.getStats({raw:true}).raw.style === 'dark' && cityMap.getStats({raw:true}).raw.filter.buildings.minHeightProvenance === 'observed'",
  );
  await page.evaluate("document.querySelector('#observed').click(); cityMap.jumpTo({ pitch: 0, zoom: 17 })");
  await page.evaluate('cityMap.whenIdle({ timeoutMs: 90000 })');
  const point = await page.evaluate(`(() => {
    for (let y = 110; y < innerHeight - 45; y += 16) for (let x = 45; x < innerWidth - 220; x += 16) {
      if (document.elementFromPoint(x,y)?.tagName !== 'CANVAS') continue;
      const f = cityMap.queryFeatures({x,y});
      if (f?.layer === 'building') return {x, y, id: f.id};
    }
    return null;
  })()`);
  assert.ok(point, 'Expected a visible building to click');
  for (const type of ['mousePressed', 'mouseReleased'])
    await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await page.waitFor('!document.querySelector("#info").hidden');
  assert.equal(await page.evaluate('JSON.parse(document.querySelector("#info").textContent).id'), point.id);
  const maplibre = await page.evaluate('document.querySelector("#maplibre").href');
  await page.evaluate('document.querySelector("#overlays").click()');
  await page.waitFor('location.pathname.endsWith("overlays.html") && !!window.cityMap');
  await page.evaluate('cityMap.whenIdle({ timeoutMs: 90000 })');
  assert.ok(await page.evaluate('document.querySelector(".pin") && cityMap.getStats().tiles.visible > 0'));
  await page.send('Page.navigate', { url: maplibre });
  await page.waitFor('window.cityLayer && window.mlMap?.loaded() && !!mlMap.getLayer("city3d")');
  await page.evaluate('cityLayer.ready().then(() => cityLayer.whenIdle({timeoutMs:90000}))');
  const hosted = await page.evaluate('cityLayer.getStats().tiles.visible');
  assert.ok(hosted > 0);
  assert.ok(
    await page.evaluate(
      'mlMap.isSourceLoaded("buildings") && document.body.textContent.includes("OpenStreetMap contributors")',
    ),
  );
  const errors = page.events.filter((event) => event.level === 'error');
  assert.deepEqual(errors, []);
  const external = page.network.filter(
    (entry) => /^https?:/.test(entry.url) && new URL(entry.url).origin !== server.url,
  );
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify({
      browser: page.version.product,
      cities,
      picked: point.id,
      maplibreTiles: hosted,
      externalRequests: external.length,
      errors: errors.length,
    }),
  );
} catch (error) {
  console.error(page?.events.slice(-10));
  throw error;
} finally {
  await page?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
