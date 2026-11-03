import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const nearest=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;};
const independentDistribution=values=>({count:values.length,p50:nearest(values,.5),p95:nearest(values,.95),p99:nearest(values,.99),max:values.length?Math.max(...values):null});
const integer=value=>Number.isSafeInteger(value)&&value>=0;

// These checks intentionally do not import the publisher's assessment/helpers.
export function auditGpuWindow(rendering,required,label='GPU') {
  const errors=[],check=(condition,message)=>{if(!condition)errors.push(`${label}: ${message}`);};
  const gpu=rendering.gpuTime||{},samples=Array.isArray(gpu.rawSamples)?gpu.rawSamples:[];
  check(typeof required==='boolean','hardware capability must be explicit');
  check(Array.isArray(gpu.rawSamples),'missing GPU raw sample array');
  const pendingCapacity=8; // The production SDK constructs GpuFrameTimer with its fixed default.
  check(gpu.maxPending===pendingCapacity,'query capacity differs from production SDK capacity 8');
  if(required===false){
    check(gpu.available===false&&typeof gpu.reason==='string'&&gpu.reason.length>0,'unavailable timing needs its real reason');
    check(gpu.samples===0&&samples.length===0&&['p50','p95','p99','max'].every(k=>gpu[k]===null),'unavailable timing must have no invented samples');
    return {errors,required:false,samples:samples.length};
  }
  check(gpu.available===true&&gpu.measurement==='gpu-elapsed'&&gpu.unit==='ms','not available hardware GPU elapsed timing');
  check(gpu.errors===0&&gpu.deleteErrors===0&&gpu.invalidResults===0,'GPU timer errors');
  check(samples.length>0&&gpu.samples===samples.length,'sample count mismatch');
  check(samples.every((s,i)=>Number.isFinite(s.time)&&Number.isFinite(s.ms)&&s.ms>=0&&(!i||s.time>samples[i-1].time)),'invalid or repeated/unordered GPU samples');
  const physical=rendering.initialFrame?[rendering.initialFrame,...(rendering.frames||[])]:rendering.frames||[];
  const times=new Set(physical.map(frame=>frame.time));
  check(samples.every(sample=>times.has(sample.time)),'GPU sample outside this physical-frame window');
  check(integer(gpu.pending)&&gpu.pending<=pendingCapacity&&typeof gpu.active==='boolean','invalid in-flight query bound');
  check(samples.length+gpu.pending+Number(gpu.active)===rendering.frameCount,'truncated GPU measurement window');
  check(integer(gpu.created)&&integer(gpu.deleted)&&integer(gpu.unreleased)&&gpu.created-gpu.deleted===gpu.unreleased&&gpu.unreleased===gpu.pending+Number(gpu.active)&&gpu.unreleased<=pendingCapacity+Number(gpu.active),'query ownership is not closed');
  const statistics=independentDistribution(samples.map(s=>s.ms));
  check(['p50','p95','p99','max'].every(key=>Number.isFinite(gpu[key])&&gpu[key]===statistics[key]),'GPU raw aggregate mismatch');
  check(integer(gpu.maxSamples)&&samples.length<=gpu.maxSamples,'GPU sample window was truncated');
  return {errors,required:true,samples:samples.length,pending:gpu.pending,active:gpu.active,statistics};
}

export function auditPhysicalWindow(rendering,{label='window',seconds=0,budget={visibleTriangles:600000,drawCalls:1200,residentBytes:134217728,nearDetails:18000},gpuRequired}={}) {
  const errors=[],check=(condition,message)=>{if(!condition)errors.push(`${label}: ${message}`);};
  const frames=Array.isArray(rendering.frames)?rendering.frames:[],first=rendering.initialFrame,physical=first?[first,...frames]:frames;
  check(!!first&&first.intervalMs===null&&Number.isFinite(first.time),'missing/invalid initial physical frame');
  check(frames.length>1&&frames.length===rendering.windowFrames&&rendering.frameCount===frames.length+1&&physical.length===rendering.frameCount,'truncated physical-frame window');
  check(frames.every((f,i)=>Number.isFinite(f.time)&&Number.isFinite(f.intervalMs)&&f.intervalMs>0&&Number.isFinite((i?frames[i-1]:first)?.time)&&f.time>(i?frames[i-1]:first).time&&Math.abs(f.time-(i?frames[i-1]:first).time-f.intervalMs)<1e-7),'initial/interval frame chronology mismatch');
  const spanMs=first&&frames.length?frames.at(-1).time-first.time:null;
  check(Number.isFinite(spanMs)&&spanMs>=seconds*1000-100,'short physical-frame measurement window');
  check(physical.every(f=>integer(f.triangles)&&integer(f.drawCalls)&&f.triangles<=budget.visibleTriangles&&f.drawCalls<=budget.drawCalls),'drawing cap exceeded, including initial frame');
  check(physical.every(f=>integer(f.estimatedResidentBytes)&&f.estimatedResidentBytes<=budget.residentBytes),'resident cap exceeded, including initial frame');
  check(physical.every(f=>['bodyNearDetails','nearAttachmentDetails','totalNearDetails','nearGeometryArrayBytes'].every(k=>integer(f[k]))&&f.totalNearDetails===f.bodyNearDetails+f.nearAttachmentDetails&&f.totalNearDetails<=budget.nearDetails&&f.nearGeometryArrayBytes<=f.estimatedResidentBytes),'near/bytes evidence invalid or exceeds cap, including initial frame');
  const gpu=gpuRequired===undefined?null:auditGpuWindow(rendering,gpuRequired,`${label} GPU`);if(gpu)errors.push(...gpu.errors);
  return {errors,physicalFrames:physical.length,intervalFrames:frames.length,spanMs,initialFrame:first?{...first}:null,gpu,physicalDrawing:{triangles:independentDistribution(physical.map(f=>f.triangles)),drawCalls:independentDistribution(physical.map(f=>f.drawCalls))}};
}

