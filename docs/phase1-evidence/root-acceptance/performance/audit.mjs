import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
await fs.mkdir('work/root-acceptance-performance',{recursive:true});
const root=new URL('../../../../',import.meta.url),dir=new URL('docs/phase1-evidence/integration/performance/',root),read=async p=>JSON.parse(await fs.readFile(new URL(p,dir)));
const summary=await read('summary.json'),assessment=await read('assessment.json'),errors=[],cases=[];
const q=(values,f)=>{values=[...values].sort((a,b)=>a-b);return values[Math.ceil(values.length*f)-1];};
const expected=['beijing-cbd','kyoto-gion'].flatMap(city=>['fixed-1','fixed-4','fixed-16','grow-1','grow-4','grow-9'].map(kind=>`${city}-${kind}`));
const counts=s=>[s.runtime.geometries,s.runtime.materials,s.runtime.textures,s.runtime.geometryArrayBytes,s.runtime.estimatedResidentBytes,s.nearAttachments.geometries,s.nearAttachments.materials,s.nearAttachments.textures,s.nearAttachments.geometryArrayBytes,s.rendering.last.rendererGeometries,s.rendering.last.rendererTextures,s.rendering.last.rendererPrograms];
for(const name of expected){
 const raw=await read(name+'.json'),s=raw.path.stats,r=s.rendering,frames=r.frames,g=r.gpuTime.rawSamples,a=assessment.cases.find(v=>v.name===name),sum=summary.results.find(v=>v.name===name);
 const p95=q(frames.map(v=>v.intervalMs),.95),gpuP95=q(g.map(v=>v.ms),.95),drawP95=q(frames.map(v=>v.drawCalls),.95),triP95=q(frames.map(v=>v.triangles),.95);
 if(p95!==r.intervalsMs.p95||p95!==a.raf.p95||p95!==sum.p95||gpuP95!==r.gpuTime.p95||drawP95!==a.drawingBudget.drawCallsP95||triP95!==a.drawingBudget.trianglesP95)errors.push(name+': summary mismatch');
 if(frames.length!==r.frameCount-1||frames.length!==r.windowFrames||frames.some((f,i)=>i&&Math.abs(f.time-frames[i-1].time-f.intervalMs)>1e-8))errors.push(name+': chronology/window mismatch');
 const reference=JSON.stringify(counts(raw.lifecycle[0].returned));
 const stable=raw.lifecycle.length===5&&raw.lifecycle.every(c=>JSON.stringify(counts(c.returned))===reference&&c.returned.runtime.estimatedResidentBytes<=s.budget.residentBytes);
 const awayEmpty=raw.lifecycle.every(c=>[c.away.runtime.geometries,c.away.runtime.materials,c.away.runtime.textures,c.away.runtime.geometryArrayBytes,c.away.nearAttachments.geometryArrayBytes,c.away.runtime.pendingLoads].every(v=>v===0));
 const requestCounts={};for(const t of raw.path.transfers){const asset=t.url.split('/').at(-1);requestCounts[asset]=(requestCounts[asset]||0)+1;}
 cases.push({name,frames:frames.length,gpuSamples:g.length,p95,gpuP95,drawP95,triP95,trianglesBudget:s.budget.visibleTriangles,drawBudget:s.budget.drawCalls,measuredSeconds:raw.path.samples.at(-1).second,minSubmittedTriangles:Math.min(...frames.map(v=>v.triangles)),peakEstimatedResidentBytes:s.runtime.peakEstimatedResidentBytes,peakConcurrentLoads:s.runtime.peakConcurrentLoads,lifecycleStable:stable,awayEmpty,farReduced:raw.comparisons.far.runtime.geometryArrayBytes<raw.comparisons.full.runtime.geometryArrayBytes&&raw.comparisons.far.rendering.triangles.p50<raw.comparisons.full.rendering.triangles.p50,sourceHash:raw.build.sourceHash,area:raw.build.config.area,origin:raw.build.config.origin,tiling:raw.build.config.tiling,features:raw.build.features,chunks:raw.build.chunks,loads:s.runtime.loads,swaps:s.runtime.swaps,cancelled:s.runtime.cancelled,fetchedBytes:s.runtime.fetchedBytes,networkTransferBytes:raw.path.transfers.reduce((n,t)=>n+t.transferSize,0),requestCounts});
}
const bundleSha256=createHash('sha256').update(await fs.readFile(new URL('dist-sdk/city-ink.js',root))).digest('hex');if(bundleSha256!==summary.environment.bundleSha256)errors.push('bundle SHA mismatch');
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:'Read-only independent audit of saved browser JSON, no GPU launched',frozenEnvironment:summary.environment,bundleSha256,errors,totalFrames:cases.reduce((n,c)=>n+c.frames,0),totalGpuSamples:cases.reduce((n,c)=>n+c.gpuSamples,0),triP95Failures:cases.filter(c=>c.triP95>c.trianglesBudget).map(c=>c.name),drawP95Failures:cases.filter(c=>c.drawP95>c.drawBudget).map(c=>c.name),cases};
await fs.writeFile(new URL('../../../../work/root-acceptance-performance/audit.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({errors,totalFrames:report.totalFrames,totalGpuSamples:report.totalGpuSamples,triP95Failures:report.triP95Failures,drawP95Failures:report.drawP95Failures,bundleSha256}));
