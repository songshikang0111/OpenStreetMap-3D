// Exercise AC608 at the same camera with directory and archive delivery, in a real browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveTiles } from '@city-ink/builder';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = path.join(root, 'apps/demo/dist');
const temp = await mkdtemp(path.join(os.tmpdir(), 'city-archive-browser-'));
const sample = './tiles/beijing-cbd-grow-9/tileset.json';
let server, page;
try {
  const target = path.join(temp, 'sample.archive');
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(root, 'bin/city.js'),
        'tiles',
        'pack',
        path.join(dist, path.dirname(sample)),
        '--output',
        target,
        '--json',
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(result.status, 'succeeded');
  server = await serveTiles(temp, { port: 0 });
  page = await openPage(dist, 'index.html?tiles=' + encodeURIComponent(sample));
  await page.waitFor('!!window.cityMap');
  const snapshot = async () =>
    page.evaluate(`(async()=>{
    await cityMap.whenIdle({timeoutMs:90000});
    return {visible:cityMap.getStats({raw:true}).raw.tiles.filter(t=>t.visible).map(t=>t.key).sort(),
      osmCredit:document.body.textContent.includes('© OpenStreetMap contributors')};
  })()`);
  const fromDirectory = await snapshot();
  assert.ok(fromDirectory.visible.length && fromDirectory.osmCredit);
  const archiveURL = server.url + '/sample.archive?version=1';
  const url = new URL('index.html', page.url);
  url.searchParams.set('tiles', archiveURL);
  await page.send('Page.navigate', { url: url.href });
  await page.waitFor(`!!window.cityMap && location.href===${JSON.stringify(url.href)}`);
  assert.deepEqual(await snapshot(), fromDirectory);
  const ranges = page.network.filter((e) => e.url === archiveURL).length;
  assert.ok(ranges >= fromDirectory.visible.length + 4);
  assert.deepEqual(
    page.events.filter((e) => e.level === 'error'),
    [],
  );
  console.log(
    JSON.stringify({
      browser: page.version.product,
      visibleTiles: fromDirectory.visible.length,
      archiveRequests: ranges,
      sameCoverage: true,
      osmCredit: true,
    }),
  );
} finally {
  await page?.close();
  await server?.close();
  await rm(temp, { recursive: true, force: true });
}
