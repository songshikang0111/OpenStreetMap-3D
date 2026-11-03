// Real public SDK, real CINK and WebGL; no copied scheduler implementation.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const base=process.env.RUNTIME_BASE || 'http://127.0.0.1:5184';
const output=new URL('./',import.meta.url);
const raw=JSON.parse(await fs.readFile(new URL('../../integration/performance/beijing-cbd-grow-1.json',import.meta.url)));
const poses=[10,13,19,37].map(t=>{const keys=raw.path.keys,i=keys.findIndex((k,i)=>i<keys.length-1&&t>=k.t&&t<=keys[i+1].t),a=keys[i],b=keys[i+1],u=(t-a.t)/(b.t-a.t),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*u);return {t,view:{position:mix(a.position,b.position),target:mix(a.target,b.target),fov:a.fov+(b.fov-a.fov)*u}};});
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/宋世康/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',args:['--ignore-gpu-blocklist','--disable-background-timer-throttling']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>console.error(e.message));
 await page.goto(`${base}/docs/phase1-evidence/remediation/runtime/harness.html`);
 await page.evaluate(async()=>{const {createCityViewer}=await import('/src/sdk/index.js');window.createCityViewer=createCityViewer;const {loadDefaultAdapters}=await import('/src/runtime/integrations.js');window.adapters=await loadDefaultAdapters();});
 const result={productCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browserVersion:browser.version(),mode:'Real public SDK / default budgets / CINK / WebGL / stationary wall-clock holds',cases:[]};
 for(const pose of poses){
  const sample=await page.evaluate(async({pose,duration})=>{
   const requests=[],frames=[];let viewer,ink,gpu;
   const api={...adapters.styleApi,createStylePipeline(args){const gl=args.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');gpu={vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};const pipeline=adapters.styleApi.createStylePipeline(args);ink=pipeline.ink;return pipeline;}};
   const readAsset=async(url,{signal,responseType})=>{const event={url,start:performance.now(),aborted:false};requests.push(event);signal?.addEventListener('abort',()=>{event.aborted=true;event.abortAt=performance.now();},{once:true});const response=await fetch(url,{signal});if(!response.ok)throw Error(response.status);const value=await response[responseType==='json'?'json':'arrayBuffer']();event.end=performance.now();return value;};
   viewer=await createCityViewer({container:document.querySelector('#stage'),adapters:{...adapters,styleApi:api},readAsset});window.viewer=viewer;
   await viewer.load('/work/integration-scenes/beijing-cbd-grow-1/manifest.json',{view:pose.view});
   const started=performance.now();let stop=false;
   function sample(){if(stop)return;const s=viewer.getStats(),frame=s.rendering.frameCount?s.rendering.last:null;frames.push({time:performance.now()-started,current:s.runtime.currentLods,desired:s.runtime.desiredLods,loads:s.runtime.loads,swaps:s.runtime.swaps,cancelled:s.runtime.cancelled,near:s.nearAttachments,bodyCost:s.runtime.frameCost,frame,missing:s.runtime.missingChunks,settled:s.runtime.settled,estimatedResidentBytes:s.runtime.estimatedResidentBytes});requestAnimationFrame(sample);}sample();
   await new Promise(resolve=>setTimeout(resolve,duration));stop=true;await viewer.whenIdle();
   const final=viewer.getStats(),ao={configured:ink.material.uniforms.aoStrength.value,enabled:ink.aoEnabled};
   await viewer.dispose();return {pose,gpu,heldMs:performance.now()-started,requests,frames,final,ao,disposed:viewer.getStats()};
  },{pose,duration:pose.t===13||pose.t===19?15500:3000});
  const counted=sample.frames.filter(f=>f.frame),max=(key)=>Math.max(0,...counted.map(f=>f.frame[key]||0));
  sample.summary={frames:sample.frames.length,maxTriangles:max('triangles'),maxDrawCalls:max('drawCalls'),overFrames:counted.filter(f=>f.frame.triangles>600000||f.frame.drawCalls>1200).length,missingFrames:sample.frames.filter(f=>f.current.length&&f.missing.length).length,loads:sample.final.runtime.loads,swaps:sample.final.runtime.swaps,cancelled:sample.final.runtime.cancelled,urls:sample.requests.reduce((out,r)=>(out[r.url]=(out[r.url]||0)+1,out),{})};
  result.cases.push(sample);console.log(JSON.stringify({t:pose.t,...sample.summary}));await fs.writeFile(new URL('browser-after.json',output),JSON.stringify(result,null,2));
  assert.equal(sample.summary.overFrames,0);assert.equal(sample.summary.missingFrames,0);assert.equal(sample.summary.cancelled,0);assert.equal(sample.summary.swaps,1);
  assert(Object.entries(sample.summary.urls).filter(([url])=>url.endsWith('.cink')).every(([,count])=>count===1));
  assert.equal(sample.disposed.runtime.estimatedResidentBytes,0);
  if(pose.t===13||pose.t===19)assert(sample.heldMs>=15000);
 }
 // Probe the actual public SDK application of real official pipelines.
 result.ao=await page.evaluate(async()=>{const results=[];for(const quality of ['balanced','low'])for(const strength of [0,.12,.9]){let ink;const api={...adapters.styleApi,createStylePipeline(args){const p=adapters.styleApi.createStylePipeline(args);ink=p.ink;return p;}};const viewer=await createCityViewer({container:document.querySelector('#stage'),quality,style:{id:'comic',parameters:{aoStrength:strength}},adapters:{...adapters,styleApi:api}});results.push({quality,requested:strength,actual:ink.material.uniforms.aoStrength.value,enabled:ink.aoEnabled,effective:ink.aoEnabled?ink.material.uniforms.aoStrength.value:0});await viewer.dispose();}return results;});
 await fs.writeFile(new URL('browser-after.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify({ao:result.ao}));
} finally {await browser.close();}
