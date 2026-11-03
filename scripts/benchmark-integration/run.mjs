import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openLocalBrowser} from '../../src/cli/browser-session.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2),seconds=Number(args.find(a=>a.startsWith('--seconds='))?.split('=')[1]||60);
const selected=args.filter(a=>!a.startsWith('--')),output=path.join(root,'docs/phase1-evidence/integration/performance');await mkdir(output,{recursive:true});
const names=selected.length?selected:['beijing-cbd-fixed-1','beijing-cbd-fixed-4','beijing-cbd-fixed-16','beijing-cbd-grow-1','beijing-cbd-grow-4','beijing-cbd-grow-9','kyoto-gion-fixed-1','kyoto-gion-fixed-4','kyoto-gion-fixed-16','kyoto-gion-grow-1','kyoto-gion-grow-4','kyoto-gion-grow-9'];
const environment={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version,viewport:{width:1280,height:720,dpr:1},quality:'balanced',seconds,bundleSha256:createHash('sha256').update(await readFile(path.join(root,'dist-sdk/city-ink.js'))).digest('hex'),notes:['Integrated production A/C/D bundle and protocol, no fixture decoder.','renderer.info autoReset=false; all scene/shadow/AO/composite passes accumulated.','Resource bytes are CPU arrays / estimates, never actual GPU VRAM.','GPU elapsed uses non-blocking EXT_disjoint_timer_query_webgl2 when available; requestAnimationFrame intervals remain wall-clock.']};
const resourceCounts=stats=>[stats.runtime.geometries,stats.runtime.materials,stats.runtime.textures,stats.runtime.geometryArrayBytes,stats.rendering.last.rendererGeometries,stats.rendering.last.rendererTextures,stats.rendering.last.rendererPrograms];
const stableResources=cycles=>{const first=resourceCounts(cycles[0].returned);return first.every(Number.isFinite)&&cycles.every(item=>resourceCounts(item.returned).every((count,index)=>count===first[index]));};
const results=[];
for(const name of names){
  const browser=await openLocalBrowser({root,headless:false,startPath:'scripts/benchmark-integration/index.html'});let result;
  try{
    await browser.evaluate(`(async()=>{const deadline=performance.now()+20000;while(!globalThis.benchmarkReady&&performance.now()<deadline)await new Promise(r=>setTimeout(r,50));if(!globalThis.benchmarkReady)throw new Error('Benchmark page not ready');})()`);
    const manifest=JSON.parse(await readFile(path.join(root,'work/integration-scenes',name,'manifest.json'),'utf8'));
    const cold=await browser.evaluate(`benchmark.load(${JSON.stringify(name)},${JSON.stringify(manifest.bounds)})`);
    const build=JSON.parse(await readFile(path.join(root,'work/integration-scenes',name,'build-report.json'),'utf8'));
    const pathResult=await browser.evaluate(`benchmark.measure(${seconds})`);
    const comparisons=await browser.evaluate('benchmark.comparisons()'),lifecycle=await browser.evaluate('benchmark.lifecycle()');
    const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`${name}.png`),Buffer.from(screenshot.data,'base64'));
    result={name,build,...cold,path:pathResult,comparisons,lifecycle,browserEvents:[...browser.events],checks:{duration:seconds>=60,p95:pathResult.stats.rendering.intervalsMs.p95<=33.3,errors:!browser.events.some(event=>event.level==='error'),gpuTiming:!cold.hardware.gpuTimerExtension||(pathResult.stats.rendering.gpuTime.available&&pathResult.stats.rendering.gpuTime.samples>0&&pathResult.stats.rendering.gpuTime.errors===0),concurrency:pathResult.stats.runtime.peakConcurrentLoads<=pathResult.stats.budget.concurrentLoads,farGeometry:comparisons.far.runtime.geometryArrayBytes<comparisons.full.runtime.geometryArrayBytes,farTriangles:comparisons.far.rendering.triangles.p50<comparisons.full.rendering.triangles.p50,farDraws:comparisons.far.rendering.drawCalls.p50<comparisons.full.rendering.drawCalls.p50,unloads:lifecycle.every(item=>item.away.runtime.geometries===0&&item.away.runtime.materials===0&&item.away.runtime.textures===0),lifecycleStable:stableResources(lifecycle),residentBudget:lifecycle.every(item=>item.returned.runtime.estimatedResidentBytes<=item.returned.budget.residentBytes),gpuQueriesBounded:lifecycle.every(item=>item.returned.rendering.gpuTime.unreleased<=item.returned.rendering.gpuTime.maxPending+Number(item.returned.rendering.gpuTime.active))}};
    await browser.evaluate('benchmark.dispose()');
  }catch(error){result={name,error:error.stack};}
  finally{await browser.close();}
  await writeFile(path.join(output,`${name}.json`),JSON.stringify(result));
  const summary=result.error?result:{name,p50:result.path.stats.rendering.intervalsMs.p50,p95:result.path.stats.rendering.intervalsMs.p95,p99:result.path.stats.rendering.intervalsMs.p99,longFrames50ms:result.path.stats.rendering.longFrames50ms,gpuP50:result.path.stats.rendering.gpuTime.p50,gpuP95:result.path.stats.rendering.gpuTime.p95,drawCallsP95:result.path.stats.rendering.drawCalls.p95,trianglesP95:result.path.stats.rendering.triangles.p95,checks:result.checks};results.push(summary);console.log(JSON.stringify(summary));
  await writeFile(path.join(output,'summary.json'),JSON.stringify({environment,results},null,2));
}

process.exitCode=results.every(result=>!result.error&&Object.values(result.checks).every(Boolean))?0:1;
