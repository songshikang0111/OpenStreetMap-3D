// Run after npm run demo:tiles && npm run build:demo. Reads public exports through the standalone map.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const page = await openPage(fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url)), 'index.html');
try {
  await page.waitFor('!!globalThis.cityMap');
  const result = await page.evaluate(`(async () => {
    const map = cityMap;
    await map.whenIdle({timeoutMs: 60000});
    const before = map.getStats();
    const png = await map.exportPNG();
    const bitmap = await createImageBitmap(png.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set();
    let footerInk = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const p = (y * canvas.width + x) * 4;
      if (y < canvas.height - 36) {
        if (!(x % 5 || y % 5) && data[p + 3]) colors.add((data[p]<<16) | (data[p+1]<<8) | data[p+2]);
      } else if (y > canvas.height - 22 && data[p] < 120 && data[p+1] < 120 && data[p+2] < 120) footerInk++;
    }
    const glb = await map.exportGLB({scope:'loaded'});
    const header = new DataView(await glb.blob.slice(0, 20).arrayBuffer());
    const doc = JSON.parse(await glb.blob.slice(20, 20 + header.getUint32(12,true)).text());
    let capped = false;
    try { await map.exportGLB({scope:'loaded', maxBytes: 128}); } catch (e) { capped = /limit/.test(e.message); }
    const framebuffer = document.querySelector('#map canvas') || document.querySelector('canvas');
    const after = map.getStats();
    return {png: {type: png.blob.type, width:png.width, height:png.height, sourceSize:[framebuffer.width,framebuffer.height], colors:colors.size, footerInk, attribution:png.attribution},
      glb: {type:glb.blob.type, bytes:glb.blob.size, declared:header.getUint32(8,true), magic:header.getUint32(0,true),
        version:header.getUint32(4,true), visible:before.tiles.visible, ids:glb.tileIds.sort(), roots:doc.scenes[0].nodes.map(i=>doc.nodes[i].name).sort(),
        meshes:doc.meshes.length, scope:doc.extras.scope, attribution:doc.extras.attribution, capped},
      requestsBefore:before.requests.started, requestsAfter:after.requests.started};
  })()`);
  const { png, glb } = result;
  assert.equal(png.type, 'image/png');
  assert.deepEqual([png.width, png.height], png.sourceSize);
  assert.ok(png.colors > 32 && png.footerInk > 100, 'Expected visible scene and attribution glyphs');
  assert.match(png.attribution.text, /OpenStreetMap/);
  assert.ok(png.attribution.url && png.attribution.license);
  assert.equal(glb.magic, 0x46546c67);
  assert.equal(glb.version, 2);
  assert.equal(glb.declared, glb.bytes);
  assert.equal(glb.type, 'model/gltf-binary');
  assert.equal(glb.scope, 'loaded');
  assert.deepEqual(glb.attribution, png.attribution);
  assert.deepEqual(glb.roots, glb.ids);
  assert.equal(glb.ids.length, glb.visible);
  assert.ok(glb.meshes > 0 && glb.capped);
  assert.equal(result.requestsBefore, result.requestsAfter);
  const json = JSON.stringify({ browser: page.version.product, ...result }, null, 2);
  const out = process.argv.indexOf('--json');
  if (out !== -1) await writeFile(process.argv[out + 1], json + '\n');
  console.log(json);
} finally {
  await page.close();
}
