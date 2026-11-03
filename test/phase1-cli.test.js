import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProject, SAMPLE_AREA } from '../src/cli/project.js';
import { atomicWrite, readJSON, safePath } from '../src/data/common.js';
import { buildProject, validateProject } from '../src/cli/tasks.js';
import { JobManager, requestJobCancel } from '../src/cli/jobs.js';
import { updateLandmarks } from '../src/cli/landmarks.js';
import { runCLI, runBatch, exitCode } from '../src/cli/index.js';
import { createLocalServer } from '../src/local-server/index.js';

const temp=()=>mkdtemp(path.join(os.tmpdir(),'city-cli-test-'));
const fixtureCore={validateProjectConfig:()=>true,validateSceneManifest:m=>m.schemaVersion===1,compileScene:async(raw,config,{signal,onProgress})=>{signal?.throwIfAborted();onProgress({stage:'geometry',progress:0.5});return {manifest:{schemaVersion:1,chunks:[],origin:config.origin},assets:{'chunks/a.json':JSON.stringify({seed:config.seed,ids:raw.elements.map(e=>e.id)})},report:{diagnostics:[]}};}};
test('build uses the injected compileScene contract, deterministic hashes, validation and cancellation preserve prior output',async()=>{
  const root=await temp();await createProject(root,{sample:true});
  const first=await buildProject(root,{core:fixtureCore});const second=await buildProject(root,{core:fixtureCore});assert.equal(first.contentHash,second.contentHash);await validateProject(root,{core:fixtureCore});
  const old=await readFile(path.join(root,'dist/manifest.json'),'utf8');
  const c=new AbortController();await assert.rejects(buildProject(root,{core:{...fixtureCore,compileScene:async()=>{c.abort();return fixtureCore.compileScene({}, {}, {signal:c.signal,onProgress:()=>{}});}},signal:c.signal}));
  assert.equal(await readFile(path.join(root,'dist/manifest.json'),'utf8'),old);
  await atomicWrite(path.join(root,'dist/chunks/a.json'),'corrupt');await assert.rejects(validateProject(root,{core:fixtureCore}),e=>e.code==='CORRUPT_ASSET');
});
test('compiler path traversal cannot publish files outside the staging root',async()=>{
  const root=await temp();await createProject(root,{sample:true});
  await assert.rejects(buildProject(root,{core:{...fixtureCore,compileScene:async()=>({manifest:{schemaVersion:1},assets:{'../escape':'bad'}})}}),e=>e.code==='PATH_ESCAPE');
});
test('job queue persists cancellation and retries interrupted/failed entries without rerunning successes',async()=>{
  const directory=await temp();let running=0,max=0;const attempts=new Map();
  const runner=async(job,progress,signal)=>{running++;max=Math.max(max,running);try{progress({stage:'compile',progress:0.2});await delay(25,null,{signal});const n=(attempts.get(job.project)||0)+1;attempts.set(job.project,n);if(job.project==='fail'&&n===1)throw new Error('fixture failure');return {status:'succeeded',artifacts:['dist/manifest.json']};}finally{running--;}};
  let manager=await new JobManager({directory,concurrency:2,runner}).open();
  const a=await manager.enqueue('build','one'),b=await manager.enqueue('build','fail'),c=await manager.enqueue('build','cancel');await manager.cancel(c.id);
  assert.equal((await manager.wait(a.id)).status,'succeeded');assert.equal((await manager.wait(b.id)).status,'failed');assert.equal((await manager.wait(c.id)).status,'cancelled');assert.ok(max<=2);await manager.close();
  manager=await new JobManager({directory,runner}).open();await manager.resume(a.id);await manager.resume(b.id);assert.equal((await manager.wait(b.id)).status,'succeeded');assert.equal(attempts.get('one'),1);await manager.close();
  await atomicWrite(path.join(directory,'abcd.json'),{id:'abcd',kind:'build',project:'one',parameters:{},status:'running',diagnostics:[],attempt:1});
  manager=await new JobManager({directory,runner}).open();assert.equal(manager.get('abcd').status,'failed');assert.equal(manager.get('abcd').diagnostics[0].code,'INTERRUPTED');await manager.resume('abcd');assert.equal((await manager.wait('abcd')).status,'succeeded');await manager.close();
});
test('a second queue cannot steal a live process and file cancellation reaches the owner',async()=>{
  const directory=await temp();const manager=await new JobManager({directory,runner:async(job,p,signal)=>{await delay(10000,null,{signal});return {status:'succeeded'};}}).open();
  try{
    await assert.rejects(new JobManager({directory}).open(),e=>e.code==='JOBS_BUSY');
    const job=await manager.enqueue('build','city');await requestJobCancel(directory,job.id);assert.equal((await manager.wait(job.id)).status,'cancelled');
  }finally{await manager.close();}
});
test('batch reports two independent successes and one fault with nonzero exit, resumes only failed item',async()=>{
  const root=await temp();const file=path.join(root,'batch.json');await atomicWrite(file,{projects:['beijing','kyoto','broken']});
  const attempts={};let repaired=false;
  const runner=async job=>{attempts[path.basename(job.project)]=(attempts[path.basename(job.project)]||0)+1;if(job.project.endsWith('broken')&&!repaired)throw new Error('broken input');return {status:'succeeded',artifacts:['dist/manifest.json']};};
  const first=await runBatch(file,{concurrency:2,runner});assert.equal(first.status,'partial');assert.equal(exitCode(first),2);assert.deepEqual(first.jobs.map(j=>j.status),['succeeded','succeeded','failed']);
  repaired=true;const next=await runBatch(file,{resume:true,runner});assert.equal(next.status,'succeeded');assert.deepEqual(attempts,{beijing:1,kyoto:1,broken:2});
});
test('two local declarative recipe versions lock and rollback; incompatible versions fail',async()=>{
  const root=await temp();await createProject(root,{sample:true});
  const base={schemaVersion:1,id:'fixture',generator:'fixture-generator',compatibility:{engine:'^1.0.0'},match:{osm:[{type:'way',id:1}]}};
  for(const version of ['1.0.0','1.1.0']){
    const dir=path.join(root,version);await mkdir(dir);await atomicWrite(path.join(dir,'recipe.json'),{...base,version});await updateLandmarks(root,{packagePath:dir});
  }
  const second=await readJSON(path.join(root,'city.config.json'));assert.equal(second.landmarks.packages[0].recipes[0].version,'1.1.0');
  await updateLandmarks(root,{rollback:true});const restored=await readJSON(path.join(root,'city.config.json'));assert.equal(restored.landmarks.packages[0].recipes[0].version,'1.0.0');assert.ok((await readJSON(path.join(root,'city.lock.json'))).pendingRebuild);
  const bad=path.join(root,'bad');await mkdir(bad);await atomicWrite(path.join(bad,'recipe.json'),{...base,version:'2.0.0',compatibility:{engine:'^2.0.0'}});await assert.rejects(updateLandmarks(root,{packagePath:bad}),e=>e.code==='INCOMPATIBLE_RECIPE');
});
test('CLI outputs one JSON envelope, helpful diagnostics, truthful missing-core failure and documented help',async()=>{
  const root=await temp();let out='',err='';const io={cwd:root,stdout:{write:s=>out+=s},stderr:{write:s=>err+=s}};
  await runCLI(['init','my-city','--sample','--json'],io);assert.equal(JSON.parse(out).status,'succeeded');out='';
  await runCLI(['search','landmark:cctv','--offline','--json'],io);assert.equal(JSON.parse(out).candidates[0].source,'official-landmark-index');out='';
  const help=await runCLI(['export','--help','--json'],io);assert.match(help.help,/export web\|png\|glb/);out='';
  const built=await runCLI(['build','--project','my-city','--offline','--json'],io);assert.equal(built.status,'failed');assert.equal(built.diagnostics[0].code,'CORE_UNAVAILABLE');assert.equal(out.trim().split('\n').length,1);assert.equal(exitCode(built),1);
});
test('localhost HTTP provides real projects/jobs/resources and rejects origin, escape, arbitrary commands and origin drift',async()=>{
  const root=await temp();let live=false;
  const service=await createLocalServer({workspaceRoot:root,port:0,runner:async(job,p,signal)=>{live=true;p({stage:'compile',progress:0.1});await delay(10000,null,{signal});return {status:'succeeded',artifacts:[]};}});
  const get=async route=>(await fetch(service.url+route)).json();
  const post=async(route,value,method='POST')=>fetch(service.url+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  try{
    assert.equal(service.server.address().address,'127.0.0.1');
    const projects=(await get('/api/projects')).projects;assert.equal(projects.length,1);const id=projects[0].id;
    assert.equal((await get('/api/search?q=39.9,116.4&offline=true')).candidates.length,1);
    const old=await readFile(path.join(root,'sample/data/source.json'),'utf8');assert.equal((await post('/api/projects/open',{relativePath:'sample'})).status,200);assert.equal(await readFile(path.join(root,'sample/data/source.json'),'utf8'),old);
    assert.equal((await post('/api/projects/open',{relativePath:'../escape'})).status,403);
    assert.equal((await post(`/api/projects/${id}`,{origin:{lat:0,lon:0}},'PATCH')).status,400);
    assert.equal((await post(`/api/projects/${id}/jobs`,{kind:'shell',parameters:{command:'whoami'}})).status,400);
    assert.equal((await post(`/api/projects/${id}/jobs`,{kind:'fetch',parameters:{cacheDir:'../escape'}})).status,400);
    const rejected=await fetch(service.url+'/api/projects',{headers:{Origin:'https://evil.test'}});assert.equal(rejected.status,403);
    const job=(await (await post(`/api/projects/${id}/jobs`,{kind:'build'})).json()).job;
    await delay(10);assert.ok(live);assert.equal((await get(`/api/jobs/${job.id}`)).job.status,'running');
    await post(`/api/jobs/${job.id}/cancel`,{});assert.equal((await service.jobs.wait(job.id)).status,'cancelled');
    await mkdir(path.join(root,'sample/dist'),{recursive:true});await atomicWrite(path.join(root,'sample/dist/manifest.json'),{schemaVersion:1});assert.equal((await get(`/projects/${id}/dist/manifest.json`)).schemaVersion,1);
    const traversal=await fetch(service.url+`/projects/${id}/dist/%2e%2e%2fdata/source.json`);assert.equal(traversal.status,403);
    const ui=await get('/');assert.equal(ui.status,'failed');assert.equal(ui.diagnostics[0].code,'STUDIO_UNAVAILABLE');
  }finally{await service.close();}
});
test('symlink/junction project paths cannot escape the workspace',async()=>{
  const root=await temp(),outside=await temp();await createProject(outside,{sample:true});
  await symlink(outside,path.join(root,'link'),'junction');await assert.rejects(safePath(root,'link'),e=>e.code==='PATH_ESCAPE');
});
