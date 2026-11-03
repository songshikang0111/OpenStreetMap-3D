import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {assessCase,assessGpu,assessResources,physicalFrames,STATIONARY_VIEWS} from '../../scripts/benchmark-integration/assessment.mjs';
import {FrameStatistics,distribution} from '../../src/runtime/statistics.js';

const archived=JSON.parse(await fs.readFile('docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json','utf8'));
const nearKeys=['geometries','materials','textures','geometryArrayBytes','nearDetails','frames','crownClusters','branches','profiles'];
const nearZero=()=>Object.fromEntries(nearKeys.map(key=>[key,0]));
const costs={bodyNearDetails:0,nearAttachmentDetails:0,totalNearDetails:0,nearGeometryArrayBytes:0};
const frame=time=>({time,intervalMs:time===0?null:10,triangles:100,drawCalls:2,estimatedResidentBytes:1000,cpuFrameMs:1,...costs});
function gpu(rendering){const rawSamples=physicalFrames(rendering).slice(0,-1).map(item=>({time:item.time,ms:2+(item.time%30)/10}));return {...archived.path.stats.rendering.gpuTime,...distribution(rawSamples.map(item=>item.ms)),available:true,reason:null,measurement:'gpu-elapsed',unit:'ms',samples:rawSamples.length,rawSamples,pending:1,active:false,maxPending:8,unreleased:1,errors:0};}
function stats(seconds){const out=structuredClone(archived.path.stats);Object.assign(out,{paused:false,disposed:false,diagnostics:[]});Object.assign(out.runtime,{nearDetails:0,estimatedResidentBytes:1000,peakEstimatedResidentBytes:1000});out.nearAttachments=nearZero();Object.assign(out.rendering,{initialFrame:frame(0),frames:Array.from({length:seconds*100},(_,i)=>frame((i+1)*10)),frameCount:seconds*100+1,windowFrames:seconds*100,longFrames50ms:0,longFrames33ms:0});out.rendering.last={...out.rendering.last,...out.rendering.frames.at(-1)};out.rendering.gpuTime=gpu(out.rendering);return out;}
function sample(current,second,view){return {second,...(view?{view:structuredClone(view)}:{}),runtime:structuredClone(current.runtime),nearAttachments:nearZero(),render:frame(second*1000)};}
function stationary(expected){const current=stats(15);return {...structuredClone(expected),baselineView:structuredClone(expected.view),actualView:structuredClone(expected.view),timeOrigin:100000,measurementEpochMs:100000,endedEpochMs:115000,durationSeconds:15,baseline:structuredClone(current),stats:current,samples:Array.from({length:151},(_,i)=>sample(current,i/10,expected.view)),phaseRequests:[],measuredRequests:[]};}
const base=structuredClone(archived);base.path.stats=stats(60);base.path.durationSeconds=60;base.path.samples=Array.from({length:61},(_,i)=>sample(base.path.stats,i));base.path.diagnostics=[];base.hardware.gpuTimerExtension=true;base.browserEvents=[];base.stationary=STATIONARY_VIEWS.map(stationary);for(const cycle of base.lifecycle){cycle.away.nearAttachments=nearZero();cycle.returned.nearAttachments=nearZero();}
const positive=assessCase(base);assert.equal(positive.status,'pass');assert.equal(positive.intervals.count,6000);assert.equal(positive.intervals.p95,10);assert.equal(physicalFrames(base.path.stats.rendering).length,6001);
const report={date:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),firstFrameCommit:'743d3e55d51439e7a994203ea23d17d420ec493c',assessmentCommit:'112ae159ad6d5b867d7f3dbe9a48ded2e3c5d23b',windowAssessmentCommit:'a273e6a05182f989966cc3136b1cd6ea7f289889',mode:'Node integrity units. Constructed complete controls use explicit initialFrame; no browser/GPU launched; old archived evidence is read only.',controls:[{name:'complete-case-initial-plus-interval-frames',status:positive.status,physicalFrames:6001,intervalFrames:6000,rafP95:positive.intervals.p95,gpu:positive.gpu}],rejectionProbes:[]};
function reject(name,mutate,expectedCheck){const changed=structuredClone(base);mutate(changed);const assessed=assessCase(changed);const value=expectedCheck?.split('.').reduce((item,key)=>item?.[key],assessed);report.rejectionProbes.push({name,rejected:assessed.status==='fail'&&(!expectedCheck||value===false),status:assessed.status,expectedCheck,actualCheck:value,failedChecks:Object.entries(assessed.checks).filter(([,v])=>!v).map(([k])=>k)});}
for(const scope of ['path','stationary']){
 const get=p=>scope==='path'?p.path:p.stationary[0],prefix=scope==='path'?'checks':'stationary.0.checks';
 reject(scope+'-missing-initial',p=>delete get(p).stats.rendering.initialFrame,prefix+'.'+(scope==='path'?'completeSamples':'frames'));
 reject(scope+'-first-interval-not-null',p=>get(p).stats.rendering.initialFrame.intervalMs=0,prefix+'.'+(scope==='path'?'completeSamples':'frames'));
 reject(scope+'-first-time-gap',p=>get(p).stats.rendering.initialFrame.time=-1,prefix+'.'+(scope==='path'?'completeSamples':'frames'));
 for(const [field,value,check]of [['triangles',600001,'drawingTriangles'],['drawCalls',1201,'drawingCalls'],['estimatedResidentBytes',134217729,'resident'],['nearGeometryArrayBytes',1001,'resourceEvidence']])reject(scope+'-first-'+field,p=>get(p).stats.rendering.initialFrame[field]=value,prefix+'.'+check);
 reject(scope+'-first-near-total',p=>Object.assign(get(p).stats.rendering.initialFrame,{bodyNearDetails:18001,totalNearDetails:18001}),prefix+'.nearDetails');
 reject(scope+'-first-near-total-mismatch',p=>get(p).stats.rendering.initialFrame.totalNearDetails=1,prefix+'.resourceEvidence');
 reject(scope+'-sample-resident-over-limit',p=>{get(p).samples[30].runtime.estimatedResidentBytes=134217729;get(p).samples[30].render.estimatedResidentBytes=134217729;},prefix+'.resident');
 reject(scope+'-sample-resident-over-final-peak',p=>{get(p).samples[30].runtime.estimatedResidentBytes=1001;get(p).samples[30].render.estimatedResidentBytes=1001;},prefix+'.resident');
}
for(const key of ['frames','crownClusters','branches','profiles'])reject('away-'+key,p=>p.lifecycle[2].away.nearAttachments[key]=7,'checks.unloads');
reject('negative-near-component',p=>{const s=p.stationary[0].samples[30];s.runtime.nearDetails=-1000;s.nearAttachments.nearDetails=19000;Object.assign(s.render,{bodyNearDetails:-1000,nearAttachmentDetails:19000,totalNearDetails:18000});},'stationary.0.checks.resourceEvidence');
reject('sample-near-total-mismatch',p=>p.stationary[0].samples[30].render.totalNearDetails=1,'stationary.0.checks.resourceEvidence');
reject('sample-near-bytes-over-total',p=>p.stationary[0].samples[30].nearAttachments.geometryArrayBytes=1001,'stationary.0.checks.resourceEvidence');
reject('missing-sample-render',p=>delete p.stationary[0].samples[30].render,'stationary.0.checks.resourceEvidence');
reject('peak-below-raw-max',p=>p.stationary[0].stats.runtime.peakEstimatedResidentBytes=999,'stationary.0.checks.resident');
reject('end-above-peak',p=>p.stationary[0].stats.runtime.estimatedResidentBytes=1001,'stationary.0.checks.resident');
reject('two-frame-stationary',p=>{const r=p.stationary[0].stats.rendering;r.frames=r.frames.slice(0,2);r.frameCount=3;r.windowFrames=2;},'stationary.0.checks.frames');
reject('duplicate-t13-identity',p=>p.stationary[1]=structuredClone(p.stationary[0]),'checks.stationary');
for(const [name,mutate]of [['baseline-budget',p=>p.stationary[0].baseline.budget.visibleTriangles=900000],['end-budget',p=>p.stationary[0].stats.budget.drawCalls=1500]])reject(name,mutate,'stationary.0.checks.defaultBudget');
for(const key of ['baselineView','actualView'])reject('actual-camera-'+key,p=>p.stationary[0][key].position[0]++,'stationary.0.checks.camera');
reject('actual-camera-mid-sample',p=>p.stationary[0].samples[30].view.position[0]++,'stationary.0.checks.camera');
reject('hidden-repeated-requests',p=>p.stationary[0].phaseRequests=[{url:'http://localhost/high.cink',observedAt:101000},{url:'http://localhost/high.cink',observedAt:102000}],'stationary.0.checks.requestEvidence');
reject('short-epoch',p=>p.stationary[0].endedEpochMs=114910,'stationary.0.checks.duration');
reject('raw-40ms-hidden-by-old-aggregate',p=>{const r=p.path.stats.rendering;r.frames.forEach((f,i)=>{f.time=(i+1)*40;f.intervalMs=40;});r.gpuTime=gpu(r);},'checks.p95');
function gpuReject(name,mutate,check){reject(name,p=>mutate(p.path.stats.rendering.gpuTime,p.path.stats.rendering),'gpu.checks.'+check);}
gpuReject('gpu-missing-raw',g=>delete g.rawSamples,'samples');
gpuReject('gpu-truncated-window',g=>{g.rawSamples=g.rawSamples.slice(0,1);g.samples=1;},'window');
gpuReject('gpu-wrong-sample-count',g=>g.samples--,'samples');
gpuReject('gpu-negative-ms',g=>g.rawSamples[0].ms=-1,'samples');
gpuReject('gpu-nonfinite-ms',g=>g.rawSamples[0].ms=NaN,'samples');
gpuReject('gpu-nonfinite-time',g=>g.rawSamples[0].time=Infinity,'samples');
gpuReject('gpu-duplicate-first-frame',g=>g.rawSamples[1]={...g.rawSamples[0]},'timestamps');
gpuReject('gpu-outside-window',g=>g.rawSamples[0].time=-1000,'timestamps');
gpuReject('gpu-wrong-aggregate',g=>g.p95=.0001,'aggregate');
gpuReject('gpu-negative-pending',g=>g.pending=-1,'window');
gpuReject('gpu-fractional-pending',g=>g.pending=.5,'window');
gpuReject('gpu-pending-over-capacity',g=>g.pending=g.maxPending+1,'window');
gpuReject('gpu-active-not-boolean',g=>g.active=0,'window');
gpuReject('gpu-unreleased-over-bound',g=>g.unreleased=g.maxPending+1,'queries');
gpuReject('gpu-unreleased-below-in-flight',g=>g.unreleased=0,'queries');
for(const pending of [0,8]){const p=structuredClone(base),r=p.path.stats.rendering,g=r.gpuTime;g.rawSamples=physicalFrames(r).slice(0,r.frameCount-pending).map(item=>({time:item.time,ms:3}));g.samples=g.rawSamples.length;g.pending=pending;g.unreleased=pending;Object.assign(g,distribution(g.rawSamples.map(item=>item.ms)));assert.equal(assessCase(p).status,'pass');report.controls.push({name:'gpu-valid-pending-'+pending,status:'pass'});}
const active=structuredClone(base);active.path.stats.rendering.gpuTime.pending=0;active.path.stats.rendering.gpuTime.active=true;assert.equal(assessCase(active).status,'pass');report.controls.push({name:'gpu-valid-active-query',status:'pass'});
const unsupported=structuredClone(base);unsupported.hardware.gpuTimerExtension=false;unsupported.path.stats.rendering.gpuTime={available:false,reason:'Extension unavailable',samples:0,rawSamples:[],p50:null,p95:null,p99:null,max:null};assert.equal(assessCase(unsupported).status,'pass');report.controls.push({name:'unsupported-no-synthetic-ms',status:'pass'});
reject('unsupported-gpu-fake-ms',p=>{p.hardware.gpuTimerExtension=false;p.path.stats.rendering.gpuTime={...unsupported.path.stats.rendering.gpuTime,p95:1};},'checks.gpuTiming');
for(const scope of ['path','stationary']){const p=structuredClone(base),phase=scope==='path'?p.path:p.stationary[0];phase.stats.runtime.estimatedResidentBytes=phase.stats.runtime.peakEstimatedResidentBytes=134217728;for(const f of physicalFrames(phase.stats.rendering))f.estimatedResidentBytes=134217728;for(const s of phase.samples){s.runtime.estimatedResidentBytes=134217728;s.render.estimatedResidentBytes=134217728;}assert.equal(assessCase(p).status,'pass');report.controls.push({name:scope+'-exact-128MiB',status:'pass'});}
const recorder=new FrameStatistics();const renderer={info:{render:{calls:2,triangles:100,lines:0,points:0},memory:{geometries:1,textures:0},programs:[]}};recorder.record(20,renderer,{estimatedResidentBytes:1000,...costs});recorder.record(30,renderer,{estimatedResidentBytes:1000,...costs});let snap=recorder.snapshot(true);assert.equal(snap.initialFrame.time,20);assert.equal(snap.initialFrame.intervalMs,null);assert.equal(snap.frames.length,1);assert.equal(snap.frameCount,2);assert.equal(snap.intervalsMs.p95,10);snap.initialFrame.triangles=999;assert.equal(recorder.snapshot(true).initialFrame.triangles,100);recorder.reset();assert.equal(recorder.snapshot(true).initialFrame,null);report.controls.push({name:'real-FrameStatistics-first-copy-reset-and-FPS-definition',status:'pass'});
const smokeFile=process.env.CITY_INK_REVIEW_SMOKE||'work/remediation-raw-producer-smoke.json';
try {
 const smoke=JSON.parse(await fs.readFile(smokeFile,'utf8')),smokeGpu=assessGpu(smoke.stats.rendering,true),smokeResources=assessResources(smoke.stats,[{runtime:smoke.stats.runtime,nearAttachments:smoke.stats.nearAttachments,render:smoke.stats.rendering.last}]);
 assert(Object.values(smokeGpu.checks).every(Boolean));assert(Object.values(smokeResources.checks).every(Boolean));
 report.actualSmoke={status:'pass',file:smokeFile,note:smoke.note,physicalFrames:physicalFrames(smoke.stats.rendering).length,intervalFrames:smoke.stats.rendering.frames.length,frameCount:smoke.stats.rendering.frameCount,gpu:smokeGpu,resources:smokeResources,formalPerformanceAcceptance:false};
} catch(error) {
 if(error.code!=='ENOENT')throw error;
 report.actualSmoke={status:'not-run',file:smokeFile,reason:'Optional existing smoke evidence unavailable; no browser or GPU launched.',formalPerformanceAcceptance:false};
}
// Default SDK uses eight pending slots. A completeness gate must not let evidence raise this capacity to replace almost every raw sample.
gpuReject('gpu-raised-capacity-hides-almost-all-samples',(g,r)=>{g.rawSamples=g.rawSamples.slice(0,1);g.samples=1;g.pending=r.frameCount-1;g.maxPending=g.pending;g.unreleased=g.pending;Object.assign(g,distribution(g.rawSamples.map(item=>item.ms)));},'window');
report.rejected=report.rejectionProbes.filter(item=>item.rejected).length;report.acceptedInvalid=report.rejectionProbes.filter(item=>!item.rejected);report.status=report.acceptedInvalid.length?'fail':'pass';await fs.writeFile(new URL('./final-window-integrity.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({head:report.head,status:report.status,rejected:report.rejected,total:report.rejectionProbes.length,controls:report.controls.map(({name,status})=>({name,status})),actualSmoke:report.actualSmoke,acceptedInvalid:report.acceptedInvalid},null,2));if(report.status!=='pass')process.exitCode=1;



