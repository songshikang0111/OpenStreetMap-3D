import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const directory=path.resolve('work/runtime-embed'),prefix='/nested/demo/',output=path.resolve(process.argv[2]||'docs/phase1-evidence/runtime/embed');
await fs.mkdir(output,{recursive:true});
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
    const file=path.resolve(directory,decodeURIComponent(url.pathname.slice(prefix.length)));if(!file.startsWith(directory+path.sep)){res.writeHead(403);res.end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.cink':'application/octet-stream','.css':'text/css'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CITY_BENCHMARK_BROWSER?{executablePath:process.env.CITY_BENCHMARK_BROWSER}:{})});
const page=await browser.newPage({viewport:{width:1280,height:794},deviceScaleFactor:1}),errors=[],external=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
try {
  const url=`${origin}${prefix}examples/embed/index.html?manifest=../scenes/core-synthetic-fixed-4/manifest.json`;
  await page.goto(url);await page.waitForFunction(()=>globalThis.viewer||globalThis.startError);assert.equal(await page.evaluate(()=>globalThis.startError),undefined);
  await page.evaluate(()=>{viewer.setLodMode('full');viewer.setView({position:[0,20,55],target:[0,20,0],fov:45});});await page.evaluate(()=>viewer.whenIdle());await page.waitForTimeout(250);
  const initial=await page.evaluate(()=>viewer.getStats());assert(initial.nearAttachments.frames>0,'Near facade frame grammar did not return');
  await page.screenshot({path:path.join(output,'near-frames.png')});
  await page.mouse.click(640,360);const selectionHigh=await page.evaluate(()=>globalThis.lastSelection);assert(selectionHigh?.featureId,'No stable feature selected');
  await page.evaluate(()=>viewer.setLodMode('far'));await page.evaluate(()=>viewer.whenIdle());await page.waitForTimeout(500);await page.mouse.click(640,360);const selectionFar=await page.evaluate(()=>globalThis.lastSelection);assert.equal(selectionFar?.featureId,selectionHigh.featureId);
  const styles=[];
  for(const style of ['line','color','white','comic']){await page.evaluate(style=>viewer.setStyle(style),style);await page.waitForTimeout(200);styles.push({style,stats:await page.evaluate(()=>viewer.getStats())});await page.screenshot({path:path.join(output,`${style}.png`)});}
  await page.evaluate(()=>viewer.setStyle({schemaVersion:1,id:'external-test',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,parametersSchema:{type:'object',additionalProperties:false,properties:{}},materialRoles:['wall','glass','roof','structure','road','water','foliage','ground','facility','landmark'],fallbackRole:'facility',rebuildParameters:[],qualityHints:{pixelRatio:1},createMaterial({sourceMaterial}){const material=sourceMaterial.clone();material.color?.set('#c18c55');return material;},createPipeline({renderer,scene,camera}){return {render(){renderer.render(scene,camera);},resize(){},dispose(){}};},dispose(){}}));await page.waitForTimeout(200);
  const externalStyle=await page.evaluate(()=>viewer.getStats());await page.screenshot({path:path.join(output,'external-style.png')});
  let unknownRejected=false;try{await page.evaluate(()=>viewer.setStyle('missing-style'));}catch{unknownRejected=true;}assert(unknownRejected);await page.evaluate(()=>viewer.setStyle('comic'));
  const exports=await page.evaluate(async()=>{let rejected=false;try{await viewer.exportGLB();}catch(e){rejected=e.code==='EXPORT_SCOPE_REQUIRED';}const before=viewer.getStats().viewport,png=await viewer.exportPNG({width:1600,height:900}),glb=await viewer.exportGLB({scope:'complete'}),header=new DataView(await glb.blob.arrayBuffer()).getUint32(0,true);return {rejected,png:{bytes:png.blob.size,attribution:png.attribution,scope:png.scope},glb:{bytes:glb.blob.size,chunkIds:glb.chunkIds,limitations:glb.limitations,magic:header},before,after:viewer.getStats().viewport};});
  assert(exports.rejected);assert.equal(exports.glb.magic,0x46546c67);assert.equal(exports.glb.chunkIds.length,4);assert.match(exports.png.attribution,/OpenStreetMap/);assert.deepEqual(exports.before,exports.after);
  const cycles=[],reloads=[];
  for(let i=0;i<5;i++){
    await page.evaluate(()=>{viewer.setLodMode('full');viewer.setView({position:[0,20,55],target:[0,20,0]});});await page.evaluate(()=>viewer.whenIdle());await page.waitForTimeout(250);const near=await page.evaluate(()=>viewer.getStats());
    await page.evaluate(()=>viewer.setView({position:[5000,500,5000],target:[9000,500,9000]}));await page.waitForTimeout(700);const away=await page.evaluate(()=>viewer.getStats());assert.equal(away.runtime.geometries,0);assert.equal(away.nearAttachments.geometries,0);cycles.push({cycle:i,near,away});
    await page.evaluate(()=>viewer.load(undefined,{view:{position:[0,20,55],target:[0,20,0]}}));await page.evaluate(()=>viewer.whenIdle());await page.waitForTimeout(250);reloads.push(await page.evaluate(()=>viewer.getStats()));
  }
  assert(cycles.every(c=>c.near.runtime.geometryArrayBytes===cycles[0].near.runtime.geometryArrayBytes));assert(reloads.every(s=>s.runtime.geometryArrayBytes===reloads[0].runtime.geometryArrayBytes));
  await page.evaluate(()=>viewer.dispose());await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('canvas').count(),0);assert.equal(external.length,0);assert.equal(errors.length,0);
  const report={date:new Date().toISOString(),url,entry:'Vite production bundle served beneath /nested/demo with all non-local requests blocked',browser:browser.version(),initial,selectionHigh,selectionFar,styles,externalStyle,exports,cycles,reloads,errors,external,requests,checks:{independentStaticSDK:true,nonRootPath:true,noExternalRuntime:true,nearFramesRestored:true,stableSelectionAcrossLOD:true,officialAndExternalStyles:true,attributedPNG:true,completeGLB:true,repeatedLifecycle:true,idempotentDispose:true}};
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report));console.log(JSON.stringify(report.checks));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