export function auditBuildIdentity(summary,raw,label=raw.name||'case') {
  const frozen=summary.environment?.commit,errors=[];
  if(!/^[a-f0-9]{40}$/.test(frozen||''))errors.push(`${label}: missing frozen summary commit`);
  if(raw.build?.compilerCommit!==frozen)errors.push(`${label}: build compiler commit differs from summary measurement commit`);
  if(raw.environment?.commit!==undefined&&raw.environment.commit!==frozen)errors.push(`${label}: raw environment differs from summary measurement commit`);
  return errors;
}

export async function main(){
const root=process.cwd(),directory=path.resolve(process.argv[2]||'docs/phase1-evidence/remediation/integration/performance');
const output=path.resolve(process.argv[3]||'work/root-remediation-acceptance/performance-audit.json');
const read=async file=>JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
const summary=await read('summary.json'),errors=[],cases=[];
const expected=['beijing-cbd','kyoto-gion'].flatMap(city=>['fixed-1','fixed-4','fixed-16','grow-1','grow-4','grow-9'].map(kind=>`${city}-${kind}`));
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*p)-1];};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)errors.push(message);};
check(summary.results?.length===12,'Expected 12 summary cases');
check(JSON.stringify(summary.results?.map(r=>r.name).sort())===JSON.stringify([...expected].sort()),'Unexpected or duplicate cases');
check(summary.completedCases===12&&summary.expectedCases===12,'Summary matrix is incomplete');
check(summary.status==='pass','Publisher summary is not pass');
check(/^[a-f0-9]{40}$/.test(summary.environment?.commit||''),'Missing frozen measurement commit');
const bundleSha256=digest(await fs.readFile(path.join(root,'dist-sdk/city-ink.js')));
check(bundleSha256===summary.environment?.bundleSha256,'Current SDK differs from measured bundle');
check(summary.environment?.viewport?.width===1280&&summary.environment?.viewport?.height===720&&summary.environment?.viewport?.dpr===1,'Changed viewport/DPR');
check(summary.environment?.quality==='balanced','Changed quality');
for(const name of expected){
  const raw=await read(`${name}.json`);
  check(!raw.error,`${name}: browser error`);if(raw.error)continue;
  const {rendering:r,runtime:rt,budget:b}=raw.path.stats,intervalFrames=r.frames||[],frames=r.initialFrame?[r.initialFrame,...intervalFrames]:intervalFrames,gpu=Array.isArray(r.gpuTime.rawSamples)?r.gpuTime.rawSamples:[];
  const window=auditPhysicalWindow(r,{label:name,seconds:60,budget:b,gpuRequired:raw.hardware?.gpuTimerExtension});errors.push(...window.errors,...auditBuildIdentity(summary,raw));
  const rafP95=percentile(intervalFrames.map(f=>f.intervalMs),.95),triP95=percentile(intervalFrames.map(f=>f.triangles),.95),drawP95=percentile(intervalFrames.map(f=>f.drawCalls),.95);
  const published=summary.results.find(item=>item.name===name);
  check(published?.status==='pass'&&published.p95===rafP95&&published.trianglesP95===triP95&&published.drawCallsP95===drawP95,`${name}: summary entry differs from raw SDK interval aggregates`);
  check(rafP95===r.intervalsMs.p95&&triP95===r.triangles.p95&&drawP95===r.drawCalls.p95,`${name}: summary percentile mismatch`);
  check(raw.path.samples.at(-1).second>=60&&raw.path.durationSeconds>=60,`${name}: short measured path`);
  check(rafP95<=33.3,`${name}: frame interval target`);
  check(b.visibleTriangles===600000&&b.drawCalls===1200&&b.residentBytes===134217728&&b.concurrentLoads===3&&b.nearDetails===18000,`${name}: changed default budget`);
  check(frames.every(f=>f.triangles>=0&&f.triangles<=b.visibleTriangles&&f.drawCalls>=0&&f.drawCalls<=b.drawCalls),`${name}: drawing budget exceeded in an actual measured frame`);
  check(frames.every(f=>Number.isFinite(f.estimatedResidentBytes)&&f.estimatedResidentBytes>=0&&f.estimatedResidentBytes<=b.residentBytes)&&rt.peakEstimatedResidentBytes<=b.residentBytes,`${name}: resident budget exceeded during path`);
  check(frames.every(f=>[f.bodyNearDetails,f.nearAttachmentDetails,f.totalNearDetails,f.nearGeometryArrayBytes].every(n=>Number.isFinite(n)&&n>=0)&&f.totalNearDetails===f.bodyNearDetails+f.nearAttachmentDetails&&f.totalNearDetails<=b.nearDetails),`${name}: missing or over-budget shared near-detail evidence`);
  check(rt.peakConcurrentLoads<=b.concurrentLoads,`${name}: concurrency exceeded`);
  if(raw.hardware?.gpuTimerExtension){check(r.gpuTime.available&&gpu.length>0&&r.gpuTime.errors===0,`${name}: missing/failed GPU timing`);check(percentile(gpu.map(s=>s.ms),.95)===r.gpuTime.p95,`${name}: GPU percentile mismatch`);}
  check(raw.lifecycle.length>=5,`${name}: insufficient lifecycle rounds`);
  const resourceVector=s=>[s.runtime.geometries,s.runtime.materials,s.runtime.textures,s.runtime.geometryArrayBytes,...['geometries','materials','textures','geometryArrayBytes','nearDetails','frames','crownClusters','branches','profiles'].map(k=>s.nearAttachments[k]),s.rendering.last.rendererGeometries,s.rendering.last.rendererTextures,s.rendering.last.rendererPrograms];
  const reference=JSON.stringify(resourceVector(raw.lifecycle[0].returned));
  check(raw.lifecycle.every(c=>JSON.stringify(resourceVector(c.returned))===reference),`${name}: resource drift on return`);
  check(raw.lifecycle.every(c=>c.returned.runtime.estimatedResidentBytes<=b.residentBytes),`${name}: returned resident budget`);
  check(raw.lifecycle.every(c=>[c.away.runtime.geometries,c.away.runtime.textures,c.away.runtime.geometryArrayBytes,c.away.nearAttachments.geometryArrayBytes,c.away.runtime.pendingLoads].every(v=>v===0)),`${name}: resources remain away`);
  check(raw.comparisons.far.runtime.geometryArrayBytes<raw.comparisons.full.runtime.geometryArrayBytes&&raw.comparisons.far.rendering.triangles.p50<raw.comparisons.full.rendering.triangles.p50&&raw.comparisons.far.rendering.drawCalls.p50<raw.comparisons.full.rendering.drawCalls.p50,`${name}: far is not cheaper than full`);
  const sourceHash=digest(await fs.readFile(path.resolve(root,raw.build.source)));
  check(sourceHash===raw.build.sourceHash,`${name}: source snapshot mismatch`);
  check(raw.networkPolicy==='loopback-only'&&raw.networkRequests.every(q=>q.allowed),`${name}: runtime attempted external network`);
  const stationary=[];
  if(name==='beijing-cbd-grow-1'){
    const frozenViews=[{time:13,position:[-54.465855332583416,26.25,-52.10670670317487],target:[.5427259487235006,19.5,-6.486136335879564],fov:55},{time:19,position:[81.62020458277061,28.75,65.20333138415589],target:[.5427259487235006,18.5,-6.486136335879564],fov:55}];
    check(raw.stationary?.length===2,`${name}: missing two stationary regression phases`);
    for(const expectedView of frozenViews){
      const phase=raw.stationary?.find(p=>p.targetTime===expectedView.time);
      check(!!phase,`${name}: missing stationary t=${expectedView.time}`);if(!phase)continue;
      const views=[phase.view,phase.baselineView,phase.actualView,...phase.samples.map(s=>s.view)];
      check(views.every(v=>v&&['position','target'].every(k=>v[k]?.length===3&&v[k].every((n,i)=>Math.abs(n-expectedView[k][i])<1e-8))&&Math.abs(v.fov-55)<1e-8),`${name}: stationary camera changed at ${expectedView.time}`);
      const phaseRendering=phase.stats.rendering,phaseIntervals=phaseRendering.frames||[],f=phaseRendering.initialFrame?[phaseRendering.initialFrame,...phaseIntervals]:phaseIntervals,elapsed=(phase.endedEpochMs-phase.measurementEpochMs)/1000;
      const phaseWindow=auditPhysicalWindow(phaseRendering,{label:`${name} stationary t${expectedView.time}`,seconds:15,budget:b,gpuRequired:raw.hardware?.gpuTimerExtension});errors.push(...phaseWindow.errors);
      check(phase.durationSeconds>=15&&elapsed>=15&&Math.abs(elapsed-phase.durationSeconds)<.1,`${name}: short stationary observation`);
      check(Number.isFinite(phase.timeOrigin)&&f.every(frame=>phase.timeOrigin+frame.time>=phase.measurementEpochMs-1&&phase.timeOrigin+frame.time<=phase.endedEpochMs+1),`${name}: stationary frame epoch outside measurement phase`);
      check(f.every(x=>x.triangles<=600000&&x.drawCalls<=1200),`${name}: stationary actual budget exceeded`);
      check(f.every(x=>Number.isFinite(x.estimatedResidentBytes)&&x.estimatedResidentBytes<=134217728&&Number.isFinite(x.bodyNearDetails)&&Number.isFinite(x.nearAttachmentDetails)&&x.bodyNearDetails+x.nearAttachmentDetails===x.totalNearDetails&&x.totalNearDetails<=18000),`${name}: stationary resident/near budget exceeded or absent`);
      check(phase.samples.length>=120&&phase.samples.every(s=>s.runtime.visibleChunks>0&&s.runtime.missingChunks.length===0),`${name}: stationary coverage missing`);
      const swaps=phase.stats.runtime.swaps-phase.baseline.runtime.swaps,cancelled=phase.stats.runtime.cancelled-phase.baseline.runtime.cancelled;
      const signatures=phase.samples.map(s=>JSON.stringify(s.runtime.levels)),transitions=signatures.filter((v,i)=>i&&v!==signatures[i-1]).length;
      check(swaps>=0&&swaps<=1&&cancelled===0&&transitions<=1,`${name}: stationary LOD churn`);
      const measured=phase.phaseRequests?.filter(q=>q.observedAt>=phase.measurementEpochMs&&q.observedAt<=phase.endedEpochMs);
      check(JSON.stringify(measured)===JSON.stringify(phase.measuredRequests),`${name}: stationary network evidence mismatch`);
      const counts={};for(const q of measured||[])if(/\.cink(?:\?|$)/.test(q.url))counts[q.url]=(counts[q.url]||0)+1;
      check(Math.max(0,...Object.values(counts))<=1,`${name}: stationary repeated resource URL`);
      stationary.push({targetTime:expectedView.time,frames:f.length,intervalFrames:phaseIntervals.length,initialFrame:phaseWindow.initialFrame,gpuWindow:phaseWindow.gpu,elapsed,swaps,cancelled,transitions,triMax:Math.max(...f.map(x=>x.triangles)),drawMax:Math.max(...f.map(x=>x.drawCalls)),requestCounts:counts});
    }
  }
  const requestCounts={};for(const transfer of raw.path.transfers){const asset=new URL(transfer.url).pathname.split('/').at(-1);requestCounts[asset]=(requestCounts[asset]||0)+1;}
  cases.push({name,frames:frames.length,intervalFrames:intervalFrames.length,initialFrame:window.initialFrame,gpuWindow:window.gpu,gpuSamples:gpu.length,rafP95,triP95,drawP95,physicalDrawing:window.physicalDrawing,triMax:Math.max(...frames.map(f=>f.triangles)),drawMax:Math.max(...frames.map(f=>f.drawCalls)),residentMax:Math.max(...frames.map(f=>f.estimatedResidentBytes)),nearDetailsMax:Math.max(...frames.map(f=>f.totalNearDetails)),triangleFramesOver:frames.filter(f=>f.triangles>b.visibleTriangles).length,drawFramesOver:frames.filter(f=>f.drawCalls>b.drawCalls).length,swaps:rt.swaps,cancelled:rt.cancelled,requestCounts,stationary,sourceHash,compilerCommit:raw.build.compilerCommit,chunks:raw.build.chunks,features:raw.build.features});
}
const result={date:new Date().toISOString(),reviewedHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),measuredCommit:summary.environment.commit,bundleSha256,mode:'Independent re-computation of saved raw GPU/frame data; this program does not measure GPU performance',status:errors.length?'fail':'pass',errors,cases};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,errors,cases:cases.length,output}));process.exitCode=errors.length?1:0;
return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
