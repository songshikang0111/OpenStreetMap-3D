// AC206/308. Compare the shipped browser Worker with the Node implementation on the same real tile bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';
import { handleRequest } from '../../packages/map/dist/worker-core.js';

const dist = process.env.CITY_DEMO_DIST ?? fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url));
const samples = process.argv.slice(2);
if (!samples.length) samples.push('beijing-cbd-grow-9', 'kyoto-gion-grow-9');
const workerFile = (await readdir(path.join(dist, 'assets'))).find((name) => /^worker-.*\.js$/.test(name));
assert.ok(workerFile, 'Build the demo before running this check');
const page = await openPage(dist, 'benchmark.html');
try {
  await page.evaluate(`window.parityWorker = new Worker('assets/'+${JSON.stringify(workerFile)},{type:'module'});`);
  let tiles = 0,
    vertices = 0;
  for (const sample of samples) {
    const dir = path.join(dist, 'tiles', sample);
    const report = JSON.parse(await readFile(path.join(dir, 'report.json')));
    const opts = { inferRoofs: Boolean(report.options.inferRoofs), seed: report.options.seed };
    for (const key of Object.keys(report.hashes).filter((key) => key.endsWith('.c3t'))) {
      const buf = await readFile(path.join(dir, key));
      const { response } = handleRequest({
        type: 'generate',
        job: 1,
        buffer: Uint8Array.from(buf).buffer,
        options: opts,
      });
      assert.equal(response.type, 'result');
      const expected = [];
      const hash = (array) =>
        createHash('sha256')
          .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
          .digest('hex');
      for (const b of response.generated.batches)
        expected.push([b.layer, b.vertexCount, hash(b.position), hash(b.index)]);
      expected.push([
        'trees',
        response.generated.trees.count,
        hash(response.generated.trees.data),
        hash(response.generated.trees.renderId),
      ]);
      const observed = await page.evaluate(`(async()=>{
        const buffer=await (await fetch(${JSON.stringify('tiles/' + sample + '/' + key)})).arrayBuffer();
        const w=window.parityWorker;
        const result=await new Promise((resolve,reject)=>{w.onmessage=(e)=>resolve(e.data);w.onerror=(e)=>reject(Error(e.message));w.postMessage({type:'generate',job:1,options:${JSON.stringify(opts)},buffer},[buffer])});
        if(result.type!=='result') throw Error(JSON.stringify(result.diagnostic));
        const hash=async (array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',array)),v=>v.toString(16).padStart(2,'0')).join('');
        const rows=[];
        for(const b of result.generated.batches) rows.push([b.layer,b.vertexCount,await hash(b.position),await hash(b.index)]);
        const t=result.generated.trees;
        rows.push(['trees',t.count,await hash(t.data),await hash(t.renderId)]);
        return rows;
      })()`);
      assert.deepEqual(observed, expected, sample + '/' + key);
      tiles++;
      vertices += response.generated.stats.vertices;
    }
  }
  console.log(
    JSON.stringify({
      browser: page.version.product,
      node: process.version,
      samples,
      tiles,
      vertices,
      positionAndIndexBytes: 'identical',
      treeInstanceBytes: 'identical',
    }),
  );
} finally {
  await page.close();
}
