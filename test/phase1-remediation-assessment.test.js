import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessCase,assessStationary,assessResources,requestCounts,STATIONARY_VIEWS} from '../scripts/benchmark-integration/assessment.mjs';
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
  const frames=Array.from({length:1500},(_,i)=>({time:10+i*10,intervalMs:10,triangles:100,drawCalls:2,estimatedResidentBytes:1000,bodyNearDetails:0,nearAttachmentDetails:0,totalNearDetails:0,nearGeometryArrayBytes:0}));
  Object.assign(stats,{paused:false,disposed:false,diagnostics:[]});
  stats.runtime.nearDetails=0;stats.runtime.peakEstimatedResidentBytes=stats.runtime.estimatedResidentBytes=1000;
  Object.assign(stats.rendering,{frames,frameCount:1501,windowFrames:1500});
  const phase={...STATIONARY_VIEWS[0],timeOrigin:100000,measurementEpochMs:100000,endedEpochMs:115000,durationSeconds:15,baseline:structuredClone(stats),stats,samples:Array.from({length:151},(_,i)=>({second:i/10,runtime:stats.runtime})),measuredRequests:[]};
  phase.baselineView=phase.actualView=phase.view;phase.samples.forEach(item=>{item.view=phase.view;item.nearAttachments={nearDetails:0,geometryArrayBytes:0};item.render=frames.at(-1);});phase.phaseRequests=[];
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
  const t19=structuredClone(phase);Object.assign(t19,STATIONARY_VIEWS[1]);t19.baselineView=t19.actualView=t19.view;t19.samples.forEach(item=>item.view=t19.view);
  assert.equal(assessCase({...raw,stationary:[phase,t19]}).checks.stationary,true);
  const drifted=structuredClone(phase);drifted.actualView.position[0]+=10;assert.equal(assessStationary(drifted).checks.camera,false);
  const short=structuredClone(phase);short.endedEpochMs=114910;assert.equal(assessStationary(short).checks.duration,false);
  const hiddenRequests=structuredClone(phase);hiddenRequests.phaseRequests=[{url:'http://localhost/high.cink',observedAt:101000},{url:'http://localhost/high.cink',observedAt:102000}];
  assert.equal(assessStationary(hiddenRequests).checks.requestEvidence,false);assert.equal(assessStationary(hiddenRequests).checks.noRepeatedRequests,false);
  const forged=structuredClone(raw);forged.stationary=[phase,t19];forged.path.stats.rendering.frames=Array.from({length:1500},(_,i)=>({time:40+i*40,intervalMs:40,triangles:100,drawCalls:2}));forged.path.stats.rendering.frameCount=1501;forged.path.stats.rendering.windowFrames=1500;
  assert.equal(assessCase(forged).checks.completeSamples,true);assert.equal(assessCase(forged).checks.p95,false);assert.equal(assessCase(forged).intervals.p95,40);
  const residency=structuredClone(phase);residency.stats.rendering.frames[40].estimatedResidentBytes=128*1024*1024+1;residency.stats.diagnostics=[{code:'TRANSITION_HEADROOM'}];
  assert.equal(assessStationary(residency).checks.resident,false);assert.equal(assessResources(residency.stats,residency.samples).residentFramesOver,1);
  const near=structuredClone(phase);Object.assign(near.stats.rendering.frames[40],{bodyNearDetails:17000,nearAttachmentDetails:1001,totalNearDetails:18001});assert.equal(assessStationary(near).checks.nearDetails,false);
  const peak=structuredClone(phase);peak.stats.runtime.peakEstimatedResidentBytes=128*1024*1024+1;assert.equal(assessStationary(peak).checks.resident,false);
  const impossibleBytes=structuredClone(phase);impossibleBytes.stats.rendering.frames[40].nearGeometryArrayBytes=1001;assert.equal(assessStationary(impossibleBytes).checks.resourceEvidence,false);
  const negative=structuredClone(phase);negative.samples[0].runtime.nearDetails=-1000;negative.samples[0].nearAttachments.nearDetails=19000;assert.equal(assessStationary(negative).checks.resourceEvidence,false);
});
test('whole-frame draw maximum cannot be hidden by a passing p95',async()=>{
  const raw=await historical('kyoto-gion-grow-1'),assessed=assessCase(raw);
  assert.ok(raw.path.stats.rendering.drawCalls.p95<1200);
  assert.equal(assessed.drawing.drawCallFramesOver,10);assert.equal(assessed.drawing.drawCalls.max,2626);
  assert.equal(assessed.checks.drawingCalls,false);assert.equal(assessed.status,'fail');
});
test('stationary gate rejects repeated transitions, cancellation and repeated asset URLs',async()=>{
  const raw=await historical('beijing-cbd-grow-1');
  const requests=raw.networkRequests.map((request,i)=>({...request,observedAt:100000+i}));
  const phase={durationSeconds:15,measurementEpochMs:100000,endedEpochMs:115000,baseline:{runtime:{swaps:0,cancelled:0}},stats:raw.path.stats,samples:raw.path.samples,phaseRequests:requests,measuredRequests:requests};
  const assessed=assessStationary(phase);
  assert.equal(assessed.checks.stableLod,false);assert.equal(assessed.checks.noCancelledRequests,false);assert.equal(assessed.checks.noRepeatedRequests,false);
  assert.ok(assessed.requests.maxPerUrl>10);assert.equal(requestCounts([{url:'http://localhost/a.cink'},{url:'http://localhost/a.cink'},{url:'http://localhost/manifest.json'}]).maxPerUrl,2);
});

test('leaving the scene must also release near instances and cached profiles',async()=>{
  const raw=await historical('beijing-cbd-grow-4');
  assert.equal(assessCase(raw).checks.unloads,true);
  for(const key of ['frames','crownClusters','branches','profiles']){
    const changed=structuredClone(raw);changed.lifecycle[0].away.nearAttachments[key]=7;
    assert.equal(assessCase(changed).checks.unloads,false,key);
  }
});
