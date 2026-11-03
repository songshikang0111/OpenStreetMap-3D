import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectFixture} from '../../../../test/helpers/project-style.js';
import {patchProject} from '../../../../src/cli/project.js';
import {openLocalBrowser} from '../../../../src/cli/browser-session.js';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../../..');
const root=path.join(repo,'work',`style-remediation-${Date.now()}`);await mkdir(root,{recursive:true});
const style=await projectFixture(root);
const command=args=>{const result=execFileSync(process.execPath,[path.join(repo,'bin/city.js'),...args],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']});const json=JSON.parse(result);assert.equal(json.status,'succeeded');return {args,result:json};};
const cli=[command(['build','--project',root,'--offline','--json']),command(['export','web','--project',root,'--output','exports/nonroot/city','--offline','--json'])];
const browser=await openLocalBrowser({root,startPath:'exports/nonroot/city/index.html',width:960,height:640});
const styles=[];
try{
  await browser.evaluate(`(async()=>{const end=performance.now()+45000;while(!globalThis.cityViewer){if(globalThis.cityViewerError)throw Error(cityViewerError);if(performance.now()>end)throw Error('Viewer timeout');await new Promise(r=>setTimeout(r,40));}await cityViewer.whenIdle();await globalThis.styleAssetPromise;})()`);
  const environment=await browser.evaluate(`(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,webgl:gl.getParameter(gl.VERSION),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:[innerWidth,innerHeight],assetOK:globalThis.styleAssetOK,css:getComputedStyle(document.documentElement).getPropertyValue('--project-style-loaded').trim(),savedParameters:globalThis.savedStyleParameters};})()`);
  assert.equal(environment.assetOK,true);assert.equal(environment.css,'yes');assert.equal(environment.savedParameters.warmth,.23);
  for(const id of ['comic','line','color','white','project-sepia']){
    const result=await browser.evaluate(`(async()=>{const select=document.getElementById('style');select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,350));await cityViewer.whenIdle();return {id:select.value,triangles:cityViewer.getStats().rendering.triangles,diagnostics:cityViewer.getStats().diagnostics,parameters:globalThis.savedStyleParameters};})()`);
    assert.equal(result.id,id);assert(!result.diagnostics.some(d=>d.code==='STYLE_BIND_FAILED'));
    styles.push(result);const shot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(here,`${id}.png`),Buffer.from(shot.data,'base64'));
  }
  await browser.send('Page.reload',{ignoreCache:true});
  await browser.evaluate(`(async()=>{const end=performance.now()+45000;while(!globalThis.cityViewer){if(globalThis.cityViewerError)throw Error(cityViewerError);if(performance.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,40));}await cityViewer.whenIdle();await styleAssetPromise;})()`);
  assert.equal(await browser.evaluate('globalThis.savedStyleParameters.warmth'),.23);
  const cssLifecycle=await browser.evaluate(`(async()=>{const api=await import(new URL('./assets/city-ink.js',document.baseURI));const config=await (await fetch('./viewer-config.json')).json();const baseline=document.querySelectorAll('link[rel=stylesheet]').length;const counts=[];for(let i=0;i<5;i++){const loaded=await api.loadProjectStyle(config.style,{module:config.styleModule,baseUrl:document.baseURI});counts.push(document.querySelectorAll('link[rel=stylesheet]').length);loaded.dispose();counts.push(document.querySelectorAll('link[rel=stylesheet]').length);}return {baseline,counts};})()`);
  assert(cssLifecycle.counts.every((count,index)=>count===cssLifecycle.baseline+(index%2===0?1:0)));
  assert.equal(browser.network.filter(r=>!r.allowed).length,0);
  assert.equal(browser.events.filter(e=>e.level==='error').length,0,JSON.stringify(browser.events));
  const exports=[];
  // These use the real viewer loaded by standard CLI export, not a hand-written consumer.
  for(const format of ['png','glb']){
    const signature=await browser.evaluate(`(async()=>{const r=await cityViewer.${format==='png'?'exportPNG({width:640,height:360})':"exportGLB({scope:'complete'})"};const a=new Uint8Array(await r.blob.arrayBuffer());return {bytes:a.length,signature:[...a.slice(0,8)],scope:r.scope};})()`);
    assert(signature.bytes>100);exports.push({format,...signature});
  }
  await writeFile(path.join(here,'browser-results.json'),JSON.stringify({date:'2026-11-03',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),projectRoot:root,source:'Explicit synthetic offline sample; project-owned sepia + relative palette/CSS/SVG + mapped local dependency',standardCLI:cli,configStyle:style,environment,styles,exports,cssLifecycle,errors:browser.events,networkPolicy:browser.networkPolicy,network:browser.network,nonRootPath:'/exports/nonroot/city/index.html',scope:'Functional static export only; no GPU benchmark'},null,2));
}finally{await browser.close();}
// Also exercise the public CLI PNG/GLB adapter, which calls the same exporter/loader.
for(const format of ['png','glb'])cli.push(command(['export',format,'--project',root,'--offline','--json']));
const old=await readFile(path.join(root,'exports/nonroot/city/viewer-config.json'));
await patchProject(root,{style:{id:'unknown-project-style',parameters:{}}});
let failed;try{command(['export','web','--project',root,'--output','exports/nonroot/city','--json']);}catch(error){failed=JSON.parse(error.stdout.toString());}
assert.equal(failed.status,'failed');assert.equal(failed.diagnostics[0].code,'STYLE_ENTRY_REQUIRED');
assert((await readFile(path.join(root,'exports/nonroot/city/viewer-config.json'))).equals(old));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(here,'cli-results.json'),JSON.stringify({date:'2026-11-03',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),cli,failure:failed,oldSiteRetained:true,png:{hash:hash(await readFile(path.join(root,'exports/city.png')))},glb:{hash:hash(await readFile(path.join(root,'exports/city.glb')))}},null,2));
console.log(JSON.stringify({status:'pass',styles:styles.map(s=>s.id),offlineNonRoot:true,cliFormats:['web','png','glb'],oldSiteRetained:true}));
