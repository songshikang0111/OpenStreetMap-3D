import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const args=process.argv.slice(2), get=(key,fallback)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const base=get('url','http://127.0.0.1:5184'), output=path.resolve(get('output','docs/phase1-evidence/runtime/browser'));
const seconds=Number(get('seconds','60')), names=get('fixtures','core-synthetic-fixed-1,core-synthetic-fixed-4,core-synthetic-fixed-16,core-beijing-cbd-fixed-1,core-beijing-cbd-fixed-4,core-beijing-cbd-fixed-16,core-beijing-cbd-grow-1,core-beijing-cbd-grow-4,core-beijing-cbd-grow-9,core-kyoto-gion-fixed-1,core-kyoto-gion-fixed-4,core-kyoto-gion-fixed-16,core-kyoto-gion-grow-1,core-kyoto-gion-grow-4,core-kyoto-gion-grow-9').split(',');
await fs.mkdir(output,{recursive:true});
const executablePath=get('browser',process.env.CITY_BENCHMARK_BROWSER);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const environment={date:new Date().toISOString(),commit,platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,cpuLogicalCount:os.cpus().length,totalMemory:os.totalmem(),browserVersion:browser.version(),viewport:{width:1280,height:720},devicePixelRatio:1,quality:'balanced',seconds,acceptanceDuration:seconds>=60,notes:['GPU memory is not measurable through WebGL. Resident byte values are estimates and CPU array counts.','Names prefixed core- use the real A CINK codec and C official styles. Others use the explicitly labelled fixture adapter.','Frames include every renderer pass, shadows, AO, composite and resolve. GPU timer queries not collected.']};
const results=[];
for(const name of names) {
  const context=await browser.newContext({viewport:{width:1280,height:794},deviceScaleFactor:1});const page=await context.newPage();
  const errors=[], requests=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
  const started=Date.now();
  try {
    const source=JSON.parse(await fs.readFile(path.resolve('work/runtime-fixtures',name,'manifest.json'))), build=JSON.parse(await fs.readFile(path.resolve('work/runtime-fixtures',name,'build-report.json')));
    await page.goto(`${base}/examples/embed/?fixture=${name}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!globalThis.viewer);
    await page.evaluate(()=>viewer.whenIdle()); const cold=await page.evaluate(()=>viewer.getStats());
    const hardware=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,webgl:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),gpuTimerExtension:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});
    await page.waitForTimeout(3000);await page.evaluate(()=>viewer.whenIdle());
    const bounds=source.fixture.coverageBounds,[x0,z0,x1,z1]=bounds,cx=(x0+x1)/2,cz=(z0+z1)/2,span=Math.max(x1-x0,z1-z0);
    const keys=[
      {t:0,p:[cx+span*.7,span*.9,cz+span],q:[cx,25,cz],f:45},
      {t:10,p:[x0+span*.23,30,z0+span*.33],q:[x0+span*.24,16,z0+span*.18],f:55},
      {t:22,p:[x1-span*.17,30,z1-span*.17],q:[cx,18,cz],f:55},
      {t:34,p:[cx-span*.7,span*1.5,cz-span*.7],q:[cx,25,cz],f:40},
      {t:37,p:[cx+span*.05,22,cz+span*.09],q:[cx,18,cz-span*.14],f:30},
      {t:41,p:[cx+span,span*1.2,cz+span],q:[cx,20,cz],f:70},
      {t:45,p:[cx+span*6,span*.7,cz+span*6],q:[cx+span*9,span*.7,cz+span*9],f:45},
      {t:49,p:[cx+span*6,span*.7,cz+span*6],q:[cx+span*9,span*.7,cz+span*9],f:45},
      {t:55,p:[cx+span*.7,span*.9,cz+span],q:[cx,25,cz],f:45},
      {t:60,p:[cx+span*.7,span*.9,cz+span],q:[cx,25,cz],f:45},
    ];
    const samples=await page.evaluate(async({keys,seconds})=>{
      viewer.resetStats();const samples=[],start=performance.now();let next=0;
      await new Promise(resolve=>{function step(now){const secondsNow=(now-start)/1000,phase=Math.min(60,secondsNow/seconds*60);let index=keys.findIndex((k,i)=>i<keys.length-1&&phase>=k.t&&phase<=keys[i+1].t);if(index<0)index=keys.length-2;const a=keys[index],b=keys[index+1],t=Math.max(0,Math.min(1,(phase-a.t)/(b.t-a.t))),u=t*t*(3-2*t),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*u);viewer.setView({position:mix(a.p,b.p),target:mix(a.q,b.q),fov:a.f+(b.f-a.f)*u});if(secondsNow>=next){const s=viewer.getStats();samples.push({second:secondsNow,runtime:s.runtime,render:s.rendering.last});next+=1;}if(secondsNow<seconds)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});return samples;
    },{keys,seconds});
    const measured=await page.evaluate(()=>viewer.getStats({raw:true}));
    await page.screenshot({path:path.join(output,`${name}-overview.png`)});
    // Same camera, loaded coverage: actual far vs full-detail control. Force
    // modes intentionally bypass automatic downgrade to expose the true cost.
    const comparisons={};
    for(const mode of ['far','full','far']) {
      await page.evaluate(mode=>viewer.setLodMode(mode),mode);await page.waitForTimeout(1200);await page.evaluate(()=>viewer.whenIdle({timeoutMs:60000}));await page.evaluate(()=>viewer.resetStats());await page.waitForTimeout(1500);
      comparisons[mode==='far'&&comparisons.far?'farAfterRoundTrip':mode]=await page.evaluate(()=>viewer.getStats());
    }
    const lifecycle=[];
    await page.evaluate(()=>viewer.setLodMode('auto'));
    for(let cycle=0;cycle<5;cycle++) {
      await page.evaluate(({cx,cz,span})=>viewer.setView({position:[cx+span*6,span*.7,cz+span*6],target:[cx+span*9,span*.7,cz+span*9]}),{cx,cz,span});await page.waitForTimeout(650);
      const away=await page.evaluate(()=>viewer.getStats());
      await page.evaluate(view=>viewer.setView(view),{position:keys[0].p,target:keys[0].q,fov:45});await page.waitForTimeout(1250);await page.evaluate(()=>viewer.whenIdle());
      lifecycle.push({cycle,away,returned:await page.evaluate(()=>viewer.getStats())});
    }
    const summary={name,...build,hardware,cold,measured,samples,path:{durationSeconds:seconds,keys},comparisons,lifecycle,errors,failedRequests:requests,elapsedMs:Date.now()-started,checks:{duration:seconds>=60,p95:measured.rendering.intervalsMs.p95<=33.3,concurrency:measured.runtime.peakConcurrentLoads<=measured.budget.concurrentLoads,farDrawReduction:comparisons.far.rendering.triangles.p50<comparisons.full.rendering.triangles.p50,farResidentReduction:comparisons.far.runtime.geometryArrayBytes<comparisons.full.runtime.geometryArrayBytes,lifecycle:Math.max(...lifecycle.map(x=>x.away.runtime.geometries))===0&&lifecycle.every(x=>x.returned.runtime.geometryArrayBytes===lifecycle[0].returned.runtime.geometryArrayBytes),errors:errors.length===0}};
    await fs.writeFile(path.join(output,`${name}.json`),JSON.stringify(summary));
    const short={name,p50:measured.rendering.intervalsMs.p50,p95:measured.rendering.intervalsMs.p95,p99:measured.rendering.intervalsMs.p99,longFrames50ms:measured.rendering.longFrames50ms,checks:summary.checks,nearTriangles:comparisons.full.rendering.triangles.p50,farTriangles:comparisons.far.rendering.triangles.p50};results.push(short);console.log(JSON.stringify(short));
    await page.evaluate(()=>viewer.dispose());await context.close();
  } catch(error) {const failure={name,error:error.stack,errors};results.push(failure);await fs.writeFile(path.join(output,`${name}-failed.json`),JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));await context.close();}
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({environment,results},null,2));
}
await browser.close();
