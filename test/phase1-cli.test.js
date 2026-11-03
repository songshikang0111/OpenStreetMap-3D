import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProject, SAMPLE_AREA, OFFLINE_SAMPLE } from '../src/cli/project.js';
import { atomicWrite, readJSON, safePath, CityError } from '../src/data/common.js';
import { buildProject, validateProject, recoverBuildPublication } from '../src/cli/tasks.js';
import { JobManager, requestJobCancel } from '../src/cli/jobs.js';
import { updateLandmarks } from '../src/cli/landmarks.js';
import { runCLI, runBatch, exitCode } from '../src/cli/index.js';
import { createLocalServer } from '../src/local-server/index.js';
import { acquireProjectLock } from '../src/cli/project-lock.js';

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
  const base={schemaVersion:1,id:'fixture',generator:'fixture-generator',engineCompatibility:'^1.0.0',match:{osm:[{type:'way',id:1}]},anchor:{kind:'source-footprint'},orientation:{kind:'source',radians:0},parameters:{},materialRoles:['wall'],source:{license:'MIT'},provenance:{kind:'fixture'}};
  for(const version of ['1.0.0','1.1.0']){
    const dir=path.join(root,version);await mkdir(dir);await atomicWrite(path.join(dir,'recipe.json'),{...base,version});await updateLandmarks(root,{packagePath:dir});
  }
  const second=await readJSON(path.join(root,'city.config.json'));assert.equal(second.landmarks.packages[0].recipes[0].version,'1.1.0');
  await updateLandmarks(root,{rollback:true});const restored=await readJSON(path.join(root,'city.config.json'));assert.equal(restored.landmarks.packages[0].recipes[0].version,'1.0.0');assert.ok((await readJSON(path.join(root,'city.lock.json'))).pendingRebuild);
  const bad=path.join(root,'bad');await mkdir(bad);await atomicWrite(path.join(bad,'recipe.json'),{...base,version:'2.0.0',engineCompatibility:'^2.0.0'});await assert.rejects(updateLandmarks(root,{packagePath:bad}),e=>e.code==='INCOMPATIBLE_RECIPE');
});
test('CLI outputs one JSON envelope, structured worker/argument failure and documented help',async()=>{
  const root=await temp();let out='',err='';const io={cwd:root,stdout:{write:s=>out+=s},stderr:{write:s=>err+=s}};
  await runCLI(['init','my-city','--sample','--json'],io);assert.equal(JSON.parse(out).status,'succeeded');out='';
  await runCLI(['search','landmark:cctv','--offline','--json'],io);assert.equal(JSON.parse(out).candidates[0].source,'official-landmark-index');out='';
  const help=await runCLI(['export','--help','--json'],io);assert.match(help.help,/export web\|png\|glb/);out='';
  const built=await runCLI(['build','--project','my-city','--offline','--json'],{...io,runner:async()=>{throw new CityError('CORE_UNAVAILABLE','build','Compiler dependency failed to load.');}});assert.equal(built.status,'failed');assert.equal(built.diagnostics[0].code,'CORE_UNAVAILABLE');assert.equal(out.trim().split('\n').length,1);assert.equal(exitCode(built),1);
  out='';await runCLI(['build','--bogus','--json'],io);assert.equal(JSON.parse(out).diagnostics[0].code,'UNKNOWN_OPTION');
});
test('localhost HTTP provides real projects/jobs/resources and rejects origin, escape, arbitrary commands and origin drift',async()=>{
  const root=await temp();let live=false;
  const service=await createLocalServer({workspaceRoot:root,studioRoot:path.join(root,'missing-studio'),port:0,runner:async(job,p,signal)=>{live=true;p({stage:'compile',progress:0.1});await delay(10000,null,{signal});return {status:'succeeded',artifacts:[]};}});
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
    await atomicWrite(path.join(root,'import.json'),{elements:OFFLINE_SAMPLE.elements});assert.equal((await post(`/api/projects/${id}/import`,{relativePath:'import.json'})).status,409);
    await post(`/api/jobs/${job.id}/cancel`,{});assert.equal((await service.jobs.wait(job.id)).status,'cancelled');
    await mkdir(path.join(root,'sample/dist'),{recursive:true});await atomicWrite(path.join(root,'sample/dist/manifest.json'),{schemaVersion:1});assert.equal((await get(`/projects/${id}/dist/manifest.json`)).schemaVersion,1);
    const traversal=await fetch(service.url+`/projects/${id}/dist/%2e%2e%2fdata/source.json`);assert.equal(traversal.status,403);
    const ui=await get('/');assert.equal(ui.status,'failed');assert.equal(ui.diagnostics[0].code,'STUDIO_UNAVAILABLE');
  }finally{await service.close();}
});
test('real fetch workers share parent HTTP throttling, and offline batch forces zero requests',async()=>{
  const times=[];const http=createServer((req,res)=>{times.push(Date.now());res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(OFFLINE_SAMPLE));});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${http.address().port}/query`,root=await temp();
  try{
    const entries=[];
    for(const name of ['first','second']){await createProject(path.join(root,name),{sample:true});entries.push({project:name,kind:'fetch',parameters:{endpoint}});}
    const file=path.join(root,'batch.json');await atomicWrite(file,{projects:entries});
    const output=await runBatch(file,{concurrency:2});assert.equal(output.status,'succeeded');assert.equal(times.length,2);assert.ok(times[1]-times[0]>=1000,`requests arrived ${times[1]-times[0]}ms apart`);
    await createProject(path.join(root,'offline'),{sample:true});await atomicWrite(path.join(root,'offline.json'),{projects:[{project:'offline',kind:'fetch',parameters:{endpoint,offline:false}}]});
    const offline=await runBatch(path.join(root,'offline.json'),{offline:true});assert.equal(offline.status,'failed');assert.equal(offline.jobs[0].diagnostics[0].code,'OFFLINE_CACHE_MISS');assert.equal(times.length,2);
  }finally{await new Promise(resolve=>http.close(resolve));}
});
test('a stale cancellation marker cannot cancel a resumed failed attempt',async()=>{
  const directory=await temp();let attempts=0;
  const manager=await new JobManager({directory,runner:async(job,p,signal)=>{attempts++;if(attempts===1){await requestJobCancel(directory,job.id);throw new Error('failed before poll');}await delay(300,null,{signal});return {status:'succeeded'};}}).open();
  try{const job=await manager.enqueue('build','city');assert.equal((await manager.wait(job.id)).status,'failed');await manager.resume(job.id);assert.equal((await manager.wait(job.id)).status,'succeeded');}finally{await manager.close();}
});
test('publication recovery restores old dist after directory move and repairs root lock after successful publication',async()=>{
  const root=await temp();await createProject(root,{sample:true});await buildProject(root,{core:fixtureCore});
  await rename(path.join(root,'dist'),path.join(root,'.city-cache/previous-dist'));await recoverBuildPublication(root);assert.ok(await readJSON(path.join(root,'dist/manifest.json')));
  const lock=await readJSON(path.join(root,'city.lock.json'));await atomicWrite(path.join(root,'city.lock.json'),{schemaVersion:1,inputs:{}});await recoverBuildPublication(root);assert.equal((await readJSON(path.join(root,'city.lock.json'))).contentHash,lock.contentHash);
});
test('service rejects persisted jobs escaping the registered workspace and releases failed queue ownership',async()=>{
  const root=await temp();const service=await createLocalServer({workspaceRoot:root,port:0});await service.close();
  const directory=path.join(root,'.city-service/jobs');await atomicWrite(path.join(directory,'abcd.json'),{id:'abcd',kind:'build',project:await temp(),parameters:{},status:'failed',diagnostics:[],attempt:1});
  await assert.rejects(createLocalServer({workspaceRoot:root,port:0}),e=>['PATH_ESCAPE','JOB_PROJECT_ESCAPE'].includes(e.code));
  await rm(path.join(directory,'abcd.json'));const retry=await createLocalServer({workspaceRoot:root,port:0});await retry.close();
});
test('persisted internal job IDs cannot escape the queue before first write',async()=>{
  const root=await temp(),directory=path.join(root,'queue');await mkdir(directory);const outside=path.join(root,'outside.json');await atomicWrite(outside,{keep:true});
  await atomicWrite(path.join(directory,'abcd.json'),{id:'../outside',kind:'build',project:root,parameters:{},status:'queued',diagnostics:[],attempt:1});
  await assert.rejects(new JobManager({directory}).open(),e=>e.code==='INVALID_JOB_STATE');assert.deepEqual(await readJSON(outside),{keep:true});
});
test('separate CLI/studio/batch queues cannot run the same project concurrently',async()=>{
  const root=await temp();await createProject(root,{sample:true});let release;
  const blocked=new Promise(resolve=>release=resolve), runner=async()=>{await blocked;return {status:'succeeded'};};
  const first=await new JobManager({directory:path.join(root,'.city-cache/jobs'),runner}).open();
  const second=await new JobManager({directory:path.join(root,'.city-service/jobs'),runner}).open();
  try{
    const a=await first.enqueue('build',root);await delay(20);
    const b=await second.enqueue('build',root);const failure=await second.wait(b.id);assert.equal(failure.status,'failed');assert.equal(failure.diagnostics[0].code,'PROJECT_BUSY');release();assert.equal((await first.wait(a.id)).status,'succeeded');
  }finally{release();await first.close();await second.close();}
});
test('failed final job-state write returns a structured failure and releases waiters',async()=>{
  const directory=await temp();const manager=await new JobManager({directory,runner:async job=>{
    await rm(path.join(directory,`${job.id}.json`),{force:true});await mkdir(path.join(directory,`${job.id}.json`));await atomicWrite(path.join(directory,`${job.id}.json/blocked`),'x');return {status:'succeeded'};
  }}).open();
  try{
    const job=await manager.enqueue('build','fixture');const done=await Promise.race([manager.wait(job.id),delay(1000).then(()=>{throw new Error('waiter hung');})]);assert.equal(done.status,'failed');assert.ok(done.diagnostics.some(d=>d.code==='JOB_PERSIST_FAILED'));assert.equal(manager.active.size,0);
  }finally{await manager.close();}
});
test('simultaneous stale project-lock recovery never grants two owners',async()=>{
  const root=await temp();await createProject(root,{sample:true});
  for(let i=0;i<30;i++){
    await atomicWrite(path.join(root,'.city-cache/task-owner.json'),{pid:2147483647,token:'dead-owner'});
    if(i===0)await atomicWrite(path.join(root,'.city-cache/task-owner.json.recovery'),{pid:2147483647,token:'dead-recoverer'});
    const results=await Promise.allSettled([acquireProjectLock(root),acquireProjectLock(root)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(const result of results)if(result.status==='fulfilled')await result.value();
  }
});
test('CLI validate never recovers or mutates a generation while another project task owns it',async()=>{
  const root=await temp();await createProject(root,{sample:true});await buildProject(root,{core:fixtureCore});const release=await acquireProjectLock(root);
  try{
    await rename(path.join(root,'dist'),path.join(root,'.city-cache/previous-dist'));
    let out='';const result=await runCLI(['validate','--project',root,'--json'],{stdout:{write:s=>out+=s}});assert.equal(result.diagnostics[0].code,'PROJECT_BUSY');assert.ok(await readJSON(path.join(root,'.city-cache/previous-dist/manifest.json')));
    await assert.rejects(readJSON(path.join(root,'dist/manifest.json')),e=>e.code==='ENOENT');
  }finally{await release();}
});
test('symlink/junction project paths cannot escape the workspace',async()=>{
  const root=await temp(),outside=await temp();await createProject(outside,{sample:true});
  await symlink(outside,path.join(root,'link'),'junction');await assert.rejects(safePath(root,'link'),e=>e.code==='PATH_ESCAPE');
});
test('source studio serves its real package module graph and denies unrelated project files',async()=>{
  const root=await temp(),studioRoot=path.join(root,'studio');await mkdir(studioRoot);
  await atomicWrite(path.join(studioRoot,'index.html'),'<html><body><script type="module" src="/src/styles/index.js"></script></body></html>');
  await atomicWrite(path.join(root,'src/styles/index.js'),'export {styles} from "../../packages/styles/index.js";');
  await atomicWrite(path.join(root,'packages/styles/index.js'),'export const styles = ["comic"];');
  await atomicWrite(path.join(root,'private.json'),{private:true});
  const service=await createLocalServer({workspaceRoot:root,studioRoot,port:0,sample:false});
  try{
    const source=await fetch(service.url+'/src/styles/index.js');assert.equal(source.status,200);assert.match(await source.text(),/\/packages\/styles\/index.js/);
    const pack=await fetch(service.url+'/packages/styles/index.js');assert.equal(pack.status,200);assert.match(await pack.text(),/comic/);
    assert.equal((await fetch(service.url+'/private.json')).status,404);assert.equal((await fetch(service.url+'/data/source.json')).status,404);
  }finally{await service.close();}
});
