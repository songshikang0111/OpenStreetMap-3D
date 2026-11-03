import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openLocalBrowser} from '../../src/cli/browser-session.js';
import {CASE_NAMES,assessCase} from './assessment.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const option=(name,fallback)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
for(const arg of args.filter(arg=>arg.startsWith('--')))if(!/^--(?:seconds|stationary-seconds|output|scenes)=/.test(arg))throw new Error(`Unknown option ${arg}`);
const seconds=Number(option('seconds','60')),stationarySeconds=Number(option('stationary-seconds','15'));
if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(stationarySeconds)||stationarySeconds<=0)throw new Error('Durations must be positive and finite.');
const output=path.resolve(root,option('output','docs/phase1-evidence/remediation/integration/performance'));
const scenes=path.resolve(root,option('scenes','work/remediation-integration-scenes'));
if(path.relative(root,scenes).startsWith('..')||path.isAbsolute(path.relative(root,scenes)))throw new Error('Scene assets must be inside the served repository.');
await mkdir(output,{recursive:true});
const selected=args.filter(arg=>!arg.startsWith('--')),names=selected.length?selected:CASE_NAMES;
if(new Set(names).size!==names.length||names.some(name=>!CASE_NAMES.includes(name)))throw new Error('Expected unique known benchmark case names.');
const referenceBytes=await readFile(path.join(root,'docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json'));
const reference=JSON.parse(referenceBytes),referenceSummary=JSON.parse(await readFile(path.join(root,'docs/phase1-evidence/integration/performance/summary.json'),'utf8'));
const fixedView=t=>{const keys=reference.path.keys,index=keys.findIndex((key,i)=>i<keys.length-1&&t>=key.t&&t<=keys[i+1].t),a=keys[index],b=keys[index+1],u=(t-a.t)/(b.t-a.t),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*u);return {position:mix(a.position,b.position),target:mix(a.target,b.target),fov:a.fov+(b.fov-a.fov)*u};};
const environment={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version,viewport:{width:1280,height:720,dpr:1},quality:'balanced',seconds,stationarySeconds,scenes:path.relative(root,scenes),output:path.relative(root,output),stationaryReference:{measurementCommit:referenceSummary.environment.commit,sceneCompilerCommit:reference.build.compilerCommit,rawSha256:createHash('sha256').update(referenceBytes).digest('hex'),source:'docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json',times:[13,19]},bundleSha256:createHash('sha256').update(await readFile(path.join(root,'dist-sdk/city-ink.js'))).digest('hex'),notes:['Integrated production A/C/D bundle and protocol, no fixture decoder.','renderer.info autoReset=false; all scene/shadow/AO/composite passes accumulated.','Resource bytes are CPU arrays / estimates, never actual GPU VRAM.','GPU elapsed uses non-blocking EXT_disjoint_timer_query_webgl2 when available; requestAnimationFrame intervals remain wall-clock.']};
const results=[];
for(const name of names){
  const browser=await openLocalBrowser({root,headless:false,startPath:'scripts/benchmark-integration/index.html'});let result;
  try{
    await browser.evaluate(`(async()=>{const deadline=performance.now()+20000;while(!globalThis.benchmarkReady&&performance.now()<deadline)await new Promise(r=>setTimeout(r,50));if(!globalThis.benchmarkReady)throw new Error('Benchmark page not ready');})()`);
    const manifest=JSON.parse(await readFile(path.join(scenes,name,'manifest.json'),'utf8'));
    const scenePath=path.relative(root,path.join(scenes,name,'manifest.json')).split(path.sep).map(encodeURIComponent).join('/');
    const manifestUrl=new URL('/'+scenePath,browser.url).href;
    const cold=await browser.evaluate(`benchmark.load(${JSON.stringify(name)},${JSON.stringify(manifest.bounds)},${JSON.stringify(manifestUrl)})`);
    const build=JSON.parse(await readFile(path.join(scenes,name,'build-report.json'),'utf8'));
    const pathResult=await browser.evaluate(`benchmark.measure(${seconds})`);
    const stationary=[];
    if(name==='beijing-cbd-grow-1')for(const targetTime of [13,19]){
      const networkStart=browser.network.length,record=await browser.evaluate(`benchmark.stationary(${JSON.stringify(fixedView(targetTime))},${stationarySeconds})`);
      const requests=browser.network.slice(networkStart);stationary.push({...record,targetTime,phaseRequests:requests,measuredRequests:requests.filter(request=>request.observedAt>=record.measurementEpochMs&&request.observedAt<=record.endedEpochMs)});
    }
    const comparisons=await browser.evaluate('benchmark.comparisons()'),lifecycle=await browser.evaluate('benchmark.lifecycle()'),allTransfers=await browser.evaluate('benchmark.resources()');
    const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`${name}.png`),Buffer.from(screenshot.data,'base64'));
    result={name,build,...cold,path:pathResult,stationary,comparisons,lifecycle,allTransfers,browserEvents:[...browser.events],networkPolicy:browser.networkPolicy,networkRequests:[...browser.network]};
    result.assessment=assessCase(result);result.checks=result.assessment.checks;
    await browser.evaluate('benchmark.dispose()');
  }catch(error){result={name,error:error.stack};}
  finally{await browser.close();}
  await writeFile(path.join(output,`${name}.json`),JSON.stringify(result));
  const summary=result.error?result:{name,p50:result.assessment.intervals.p50,p95:result.assessment.intervals.p95,p99:result.assessment.intervals.p99,longFrames50ms:result.path.stats.rendering.longFrames50ms,gpuP50:result.path.stats.rendering.gpuTime.p50,gpuP95:result.path.stats.rendering.gpuTime.p95,status:result.assessment.status,stationary:result.assessment.stationary,drawCallsP95:result.path.stats.rendering.drawCalls.p95,trianglesP95:result.path.stats.rendering.triangles.p95,checks:result.checks};results.push(summary);console.log(JSON.stringify(summary));
  await writeFile(path.join(output,'summary.json'),JSON.stringify({environment,expectedCases:CASE_NAMES.length,completedCases:results.length,status:results.length===CASE_NAMES.length?(results.every(item=>item.status==='pass')?'pass':'fail'):'not-run',results},null,2));
}

process.exitCode=names.length===CASE_NAMES.length&&results.every(result=>!result.error&&Object.values(result.checks).every(Boolean))?0:1;
