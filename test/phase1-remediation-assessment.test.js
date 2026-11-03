import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessCase,assessStationary,requestCounts} from '../scripts/benchmark-integration/assessment.mjs';
const historical=async name=>JSON.parse(await readFile(new URL(`../docs/phase1-evidence/integration/performance/${name}.json`,import.meta.url),'utf8'));

test('new acceptance rejects historical triangle overflow despite its successful old frame-rate gates',async()=>{
  const raw=await historical('beijing-cbd-grow-4');
  assert.ok(Object.values(raw.checks).every(Boolean));
  const assessed=assessCase(raw);
  assert.equal(assessed.checks.p95,true);assert.equal(assessed.checks.drawingTriangles,false);assert.equal(assessed.status,'fail');
});
test('whole-frame draw maximum cannot be hidden by a passing p95',async()=>{
  const raw=await historical('kyoto-gion-grow-1'),assessed=assessCase(raw);
  assert.ok(raw.path.stats.rendering.drawCalls.p95<1200);
  assert.equal(assessed.drawing.drawCallFramesOver,10);assert.equal(assessed.drawing.drawCalls.max,2626);
  assert.equal(assessed.checks.drawingCalls,false);assert.equal(assessed.status,'fail');
});
test('stationary gate rejects repeated transitions, cancellation and repeated asset URLs',async()=>{
  const raw=await historical('beijing-cbd-grow-1');
  const phase={durationSeconds:15,baseline:{runtime:{swaps:0,cancelled:0}},stats:raw.path.stats,samples:raw.path.samples,measuredRequests:raw.networkRequests};
  const assessed=assessStationary(phase);
  assert.equal(assessed.checks.stableLod,false);assert.equal(assessed.checks.noCancelledRequests,false);assert.equal(assessed.checks.noRepeatedRequests,false);
  assert.ok(assessed.requests.maxPerUrl>10);assert.equal(requestCounts([{url:'http://localhost/a.cink'},{url:'http://localhost/a.cink'},{url:'http://localhost/manifest.json'}]).maxPerUrl,2);
});
