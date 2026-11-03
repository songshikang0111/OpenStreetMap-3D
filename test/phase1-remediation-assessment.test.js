import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessCase,assessStationary,requestCounts,STATIONARY_VIEWS} from '../scripts/benchmark-integration/assessment.mjs';
const historical=async name=>JSON.parse(await readFile(new URL(`../docs/phase1-evidence/integration/performance/${name}.json`,import.meta.url),'utf8'));

test('new acceptance rejects historical triangle overflow despite its successful old frame-rate gates',async()=>{
  const raw=await historical('beijing-cbd-grow-4');
  assert.ok(Object.values(raw.checks).every(Boolean));
  const assessed=assessCase(raw);
  assert.equal(assessed.checks.p95,true);assert.equal(assessed.checks.drawingTriangles,false);assert.equal(assessed.status,'fail');
});

test('stationary evidence requires a complete real-time window and both saved camera identities',async()=>{
  // Deliberately constructed integrity units, not browser or GPU measurements.
  const raw=await historical('beijing-cbd-grow-1'),stats=structuredClone(raw.path.stats);
  const frames=Array.from({length:1500},(_,i)=>({time:10+i*10,intervalMs:10,triangles:100,drawCalls:2}));
  Object.assign(stats,{paused:false,disposed:false,diagnostics:[]});
  Object.assign(stats.rendering,{frames,frameCount:1501,windowFrames:1500});
  const phase={...STATIONARY_VIEWS[0],timeOrigin:100000,measurementEpochMs:100000,endedEpochMs:115000,durationSeconds:15,baseline:structuredClone(stats),stats,samples:Array.from({length:151},(_,i)=>({second:i/10,runtime:stats.runtime})),measuredRequests:[]};
  assert.ok(Object.values(assessStationary(phase).checks).every(Boolean));
  const truncated=structuredClone(phase);truncated.stats.rendering.frames=frames.slice(0,2);truncated.stats.rendering.frameCount=3;truncated.stats.rendering.windowFrames=2;
  assert.equal(assessStationary(truncated).checks.frames,false);
  const sparse={...phase,samples:[phase.samples[0],phase.samples.at(-1)]};
  assert.equal(assessStationary(sparse).checks.continuousSamples,false);
  const paused=structuredClone(phase);paused.stats.paused=true;
  assert.equal(assessStationary(paused).checks.running,false);
  const raised=structuredClone(phase);raised.stats.budget.visibleTriangles=900000;raised.stats.budget.drawCalls=1500;raised.stats.rendering.frames.forEach(frame=>{frame.triangles=700000;frame.drawCalls=1300;});
  const raisedChecks=assessStationary(raised).checks;assert.equal(raisedChecks.defaultBudget,false);assert.equal(raisedChecks.drawingTriangles,false);assert.equal(raisedChecks.drawingCalls,false);
  const raisedBaseline=structuredClone(phase);raisedBaseline.baseline.budget.visibleTriangles=900000;assert.equal(assessStationary(raisedBaseline).checks.defaultBudget,false);
  assert.equal(assessCase({...raw,stationary:[phase,structuredClone(phase)]}).checks.stationary,false);
  const wrongCamera={...phase,...STATIONARY_VIEWS[1],view:phase.view};
  assert.equal(assessStationary(wrongCamera).checks.camera,false);
  assert.equal(assessCase({...raw,stationary:[phase,{...phase,...STATIONARY_VIEWS[1]}]}).checks.stationary,true);
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
