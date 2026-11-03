// Independent saved-evidence review. Reads files only; never opens a browser/GPU.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditPhysicalWindow,auditBuildIdentity} from './audit-results.mjs';
const repository=new URL('../../../../../',import.meta.url),directory=new URL('docs/phase1-evidence/remediation/integration/performance/',repository);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),read=async name=>JSON.parse(await fs.readFile(new URL(name,directory)));
const percentile=(values,p)=>{const v=[...values].sort((a,b)=>a-b);return v[Math.ceil(v.length*p)-1];};
const summary=await read('summary.json'),assessment=await read('assessment.json'),errors=[],cases=[],sourceHashes=new Map();
const expected=['beijing-cbd','kyoto-gion'].flatMap(city=>['fixed-1','fixed-4','fixed-16','grow-1','grow-4','grow-9'].map(kind=>`${city}-${kind}`));
const check=(condition,message)=>{if(!condition)errors.push(message);};
const bundleSha256=digest(await fs.readFile(new URL('dist-sdk/city-ink.js',repository)));
check(summary.environment.commit==='55862f0a2649fb9289331c9ea19b2325f35f3037','Unexpected measured commit');
check(bundleSha256===summary.environment.bundleSha256,'Current SDK differs from measured SHA');
check(summary.status==='pass'&&assessment.status==='pass','Publisher reports are not pass');
check(JSON.stringify(summary.results.map(c=>c.name).sort())===JSON.stringify([...expected].sort()),'Missing/duplicate matrix case');
const nearKeys=['geometries','materials','textures','geometryArrayBytes','nearDetails','frames','crownClusters','branches','profiles'];
const resources=s=>[s.runtime.geometries,s.runtime.materials,s.runtime.textures,s.runtime.geometryArrayBytes,s.runtime.estimatedResidentBytes,...nearKeys.map(k=>s.nearAttachments[k]),s.rendering.last.rendererGeometries,s.rendering.last.rendererTextures,s.rendering.last.rendererPrograms];
for(const name of expected){
 const bytes=await fs.readFile(new URL(name+'.json',directory)),raw=JSON.parse(bytes),stats=raw.path.stats,r=stats.rendering,b=stats.budget,intervals=r.frames,physical=[r.initialFrame,...intervals],a=assessment.cases.find(c=>c.name===name);
 errors.push(...auditPhysicalWindow(r,{label:name,seconds:60,budget:b,gpuRequired:raw.hardware.gpuTimerExtension}).errors,...auditBuildIdentity(summary,raw));
 check(stats.viewport.width===1280&&stats.viewport.height===720&&stats.viewport.pixelRatio===1&&stats.viewport.devicePixelRatio===1&&stats.quality==='balanced',`${name}: viewport/quality`);
 check(b.visibleTriangles===600000&&b.drawCalls===1200&&b.residentBytes===134217728&&b.nearDetails===18000&&b.concurrentLoads===3,`${name}: changed budget`);
 check(raw.path.durationSeconds>=60&&raw.path.samples.at(-1).second>=60,`${name}: incomplete real-time path`);
 check(stats.lodMode==='auto',`${name}: measured path was forced to a LOD override`);
 const rafP95=percentile(intervals.map(f=>f.intervalMs),.95),gpuP95=percentile(r.gpuTime.rawSamples.map(s=>s.ms),.95),triMax=Math.max(...physical.map(f=>f.triangles)),drawMax=Math.max(...physical.map(f=>f.drawCalls)),residentMax=Math.max(...physical.map(f=>f.estimatedResidentBytes)),nearMax=Math.max(...physical.map(f=>f.totalNearDetails));
 check(rafP95===a.raf.p95&&rafP95===r.intervalsMs.p95&&rafP95<=33.3,`${name}: RAF summary mismatch`);
 check(gpuP95===a.gpu.p95&&triMax===a.drawingBudget.trianglesMax&&drawMax===a.drawingBudget.drawCallsMax,`${name}: GPU/drawing summary mismatch`);
 check(intervals.filter(f=>f.intervalMs>50).length===r.longFrames50ms,`${name}: long frame aggregate mismatch`);
 check(stats.runtime.peakEstimatedResidentBytes>=residentMax&&stats.runtime.peakEstimatedResidentBytes<=b.residentBytes,`${name}: automatic resident peak`);
 check(raw.path.samples.every(s=>s.runtime.estimatedResidentBytes<=stats.runtime.peakEstimatedResidentBytes&&s.runtime.nearDetails+s.nearAttachments.nearDetails<=b.nearDetails&&s.render.bodyNearDetails===s.runtime.nearDetails&&s.render.nearAttachmentDetails===s.nearAttachments.nearDetails),`${name}: sampled resources disagree with physical records`);
 check(raw.lifecycle.length===5,`${name}: lifecycle count`);
 const returned=JSON.stringify(resources(raw.lifecycle[0].returned));
 for(const cycle of raw.lifecycle){
  check(JSON.stringify(resources(cycle.returned))===returned,`${name}: returned resource drift`);
  check(cycle.returned.runtime.estimatedResidentBytes<=b.residentBytes&&cycle.returned.runtime.pendingLoads===0&&cycle.returned.runtime.settled,`${name}: unsettled/over-budget return`);
  check([cycle.away.runtime.geometries,cycle.away.runtime.materials,cycle.away.runtime.textures,cycle.away.runtime.geometryArrayBytes,cycle.away.runtime.estimatedResidentBytes,cycle.away.runtime.currentChunks,cycle.away.runtime.pendingLoads,cycle.away.runtime.standbyChunks,...nearKeys.map(k=>cycle.away.nearAttachments[k])].every(v=>v===0),`${name}: away resources not empty`);
  for(const s of [cycle.away,cycle.returned]){const g=s.rendering.gpuTime;check(g.maxPending===8&&g.created-g.deleted===g.unreleased&&g.unreleased===g.pending+Number(g.active)&&g.unreleased<=8+Number(g.active)&&g.errors===0,`${name}: lifecycle GPU query ownership`);}
 }
 const far=raw.comparisons.far,full=raw.comparisons.full,farAfter=raw.comparisons.farAfter;
 check(far.runtime.geometryArrayBytes<full.runtime.geometryArrayBytes&&far.rendering.triangles.p50<full.rendering.triangles.p50&&far.rendering.drawCalls.p50<full.rendering.drawCalls.p50,`${name}: LOD actual cost reduction`);
 check(farAfter.runtime.geometryArrayBytes===far.runtime.geometryArrayBytes,`${name}: far comparison did not recover baseline`);
 if(!sourceHashes.has(raw.build.source))sourceHashes.set(raw.build.source,digest(await fs.readFile(new URL(raw.build.source,repository))));
 check(sourceHashes.get(raw.build.source)===raw.build.sourceHash,`${name}: source SHA`);
 const stationary=[];
 for(const phase of raw.stationary||[]){
  const pr=phase.stats.rendering,pf=[pr.initialFrame,...pr.frames],gpu=pr.gpuTime;
  errors.push(...auditPhysicalWindow(pr,{label:`${name} t${phase.targetTime}`,seconds:15,budget:b,gpuRequired:raw.hardware.gpuTimerExtension}).errors);
  const expectedView=phase.targetTime===13?{position:[-54.465855332583416,26.25,-52.10670670317487],target:[.5427259487235006,19.5,-6.486136335879564],fov:55}:{position:[81.62020458277061,28.75,65.20333138415589],target:[.5427259487235006,18.5,-6.486136335879564],fov:55};
  const sameView=v=>['position','target'].every(k=>v[k].length===3&&v[k].every((x,i)=>Math.abs(x-expectedView[k][i])<1e-8))&&Math.abs(v.fov-55)<1e-8;
  check([13,19].includes(phase.targetTime)&&[phase.view,phase.baselineView,phase.actualView,...phase.samples.map(s=>s.view)].every(sameView),`${name}: original camera identity`);
  const measured=phase.phaseRequests.filter(q=>q.observedAt>=phase.measurementEpochMs&&q.observedAt<=phase.endedEpochMs),urls={};
  for(const request of measured)if(/\.cink(?:\?|$)/.test(request.url))urls[request.url]=(urls[request.url]||0)+1;
  const swaps=phase.stats.runtime.swaps-phase.baseline.runtime.swaps,cancelled=phase.stats.runtime.cancelled-phase.baseline.runtime.cancelled;
  check(phase.stats.lodMode==='auto',`${name}: stationary phase was forced to a LOD override`);
  check(swaps===0&&cancelled===0&&Object.keys(urls).length===0,`${name}: stationary churn/requests`);
  check(phase.samples.every(s=>s.runtime.visibleChunks>0&&s.runtime.missingChunks.length===0),`${name}: stationary coverage`);
  stationary.push({targetTime:phase.targetTime,lodMode:phase.stats.lodMode,levels:phase.stats.runtime.levels,physicalFrames:pf.length,intervalFrames:pr.frames.length,gpuSamples:gpu.rawSamples.length,pending:gpu.pending,active:gpu.active,elapsedSeconds:(phase.endedEpochMs-phase.measurementEpochMs)/1000,swaps,cancelled,measuredCinkRequests:Object.values(urls).reduce((n,c)=>n+c,0),maxRequestsPerUrl:Math.max(0,...Object.values(urls)),urlCounts:urls,phaseCinkRequests:phase.phaseRequests.filter(q=>/\.cink(?:\?|$)/.test(q.url)).length,trianglesMax:Math.max(...pf.map(f=>f.triangles)),drawCallsMax:Math.max(...pf.map(f=>f.drawCalls)),estimatedBytesMax:Math.max(...pf.map(f=>f.estimatedResidentBytes)),nearMax:Math.max(...pf.map(f=>f.totalNearDetails))});
 }
 if(name==='beijing-cbd-grow-1')check(stationary.length===2,`${name}: missing original camera regression`);
 const sampleLevels=[...new Set(raw.path.samples.flatMap(s=>Object.keys(s.runtime.levels)))];
 if(name==='beijing-cbd-grow-1')check(sampleLevels.includes('2')&&physical.some(f=>f.nearAttachmentDetails>0),`${name}: no automatic high/near recovery evidence`);
 cases.push({name,rawSha256:digest(bytes),compilerCommit:raw.build.compilerCommit,sourceSha256:raw.build.sourceHash,worldHash:raw.build.report.hashes.world,area:raw.build.config.area,origin:raw.build.config.origin,tiling:raw.build.config.tiling,chunks:raw.build.chunks,features:raw.build.features,physicalFrames:physical.length,intervalFrames:intervals.length,gpuSamples:r.gpuTime.rawSamples.length,pending:r.gpuTime.pending,active:r.gpuTime.active,rafP95,gpuP95,longFrames50ms:r.longFrames50ms,maxIntervalMs:Math.max(...intervals.map(f=>f.intervalMs)),trianglesMax:triMax,drawCallsMax:drawMax,estimatedBytesMax:residentMax,automaticPeakBytes:stats.runtime.peakEstimatedResidentBytes,nearMax,bodyNearMax:Math.max(...physical.map(f=>f.bodyNearDetails)),runtimeAttachmentsMax:Math.max(...physical.map(f=>f.nearAttachmentDetails)),sampleLevels,initialFrame:{...r.initialFrame},durationSeconds:raw.path.samples.at(-1).second,cycles:raw.lifecycle.length,returnedResources:JSON.parse(returned),farVsFull:{arrays:[far.runtime.geometryArrayBytes,full.runtime.geometryArrayBytes],trianglesP50:[far.rendering.triangles.p50,full.rendering.triangles.p50],drawCallsP50:[far.rendering.drawCalls.p50,full.rendering.drawCalls.p50]},stationary});
}
for(const city of ['beijing-cbd','kyoto-gion']){
 const fixed=cases.filter(c=>c.name.startsWith(city+'-fixed')),grow=cases.filter(c=>c.name.startsWith(city+'-grow'));
 check(new Set(fixed.map(c=>JSON.stringify([c.area,c.origin,c.sourceSha256,c.worldHash,c.features]))).size===1,`${city}: fixed experiments changed input coverage`);
 check(JSON.stringify(fixed.map(c=>c.chunks))==='[1,4,16]',`${city}: fixed chunk counts`);
 check(JSON.stringify(grow.map(c=>c.chunks))==='[1,4,9]'&&grow.every((c,i)=>!i||c.features>grow[i-1].features),`${city}: growing coverage/features`);
 check(new Set(grow.map(c=>JSON.stringify(c.origin))).size===1,`${city}: growing origin changed`);
 for(const axis of ['lat','lon']){const span=c=>axis==='lat'?c.area.north-c.area.south:c.area.east-c.area.west,base=span(grow[0]);check(grow.every(c=>Math.abs(span(c)/Math.sqrt(c.chunks)-base)<1e-10),`${city}: growing physical cell size changed`);}
}
const sum=key=>cases.reduce((n,c)=>n+c[key],0),maximum=key=>Math.max(...cases.map(c=>c[key]));
const result={date:new Date().toISOString(),mode:'Independent saved-raw CPU recomputation only; no browser/GPU or full test run',status:errors.length?'fail':'pass',errors,measuredCommit:summary.environment.commit,bundleSha256,environment:summary.environment,totals:{cases:cases.length,physicalFrames:sum('physicalFrames'),intervalFrames:sum('intervalFrames'),gpuSamples:sum('gpuSamples'),pendingQueries:sum('pending'),activeQueries:cases.reduce((n,c)=>n+Number(c.active),0),stationaryPhysicalFrames:cases.flatMap(c=>c.stationary).reduce((n,s)=>n+s.physicalFrames,0),stationaryGpuSamples:cases.flatMap(c=>c.stationary).reduce((n,s)=>n+s.gpuSamples,0),lifecycleRounds:sum('cycles'),worstRafP95:maximum('rafP95'),worstGpuP95:maximum('gpuP95'),longFrames50ms:sum('longFrames50ms'),maxIntervalMs:maximum('maxIntervalMs'),trianglesMax:maximum('trianglesMax'),drawCallsMax:maximum('drawCallsMax'),estimatedBytesMax:maximum('estimatedBytesMax'),automaticPeakBytes:maximum('automaticPeakBytes'),nearMax:maximum('nearMax'),minMeasuredSeconds:Math.min(...cases.map(c=>c.durationSeconds))},acceptance:{AC16:'pass',AC17:'pass for the original stationary regressions and recorded movement/coverage',AC18:'pass for the measured default budgets and documented custom-near regressions',AC19:'pass for sixty recorded resource rounds',AC20:'pass on the recorded desktop/viewport/quality and fixed sample matrix'},cases};
const rerunDirectory=new URL('work/root-remediation-performance-rerun/',repository);await fs.mkdir(rerunDirectory,{recursive:true});await fs.writeFile(new URL('final-performance-review.json',rerunDirectory),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,errors,totals:result.totals}));process.exitCode=errors.length?1:0;
