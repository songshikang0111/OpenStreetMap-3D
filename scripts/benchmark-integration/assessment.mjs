import {distribution} from '../../src/runtime/statistics.js';

export const CASE_NAMES = ['beijing-cbd-fixed-1','beijing-cbd-fixed-4','beijing-cbd-fixed-16','beijing-cbd-grow-1','beijing-cbd-grow-4','beijing-cbd-grow-9','kyoto-gion-fixed-1','kyoto-gion-fixed-4','kyoto-gion-fixed-16','kyoto-gion-grow-1','kyoto-gion-grow-4','kyoto-gion-grow-9'];
const counts = stats => [stats.runtime.geometries,stats.runtime.materials,stats.runtime.textures,stats.runtime.geometryArrayBytes,stats.rendering.last.rendererGeometries,stats.rendering.last.rendererTextures,stats.rendering.last.rendererPrograms];
export function requestCounts(requests) {
  const urls = {};
  for (const request of requests) if (/\.cink(?:\?|$)/.test(request.url)) urls[request.url]=(urls[request.url]||0)+1;
  return {total:Object.values(urls).reduce((a,b)=>a+b,0),maxPerUrl:Math.max(0,...Object.values(urls)),urls};
}
export function assessStationary(result) {
  const {baseline,stats}=result,frames=stats.rendering.frames||[],requests=requestCounts(result.measuredRequests||[]);
  const swaps=stats.runtime.swaps-baseline.runtime.swaps,cancelled=stats.runtime.cancelled-baseline.runtime.cancelled;
  const signatures=result.samples.map(item=>JSON.stringify(item.runtime.levels));
  const transitions=signatures.reduce((n,value,index)=>n+Number(index>0&&value!==signatures[index-1]),0);
  return {swaps,cancelled,transitions,requests,checks:{duration:result.durationSeconds>=15,frames:frames.length>0,drawingTriangles:frames.length>0&&frames.every(frame=>frame.triangles<=stats.budget.visibleTriangles),drawingCalls:frames.length>0&&frames.every(frame=>frame.drawCalls<=stats.budget.drawCalls),stableLod:swaps<=1&&transitions<=1,noCancelledRequests:cancelled===0,noRepeatedRequests:requests.maxPerUrl<=1,coverage:result.samples.length>0&&result.samples.every(item=>item.runtime.visibleChunks>0&&item.runtime.missingChunks.length===0)}};
}
export function assessCase(result) {
  if(result.error)return {status:'fail',checks:{browserRun:false}};
  const {rendering,runtime,budget}=result.path.stats,frames=rendering.frames||[],cycles=result.lifecycle;
  const elapsed=result.path.samples.at(-1)?.second??0;
  const first=cycles.length?counts(cycles[0].returned):[];
  const stationary=(result.stationary||[]).map(assessStationary);
  const drawing={triangles:distribution(frames.map(f=>f.triangles)),drawCalls:distribution(frames.map(f=>f.drawCalls)),triangleFramesOver:frames.filter(f=>f.triangles>budget.visibleTriangles).length,drawCallFramesOver:frames.filter(f=>f.drawCalls>budget.drawCalls).length};
  const checks={defaultBudget:budget.visibleTriangles===600000&&budget.drawCalls===1200&&budget.residentBytes===128*1024*1024&&budget.concurrentLoads===3,viewport:result.path.stats.viewport.width===1280&&result.path.stats.viewport.height===720&&result.path.stats.viewport.pixelRatio===1&&result.path.stats.quality==='balanced',duration:result.path.durationSeconds>=60&&elapsed>=60,frames:frames.length>0,completeSamples:rendering.frameCount===frames.length+1&&frames.at(-1).time-frames[0].time>=59900,p95:rendering.intervalsMs.p95!=null&&rendering.intervalsMs.p95<=33.3,errors:!result.browserEvents.some(event=>event.level==='error'),gpuTiming:!result.hardware.gpuTimerExtension||(rendering.gpuTime.available&&rendering.gpuTime.samples>0&&rendering.gpuTime.errors===0),concurrency:runtime.peakConcurrentLoads<=budget.concurrentLoads,drawingTriangles:frames.length>0&&drawing.triangles.max<=budget.visibleTriangles,drawingCalls:frames.length>0&&drawing.drawCalls.max<=budget.drawCalls,farGeometry:result.comparisons.far.runtime.geometryArrayBytes<result.comparisons.full.runtime.geometryArrayBytes,farTriangles:result.comparisons.far.rendering.triangles.p50<result.comparisons.full.rendering.triangles.p50,farDraws:result.comparisons.far.rendering.drawCalls.p50<result.comparisons.full.rendering.drawCalls.p50,unloads:cycles.length>=5&&cycles.every(item=>item.away.runtime.geometries===0&&item.away.runtime.materials===0&&item.away.runtime.textures===0),lifecycleStable:cycles.length>=5&&first.every(Number.isFinite)&&cycles.every(item=>counts(item.returned).every((n,i)=>n===first[i])),residentBudget:cycles.every(item=>item.returned.runtime.estimatedResidentBytes<=item.returned.budget.residentBytes),gpuQueriesBounded:cycles.every(item=>item.returned.rendering.gpuTime.unreleased<=item.returned.rendering.gpuTime.maxPending+Number(item.returned.rendering.gpuTime.active)),stationary:result.name!=='beijing-cbd-grow-1'||stationary.length===2&&stationary.every(item=>Object.values(item.checks).every(Boolean))};
  return {status:Object.values(checks).every(Boolean)?'pass':'fail',checks,drawing,stationary,elapsed};
}
