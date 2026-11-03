import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const base=process.env.RUNTIME_BASE || 'http://127.0.0.1:5184',out=new URL('./',import.meta.url);
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/宋世康/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',args:['--ignore-gpu-blocklist','--disable-background-timer-throttling']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>console.error(e.message));await page.goto(`${base}/docs/phase1-evidence/remediation/runtime/harness.html`);
 const result=await page.evaluate(async()=>{
  const {createCityViewer}=await import('/src/sdk/index.js'),{loadDefaultAdapters}=await import('/src/runtime/integrations.js'),adapters=await loadDefaultAdapters(),raw=await(await fetch('/docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json')).json();
  const manifestUrl='/work/integration-scenes/beijing-cbd-grow-1/manifest.json',container=document.querySelector('#stage'),wait=ms=>new Promise(r=>setTimeout(r,ms)),raf=()=>new Promise(requestAnimationFrame),keys=raw.path.keys;
  const view=t=>{const i=keys.findIndex((k,i)=>i<keys.length-1&&t>=k.t&&t<=keys[i+1].t),a=keys[i],b=keys[i+1],u=(t-a.t)/(b.t-a.t),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*u);return{position:mix(a.position,b.position),target:mix(a.target,b.target),fov:a.fov+(b.fov-a.fov)*u};};
  const viewer=await createCityViewer({container});await viewer.load(manifestUrl,{view:view(13)});await viewer.whenIdle();viewer.resetStats();
  const motion=[];
  for(let i=0;i<360;i++){const pose=view([10,13,19,37][Math.floor(i/3)%4]);pose.fov+=Math.sin(i)*.1;viewer.setView(pose);await raf();const s=viewer.getStats();motion.push({i,view:viewer.getView(),frame:s.rendering.last,body:s.runtime.frameCost,current:s.runtime.currentLods,desired:s.runtime.desiredLods,missing:s.runtime.missingChunks,near:s.nearAttachments.nearDetails,cancelled:s.runtime.cancelled});}
  await viewer.whenIdle();const rounds=[];
  for(let i=0;i<5;i++){viewer.setView({position:[5000,5000,5000],target:[7000,7000,7000]});await wait(1350);const away=viewer.getStats();viewer.setView(view(13));await viewer.whenIdle();await raf();const near=viewer.getStats();rounds.push({away:away.runtime,near:near.runtime,attachments:near.nearAttachments});}
  viewer.setLodMode('far');await viewer.whenIdle();const far=viewer.getStats().runtime;viewer.setLodMode('full');await viewer.whenIdle();const full=viewer.getStats().runtime;viewer.setLodMode('auto');await viewer.whenIdle();
  const loaded=await viewer.exportGLB({scope:'loaded'}),complete=await viewer.exportGLB({scope:'complete'});const exports={loaded:{bytes:loaded.blob.size,scope:loaded.scope},complete:{bytes:complete.blob.size,scope:complete.scope}};
  await viewer.dispose();const disposed=viewer.getStats();
  const ao=[],images=[];
  for(const quality of ['balanced','low']){
   let ink;const api={...adapters.styleApi,createStylePipeline(args){const p=adapters.styleApi.createStylePipeline(args);ink=p.ink;return p;}};
   const v=await createCityViewer({container,quality,adapters:{...adapters,styleApi:api}});await v.load(manifestUrl,{view:view(13)});await v.whenIdle();v.pause();
   for(const strength of [0,.12,.9]){
    const saved=JSON.parse(JSON.stringify({id:'comic',parameters:{aoStrength:strength}}));await v.setStyle(saved);const png=await v.exportPNG({width:640,height:360}),bitmap=await createImageBitmap(png.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(x=>x.toString(16).padStart(2,'0')).join('');bitmap.close();
    ao.push({quality,requested:strength,configured:ink.material.uniforms.aoStrength.value,enabled:ink.aoEnabled,effective:ink.aoEnabled?ink.material.uniforms.aoStrength.value:0,pixelHash:hash});
    if(strength===0||strength===.9)images.push({name:`ao-${quality}-${strength}.png`,bytes:[...new Uint8Array(await png.blob.arrayBuffer())]});
   }
   await v.dispose();
  }
  return {motion,rounds,far,full,exports,disposed,ao,images};
 });
 for(const image of result.images)await fs.writeFile(new URL(image.name,out),new Uint8Array(image.bytes));delete result.images;
 result.summary={motionFrames:result.motion.length,maxTriangles:Math.max(...result.motion.map(f=>f.frame.triangles)),maxDrawCalls:Math.max(...result.motion.map(f=>f.frame.drawCalls)),overFrames:result.motion.filter(f=>f.frame.triangles>600000||f.frame.drawCalls>1200).length,missingFrames:result.motion.filter(f=>f.missing.length).length,roundResidentBytes:result.rounds.map(r=>r.near.estimatedResidentBytes),awayResidentBytes:result.rounds.map(r=>r.away.estimatedResidentBytes),disposedResidentBytes:result.disposed.runtime.estimatedResidentBytes};
 result.productCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 await fs.writeFile(new URL('motion-ao.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify({summary:result.summary,ao:result.ao,exports:result.exports}));
 assert.equal(result.summary.overFrames,0);assert.equal(result.summary.missingFrames,0);assert(result.summary.roundResidentBytes.every(n=>n===result.summary.roundResidentBytes[0]));assert(result.summary.awayResidentBytes.every(n=>n===0));assert.equal(result.summary.disposedResidentBytes,0);
 const balanced=result.ao.filter(r=>r.quality==='balanced'),low=result.ao.filter(r=>r.quality==='low');assert.equal(new Set(balanced.map(r=>r.pixelHash)).size,3);assert.equal(new Set(low.map(r=>r.pixelHash)).size,1);assert(result.ao.every(r=>r.requested===r.configured));assert(low.every(r=>!r.enabled&&r.effective===0));
}finally{await browser.close();}
