// Public SDK + real, unchanged legacy CINK assets; count actual attached meshes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const base=process.env.RUNTIME_BASE || 'http://127.0.0.1:5184',out=new URL('./',import.meta.url);
const previous=JSON.parse(await fs.readFile(new URL('../browser-after.json',import.meta.url))),view=previous.cases.find(c=>c.pose.t===13).pose.view;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/宋世康/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',args:['--ignore-gpu-blocklist','--disable-background-timer-throttling']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>console.error(e.message));await page.goto(`${base}/docs/phase1-evidence/remediation/runtime/harness.html`);
 const output={productCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browserVersion:browser.version(),view,mode:'Real public SDK, real Beijing grow1 CINK, no geometry changes. Short budget correctness checks, not a GPU performance benchmark.',cases:[]};
 for(const mode of ['legacy','derived-optional-counts'])for(const limit of mode==='legacy'?[420,400,0,18000]:[420,400]){
  const result=await page.evaluate(async({limit,view,mode})=>{
   const {createCityViewer}=await import('/src/sdk/index.js'),{loadDefaultAdapters}=await import('/src/runtime/integrations.js'),adapters=await loadDefaultAdapters();
   let scene,gpu;const requests=[],decoded=[];
   function count(group){let units=0;if(group)group.traverseVisible(o=>{if(o.isMesh&&o.geometry?.attributes.position&&['detail','near'].includes(o.userData.city?.lodRole))units+=o.isInstancedMesh?o.count:1;});return units;}
   const instrumented={...adapters,decodeChunk:async(bytes,lod)=>{const group=await adapters.decodeChunk(bytes,lod);decoded.push({id:lod.id,level:lod.level,count:count(group)});return group;},styleApi:{...adapters.styleApi,createStylePipeline(args){scene=args.scene;const gl=args.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return adapters.styleApi.createStylePipeline(args);}}};
   const readAsset=async(url,{signal,responseType})=>{const event={url,aborted:false};requests.push(event);signal?.addEventListener('abort',()=>{event.aborted=true;},{once:true});const response=await fetch(url,{signal});if(!response.ok)throw Error(response.status);const value=await response[responseType==='json'?'json':'arrayBuffer']();if(responseType==='json'&&mode==='derived-optional-counts')for(const chunk of value.chunks)for(const lod of chunk.lods)lod.nearDetails=lod.id==='high'?410:0;return value;};
   const viewer=await createCityViewer({container:document.querySelector('#stage'),budget:{nearDetails:limit},adapters:instrumented,readAsset});
   await viewer.load('/work/integration-scenes/beijing-cbd-grow-1/manifest.json',{view});
   const frames=[];let stop=false;const started=performance.now();
   function sample(){if(stop)return;let main,near;scene.traverse(o=>{if(o.name==='City Ink streamed chunks')main=o;if(o.name==='Budgeted near attachments')near=o;});const s=viewer.getStats(),body=count(main),attachments=count(near);frames.push({time:performance.now()-started,body,attachments,total:body+attachments,runtimeBody:s.runtime.nearDetails,frameCostBody:s.runtime.frameCost.nearDetails,runtimeAttachments:s.nearAttachments.nearDetails,levels:s.runtime.currentLods,desired:s.runtime.desiredLods,loads:s.runtime.loads,swaps:s.runtime.swaps,cancelled:s.runtime.cancelled,missing:s.runtime.missingChunks,estimatedResidentBytes:s.runtime.estimatedResidentBytes,frame:s.rendering.last});requestAnimationFrame(sample);}sample();
   await new Promise(r=>setTimeout(r,2200));await viewer.whenIdle();stop=true;const stationary=viewer.getStats();
   viewer.setView({position:[5000,5000,5000],target:[7000,7000,7000]});await new Promise(r=>setTimeout(r,1350));const away=viewer.getStats();viewer.setView(view);await viewer.whenIdle();await new Promise(requestAnimationFrame);const returned=viewer.getStats();await viewer.dispose();const disposed=viewer.getStats();
   return{mode,limit,gpu,decoded,requests,frames,stationary,away,returned,disposed};
  },{limit,view,mode});
  result.summary={mode,limit,frames:result.frames.length,maxMain:Math.max(...result.frames.map(f=>f.body)),maxAttachments:Math.max(...result.frames.map(f=>f.attachments)),maxTotal:Math.max(...result.frames.map(f=>f.total)),overFrames:result.frames.filter(f=>f.total>limit).length,measurementMismatchFrames:result.frames.filter(f=>f.body!==f.runtimeBody||f.body!==f.frameCostBody||f.attachments!==f.runtimeAttachments).length,maxTriangles:Math.max(0,...result.frames.map(f=>f.frame.triangles||0)),maxDrawCalls:Math.max(0,...result.frames.map(f=>f.frame.drawCalls||0)),missingAfterMountFrames:result.frames.filter(f=>f.levels.length&&f.missing.length).length,finalTotal:result.stationary.runtime.nearDetails+result.stationary.nearAttachments.nearDetails,finalLods:result.stationary.runtime.currentLods,cancelled:result.stationary.runtime.cancelled,loads:result.stationary.runtime.loads,swaps:result.stationary.runtime.swaps,awayResidentBytes:result.away.runtime.estimatedResidentBytes,disposedResidentBytes:result.disposed.runtime.estimatedResidentBytes};
  output.cases.push(result);await fs.writeFile(new URL('after.json',out),JSON.stringify(output,null,2));console.log(JSON.stringify(result.summary));
  assert.equal(result.summary.overFrames,0);assert.equal(result.summary.measurementMismatchFrames,0);assert.equal(result.summary.missingAfterMountFrames,0);assert(result.summary.maxTriangles<=600000);assert(result.summary.maxDrawCalls<=1200);assert.equal(result.summary.awayResidentBytes,0);assert.equal(result.summary.disposedResidentBytes,0);assert.equal(result.disposed.nearAttachments.nearDetails,0);
  if(limit===420){assert.equal(result.stationary.runtime.nearDetails,410);assert(result.stationary.nearAttachments.nearDetails<=10);assert.equal(result.stationary.runtime.currentLods[0].index,0);}
  if(limit<410){assert.equal(result.stationary.runtime.nearDetails,0);assert.equal(result.stationary.nearAttachments.nearDetails,0);assert(result.stationary.runtime.currentLods[0].index>0);}
  if(limit===18000){assert.equal(result.stationary.runtime.nearDetails,410);assert(result.stationary.nearAttachments.nearDetails>0);}
  assert.equal(result.returned.runtime.nearDetails+result.returned.nearAttachments.nearDetails,result.summary.finalTotal);
 }
}finally{await browser.close();}
