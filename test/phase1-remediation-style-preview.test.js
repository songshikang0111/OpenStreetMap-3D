import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {projectFixture} from './helpers/project-style.js';
import {prepareProjectStyle,projectStyleCachePath} from '../src/local-server/project-styles.js';
import {createLocalServer} from '../src/local-server/index.js';

test('studio preview uses the real declared style bundle and immutable local assets',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-studio-style-'));
  try{
    const style=await projectFixture(root),preview=await prepareProjectStyle(root,'p1',style);
    assert.equal(preview.style.id,'project-sepia');assert.equal(preview.style.parameters.warmth,.23);
    assert.match(preview.sdkUrl,/^\/projects\/p1\/style-preview\/[a-f0-9]{64}\/assets\/city-ink\.js$/);
    assert.ok(preview.styleModule.stylesheets.length>0);
    const sdk=await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'assets/city-ink.js')));
    const manifest=JSON.parse(await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'preview.json')),'utf8'));
    assert.equal(manifest.sdkUrl,preview.sdkUrl);assert.ok(sdk.length>0);
    const changed=await prepareProjectStyle(root,'p1',{...style,parameters:{warmth:.42}});
    assert.equal(changed.style.parameters.warmth,.42);
    await assert.rejects(prepareProjectStyle(root,'p1',{...style,entry:'../escape.js'}));
    assert.deepEqual(await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'assets/city-ink.js'))),sdk);
    assert.throws(()=>projectStyleCachePath('../escape','x.js'));
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'city-studio-style-')));await rm(root,{recursive:true,force:true});}
});

test('real local API validates project styles and serves their own SDK/CSS/assets inside the cache boundary',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-studio-style-api-'));let server,release;
  try{
    const style=await projectFixture(root,{assetName:'paper #1%25.svg'}),configBefore=await readFile(path.join(root,'city.config.json'));
    const gate=new Promise(resolve=>release=resolve);
    server=await createLocalServer({projectRoot:root,sample:false,port:0,runner:async()=>{await gate;return{artifacts:[],diagnostics:[]};}});
    const request=async(route,value)=>fetch(new URL(route,server.url),value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    const id=[...server.projects.keys()][0],route=`/api/projects/${id}/style-preview`;
    const response=await request(route,{});assert.equal(response.status,200);const {preview}=await response.json();
    assert.equal(preview.style.id,style.id);assert.equal(preview.style.parameters.warmth,.23);
    for(const file of preview.report.files){const asset=await request(preview.baseUrl+file.split('/').map(encodeURIComponent).join('/'));assert.equal(asset.status,200,file);assert.ok((await asset.arrayBuffer()).byteLength>0);assert.doesNotMatch(asset.headers.get('Cache-Control'),/immutable/);}
    const metadata=await request(preview.baseUrl+'preview.json');assert.equal(metadata.status,200);assert.doesNotMatch(metadata.headers.get('Cache-Control'),/immutable/);
    const changed=await request(route,{style:{...style,parameters:{warmth:.42}}});assert.equal((await changed.json()).preview.style.parameters.warmth,.42);
    assert.deepEqual(await readFile(path.join(root,'city.config.json')),configBefore,'preview does not silently save a project');
    for(const value of [{style:null},{style:[]},{style:{...style,entry:'styles/missing.js'}},{style:{...style,entry:'../escape.js'}},{unexpected:true}])assert.equal((await request(route,value)).status,400);
    assert.equal((await request(preview.sdkUrl)).status,200,'failed validation preserves previous SDK');
    assert.equal((await request(`/projects/${id}/style-preview/${preview.report.hash}/%2e%2e%2fcity.config.json`)).status,403);
    const job=await request(`/api/projects/${id}/jobs`,{kind:'build'});assert.equal(job.status,202);assert.equal((await request(route,{})).status,409);
  }finally{release?.();await server?.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'city-studio-style-api-')));await rm(root,{recursive:true,force:true});}
});
