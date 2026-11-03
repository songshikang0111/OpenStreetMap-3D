import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {openLocalBrowser} from '../../src/cli/browser-session.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.dirname(fileURLToPath(import.meta.url)),images=path.join(directory,'screenshots');await mkdir(images,{recursive:true});
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,results:[]};
let browser;
async function ready(expression){const deadline=Date.now()+90000;while(Date.now()<deadline){if(await browser.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Readiness timeout: '+expression);}
async function screenshot(name,clip){const result=await browser.send('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})});await writeFile(path.join(images,name),Buffer.from(result.data,'base64'));return path.join(images,name);}
async function check(name,operation){try{const details=await operation();report.results.push({name,status:'pass',details});console.log(JSON.stringify({name,status:'pass'}));}catch(error){report.results.push({name,status:'fail',error:error.stack});console.error(JSON.stringify({name,status:'fail',error:error.message}));}await writeFile(path.join(directory,'browser-results.json'),JSON.stringify(report,null,2));}
async function close(){await browser?.close();browser=null;}
try{
await check('independent installed-package SDK / nested static / outside network denied / four official and tutorial external style',async()=>{
 browser=await openLocalBrowser({root,startPath:'work/independent-studio-review/consumer/app/index.html',width:1280,height:720});
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.reviewBlocked=[];const original=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,...rest)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==location.origin){reviewBlocked.push(url.href);throw new Error('External network denied');}return original(input,...rest);};`});
 await browser.send('Page.enable');await browser.send('Page.reload',{ignoreCache:true});await ready('Array.isArray(globalThis.reviewBlocked) && globalThis.reviewReady===true');
 const styles=[];for(const style of ['comic','line','color','white','project-sepia']){const stats=await browser.evaluate(`(async()=>{await viewer.setStyle(${JSON.stringify(style)});await viewer.whenIdle();await new Promise(r=>setTimeout(r,120));return viewer.getStats();})()`);styles.push({style,stats,screenshot:await screenshot('external-'+style+'.png')});}
 const rounds=[];for(let cycle=0;cycle<5;cycle++){rounds.push(await browser.evaluate(`(async()=>{for(const style of ['line','color','white','project-sepia','comic'])await viewer.setStyle(style);await viewer.whenIdle();await new Promise(r=>setTimeout(r,120));return viewer.getStats();})()`));}
 const network=await browser.evaluate('({blocked:reviewBlocked,resources:performance.getEntriesByType("resource").map(entry=>entry.name),origin:location.origin,diagnostics:events})');assert.deepEqual(network.blocked,[]);assert.ok(network.resources.every(url=>new URL(url).origin===network.origin));assert.ok(!network.diagnostics.some(d=>/FAILED|INVALID/.test(d.code)));
 const stable=rounds.map(stats=>({geometries:stats.rendering.last.rendererGeometries,textures:stats.rendering.last.rendererTextures,bytes:stats.runtime.estimatedResidentBytes}));assert.deepEqual(stable.at(-1),stable[0]);
 const png=await browser.evaluate(`(async()=>{const result=await viewer.exportPNG({width:1280,height:720});const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(result.blob);});return {data,scope:result.scope,attribution:result.attribution,loadedChunkIds:result.loadedChunkIds};})()`);const bytes=Buffer.from(png.data,'base64');await writeFile(path.join(images,'sdk-attributed-export.png'),bytes);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');delete png.data;assert.match(png.attribution,/openstreetmap.org\/copyright/);
 await close();return {styles,cycles:stable,network,png};
});
await close();
await check('real OSM China Zun / complete GLB from unloaded view / finite output and all manifest chunks',async()=>{
 browser=await openLocalBrowser({root,startPath:'work/independent-studio-review/sdk-reference.html',width:1280,height:720});await ready('globalThis.reviewReferenceReady===true');await browser.evaluate("startReference('./consumer/real-zun/dist/manifest.json',{comparison:true})");
 const exact=await browser.evaluate("(()=>{const requested={position:[50,12,100],target:[0,18,0],fov:55};viewer.setView(requested);return {requested,actual:viewer.getView()};})()");assert.ok(exact.requested.position.every((value,i)=>Math.abs(value-exact.actual.position[i])<1e-6),'setView silently changed street camera');
 await browser.evaluate("(async()=>{viewer.setView({position:[10000,100,10000],target:[11000,100,11000]});await new Promise(r=>setTimeout(r,1800));await viewer.whenIdle();})()");
 const before=await browser.evaluate('viewer.getStats()');assert.equal(before.runtime.currentChunks,0);
 const exported=await browser.evaluate(`(async()=>{const result=await viewer.exportGLB({scope:'complete'});const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(result.blob);});return {data,scope:result.scope,chunkIds:result.chunkIds,limitations:result.limitations,attribution:result.attribution};})()`);
 const bytes=Buffer.from(exported.data,'base64');delete exported.data;assert.equal(bytes.subarray(0,4).toString(),'glTF');const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());
 const manifest=JSON.parse(await readFile(path.join(directory,'consumer/real-zun/dist/manifest.json')));assert.deepEqual(exported.chunkIds,manifest.chunks.map(chunk=>chunk.id));assert.ok(json.meshes?.length);assert.ok(json.nodes?.some(node=>node.extras?.scope==='complete'));await writeFile(path.join(directory,'complete-unloaded-real.glb'),bytes);
 const refused=await browser.evaluate("(async()=>{try{await viewer.exportGLB({scope:'complete',maxBytes:1});return null;}catch(error){return {code:error.code,message:error.message};}})()");assert.equal(refused.code,'EXPORT_RESOURCE_BUDGET');await close();return {before,exact,exported,bytes:bytes.length,meshCount:json.meshes.length,refused};
});
await close();
await check('old demo and same-input four-chunk SDK / Beijing key viewpoints',async()=>{
 const input=JSON.parse(await readFile(path.join(directory,'beijing-views.json'))),pairs=[];
 browser=await openLocalBrowser({root:path.join(root,'dist'),width:1600,height:1000});await ready('document.getElementById("loading")?.hidden===true');
 const viewport=await browser.evaluate('(()=>{const r=document.querySelector("#viewport canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()');
 for(const [name,view]of Object.entries(input.views)){
  if(['overview','crossing'].includes(name))await browser.evaluate(`document.querySelector('[data-camera="${name==='crossing'?'street':name}"]').click()`);
  if(['citic','cctv','crossing'].includes(name))await browser.evaluate(`(()=>{const select=document.getElementById('detail-view');select.value=${JSON.stringify(name)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await new Promise(resolve=>setTimeout(resolve,250));const readout=await browser.evaluate('document.getElementById("camera-readout").textContent');pairs.push({name,requested:view,oldReadout:readout,oldScreenshot:await screenshot('beijing-old-'+name+'.png',viewport)});
 }
 const oldStats=await browser.evaluate('({buildings:document.getElementById("stat-buildings").textContent,roads:document.getElementById("stat-roads").textContent})');await close();
 browser=await openLocalBrowser({root,startPath:'work/independent-studio-review/sdk-reference.html',width:Math.round(viewport.width),height:Math.round(viewport.height)});await ready('globalThis.reviewReferenceReady===true');await browser.evaluate("startReference('./beijing-visual/dist/manifest.json',{comparison:true})");
 for(const pair of pairs){await browser.evaluate(`(async()=>{viewer.setView(${JSON.stringify(pair.requested)});await viewer.whenIdle({timeoutMs:90000});await new Promise(r=>setTimeout(r,300));})()`);pair.actual=await browser.evaluate('viewer.getView()');assert.ok(pair.requested.position.every((value,i)=>Math.abs(value-pair.actual.position[i])<1e-5),'Key camera changed');pair.stats=await browser.evaluate('viewer.getStats()');assert.deepEqual(pair.stats.runtime.missingChunks,[]);pair.sdkScreenshot=await screenshot('beijing-sdk-'+pair.name+'.png');}
 const diagnostics=await browser.evaluate('reviewDiagnostics');await close();return {input,viewport,oldStats,pairs,diagnostics,note:'Full-detail visual reference uses an explicit 512 MiB / 20M triangles / 100000 draws comparison budget. It is not a default-budget performance pass; SDK lighting differs from the old demo.'};
});
}finally{await close();report.status=report.results.every(result=>result.status==='pass')?'pass':'fail';await writeFile(path.join(directory,'browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,directory}));process.exitCode=report.status==='pass'?0:1;}
