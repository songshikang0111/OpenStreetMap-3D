import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveDataSource,validateEndpoint,DATA_SOURCE_DEFAULTS} from '../src/data/source.js';
import {fetchArea} from '../src/data/overpass.js';
import {requestJSON} from '../src/data/http.js';
import {CityError,atomicWrite,readJSON} from '../src/data/common.js';
import {createProject,patchProject,SAMPLE_AREA,OFFLINE_SAMPLE} from '../src/cli/project.js';
import {runCLI,runBatch} from '../src/cli/index.js';
import {createLocalServer} from '../src/local-server/index.js';
import {validateProjectConfig} from '../src/core/config.js';
import {searchPlaces} from '../src/data/search.js';

const temp=()=>mkdtemp(path.join(os.tmpdir(),'city-source-'));
async function fixture(handler){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {endpoint:`http://127.0.0.1:${server.address().port}/interpreter`,close:()=>new Promise(resolve=>server.close(resolve))};}
const good=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...OFFLINE_SAMPLE,osm3s:{timestamp_osm_base:'2026-11-03T00:00:00Z'}}));};
test('source validation is shared by project/core, allows self-hosted HTTP and rejects unsafe/duplicate endpoints',async()=>{
  assert.equal(resolveDataSource().endpoint,DATA_SOURCE_DEFAULTS.endpoint);
  assert.equal(validateEndpoint('http://127.0.0.1:8123/interpreter'),'http://127.0.0.1:8123/interpreter');
  for(const endpoint of ['file:///etc/passwd','http://user:secret@host/api','https://host/api?token=x','https://host/#x','relative',' ftp://host'])assert.throws(()=>resolveDataSource({endpoint}),e=>e.code==='INVALID_ENDPOINT');
  for(const source of [{transport:'PUT'},{fallbackPolicy:'always'},{fallbackEndpoints:['https://a/','https://b/','https://c/']},{endpoint:'https://a/',fallbackEndpoints:['https://a/']}])assert.throws(()=>resolveDataSource(source));
  const root=await temp();const config=await createProject(root,{sample:true});assert.equal(validateProjectConfig({...config,source:{...config.source,endpoint:'javascript:alert(1)'}}).valid,false);
  await patchProject(root,{source:{endpoint:'http://localhost:8123/interpreter',transport:'get'}});const saved=await readJSON(path.join(root,'city.config.json'));assert.equal(saved.source.file,'data/source.json');assert.equal(saved.source.kind,'sample');assert.equal(saved.source.transport,'get');
});
test('provider presets select URL/transport without manual methods, and explicit fields override defaults',async()=>{
  const europe=resolveDataSource({provider:'dresel-europe'});assert.equal(europe.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(europe.transport,'get');
  assert.equal(resolveDataSource({provider:'vk-maps'}).transport,'get');
  const custom=resolveDataSource(europe,{endpoint:'http://localhost:8123/interpreter',transport:'post'});assert.equal(custom.provider,'custom');assert.equal(custom.transport,'post');
  assert.throws(()=>resolveDataSource({provider:'unknown'}),e=>e.code==='INVALID_PROVIDER');
  let out='';const result=await runCLI(['data','providers','--json'],{stdout:{write:s=>out+=s}});assert.equal(result.status,'succeeded');assert.ok(JSON.parse(out).providers.find(p=>p.id==='dresel-europe').coverage.includes('Europe only'));
  const root=await temp();await runCLI(['init',root,'--sample','--provider','dresel-europe','--json'],{stdout:{write:()=>{}}});assert.equal((await readJSON(path.join(root,'city.config.json'))).source.provider,'dresel-europe');
  await patchProject(root,{source:{provider:'custom',endpoint:'http://old-source.test/api',transport:'post'}});await patchProject(root,{source:{provider:'dresel-europe'}});
  const changed=resolveDataSource((await readJSON(path.join(root,'city.config.json'))).source);assert.equal(changed.endpoint,europe.endpoint);assert.equal(changed.transport,'get');
});
test('a higher-priority provider replaces lower endpoint/transport in batch and CLI resume',async()=>{
  const root=await temp();await atomicWrite(path.join(root,'batch.json'),{projects:[{project:'one',kind:'fetch',parameters:{endpoint:'http://old-source.test/api',transport:'post',fallbackEndpoints:['http://fallback.test/api'],fallbackPolicy:'unavailable'}}]});
  let captured;await runBatch(path.join(root,'batch.json'),{source:{provider:'dresel-europe'},runner:async job=>{captured=job.parameters;return {status:'succeeded'};}});
  assert.equal(captured.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(captured.transport,'get');assert.deepEqual(captured.fallbackEndpoints,['http://fallback.test/api']);
  await createProject(path.join(root,'resume'),{sample:true});let out='';
  const io={cwd:root,stdout:{write:s=>out+=s},stderr:{write:()=>{}},runner:async job=>{captured=job.parameters;throw new Error('intentional fixture failure');}};
  const first=await runCLI(['data','fetch','--project','resume','--endpoint','http://old-source.test/api','--transport','post','--json'],io);assert.equal(first.status,'failed');
  const resumed=await runCLI(['jobs','resume',first.job.id,'--project','resume','--provider','dresel-europe','--json'],{...io,runner:async job=>{captured=job.parameters;return {status:'succeeded'};}});assert.equal(resumed.status,'succeeded');assert.equal(captured.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(captured.transport,'get');
});
test('fallback-only overrides validate against the actual project primary, not a missing override default',async()=>{
  const root=await temp();await createProject(root,{sample:true,source:{endpoint:'http://custom-primary.test/api',transport:'get'}});
  const patch={fallbackEndpoints:[DATA_SOURCE_DEFAULTS.endpoint],fallbackPolicy:'unavailable'};
  await patchProject(root,{source:patch});const config=await readJSON(path.join(root,'city.config.json'));assert.equal(resolveDataSource(config.source).endpoint,'http://custom-primary.test/api');
  let captured;const result=await runCLI(['data','fetch','--project',root,'--fallback-endpoint',DATA_SOURCE_DEFAULTS.endpoint,'--json'],{stdout:{write:()=>{}},stderr:{write:()=>{}},runner:async job=>{captured=job.parameters;return {status:'succeeded'};}});assert.equal(result.status,'succeeded');assert.deepEqual(resolveDataSource(config.source,captured).fallbackEndpoints,[DATA_SOURCE_DEFAULTS.endpoint]);
});
test('OSM object search shares explicit GET fallback semantics and default legacy search caches remain offline',async()=>{
  let calls=[];
  const candidates=await searchPlaces('way/123',{endpoint:'https://search-primary.test/api',transport:'get',fallbackEndpoints:['https://search-backup.test/api'],fallbackPolicy:'unavailable',request:async url=>{const endpoint=new URL(url).origin;calls.push(endpoint);if(endpoint==='https://search-primary.test')throw new CityError('HTTP_ERROR','download','502','retry',{httpStatus:502});return {elements:[{type:'way',id:123,center:{lat:10,lon:20}}]};}});
  assert.deepEqual(calls,['https://search-primary.test','https://search-backup.test']);assert.equal(candidates[0].endpoint,'https://search-backup.test/api');
  const {hash}=await import('../src/data/common.js');const cacheDir=await temp(),query='Legacy query';
  await atomicWrite(path.join(cacheDir,`search-${hash({query,photonUrl:'https://photon.komoot.io/api/',overpassUrl:DATA_SOURCE_DEFAULTS.endpoint})}.json`),{candidates:[{id:'legacy',lat:10,lon:20,displayName:query,source:'photon'}]});
  assert.equal((await searchPlaces(query,{cacheDir,offline:true}))[0].id,'legacy');
});
test('explicit GET source records provenance and has a separate cache from legacy POST',async()=>{
  const cacheDir=await temp();let calls=0;
  const options={area:SAMPLE_AREA,cacheDir,endpoint:'https://get-source.test/interpreter',transport:'get',request:async(url,init)=>{calls++;assert.equal(init.method,'GET');assert.match(new URL(url).searchParams.get('data'),/out meta/);assert.equal(init.body,undefined);return {...OFFLINE_SAMPLE,osm3s:{timestamp_osm_base:'2026-11-03T00:00:00Z'}};}};
  const first=await fetchArea(options);assert.equal(first.raw.metadata.osmBaseTimestamp,'2026-11-03T00:00:00Z');assert.equal(first.raw.metadata.transport,'get');assert.equal(first.sourceAttempts[0].status,'succeeded');
  assert.equal((await fetchArea({...options,offline:true})).cacheHit,true);assert.equal(calls,1);
  await assert.rejects(fetchArea({...options,transport:'post',offline:true}),e=>e.code==='OFFLINE_CACHE_MISS');
});
test('unavailable fallback is explicit, finite, cache preferred, and refresh failure cannot overwrite old cache',async()=>{
  const cacheDir=await temp(),primary='https://primary-source.test/interpreter',backup='https://backup-source.test/interpreter';let calls=[];
  const options={area:SAMPLE_AREA,cacheDir,endpoint:primary,fallbackEndpoints:[backup],fallbackPolicy:'unavailable',request:async url=>{calls.push(url);if(url===primary)throw new CityError('HTTP_ERROR','download','HTTP 502','retry',{httpStatus:502});return OFFLINE_SAMPLE;}};
  const first=await fetchArea(options);assert.deepEqual(calls,[primary,backup]);assert.equal(first.endpoint,backup);assert.equal(first.diagnostics.at(-1).code,'SOURCE_FALLBACK');assert.equal(first.raw.metadata.sourceAttempts[0].httpStatus,502);const original=await readFile(first.cacheFile);
  calls=[];const cached=await fetchArea(options);assert.equal(cached.cacheHit,true);assert.equal(cached.diagnostics.at(-1).code,'FALLBACK_CACHE_HIT');assert.deepEqual(calls,[]);
  await assert.rejects(fetchArea({...options,refresh:true,request:async()=>{throw new CityError('TIMEOUT','download','failed');}}),e=>e.sourceAttempts.length===2);assert.deepEqual(await readFile(first.cacheFile),original);
  calls=[];await assert.rejects(fetchArea({...options,fallbackPolicy:'none',refresh:true}),e=>e.httpStatus===502);assert.deepEqual(calls,[primary]);
});
test('fallback never rotates on rate limiting, invalid data or cancellation',async()=>{
  for(const error of [new CityError('RATE_LIMITED','download','429','wait',{httpStatus:429}),new CityError('RATE_LIMITED','download','406','wait',{httpStatus:406}),new CityError('HTTP_ERROR','download','404','fix',{httpStatus:404}),new CityError('INVALID_JSON','download','bad')]){
    let calls=0;await assert.rejects(fetchArea({area:SAMPLE_AREA,cacheDir:await temp(),endpoint:'https://stop.test/api',fallbackEndpoints:['https://other.test/api'],fallbackPolicy:'unavailable',request:async()=>{calls++;throw error;}}));assert.equal(calls,1);
  }
  let calls=0;const controller=new AbortController();await assert.rejects(fetchArea({area:SAMPLE_AREA,cacheDir:await temp(),signal:controller.signal,endpoint:'https://stop.test/api',fallbackEndpoints:['https://other.test/api'],fallbackPolicy:'unavailable',request:async()=>{calls++;controller.abort();throw new CityError('TIMEOUT','download','stop');}}),{name:'AbortError'});assert.equal(calls,1);
});
test('exhausted rate limits retain cooldown for next same-origin request, which is cancellable',async()=>{
  const endpoint='https://cooldown-source.test/api';let calls=0;
  await assert.rejects(requestJSON(endpoint,{retries:0,minIntervalMs:0,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'1'}});}}),e=>e.httpStatus===429&&e.retryAfterMs>=30000);
  const controller=new AbortController();setTimeout(()=>controller.abort(),10);
  await assert.rejects(requestJSON(endpoint,{signal:controller.signal,minIntervalMs:0,fetchImpl:async()=>{calls++;return new Response('{}');}}),{name:'AbortError'});assert.equal(calls,1);
});
test('formal CLI fetch uses saved source and explicit override; batch applies global source flags to fetch entries',async()=>{
  const requests=[];const remote=await fixture((req,res)=>{requests.push({method:req.method,url:req.url});good(req,res);});
  const root=await temp();let stdout='';const io={cwd:root,stdout:{write:s=>stdout+=s},stderr:{write:()=>{}}};
  const cli=async args=>{stdout='';const result=await runCLI([...args,'--json'],io);assert.equal(JSON.parse(stdout).status,result.status);return result;};
  try{
    await cli(['init','one','--sample','--endpoint',remote.endpoint,'--transport','get']);const fetched=await cli(['data','fetch','--project','one']);assert.equal(fetched.status,'succeeded');assert.equal(fetched.job.result.source.transport,'get');assert.equal(requests[0].method,'GET');
    assert.equal((await cli(['data','fetch','--project','one','--offline'])).job.result.cacheHit,true);assert.equal(requests.length,1);
    const override=await cli(['data','fetch','--project','one','--transport','post']);assert.equal(override.status,'succeeded');assert.equal(requests.at(-1).method,'POST');assert.equal((await readJSON(path.join(root,'one/city.config.json'))).source.transport,'get');
    await createProject(path.join(root,'two'),{sample:true});await atomicWrite(path.join(root,'batch.json'),{projects:[{project:'two',kind:'fetch'}]});
    const batch=await cli(['batch','batch.json','--endpoint',remote.endpoint,'--transport','get']);assert.equal(batch.status,'succeeded');assert.equal(batch.jobs[0].result.source.endpoint,remote.endpoint);
  }finally{await remote.close();}
});
test('studio source catalog/defaults/project PATCH and per-job overrides use the same contract',async()=>{
  const requests=[];const remote=await fixture((req,res)=>{requests.push(req.method);good(req,res);});const root=await temp();
  const service=await createLocalServer({workspaceRoot:root,port:0,dataSource:{endpoint:remote.endpoint,transport:'get'}});
  const post=(route,value,method='POST')=>fetch(service.url+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  try{
    const catalog=await (await fetch(service.url+'/api/data-sources')).json();assert.equal(catalog.defaults.endpoint,remote.endpoint);assert.ok(catalog.providers.some(p=>p.id==='vk-maps'));
    const created=await (await post('/api/projects',{name:'source service',sample:true})).json();assert.equal(created.project.config.source.transport,'get');const id=created.project.id;
    const preset=await (await post('/api/projects',{name:'preset overrides operator',sample:true,source:{provider:'dresel-europe'}})).json();assert.equal(preset.project.config.source.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(preset.project.config.source.transport,'get');
    const job=(await (await post(`/api/projects/${id}/jobs`,{kind:'fetch'})).json()).job;const done=await service.jobs.wait(job.id);assert.equal(done.status,'succeeded');assert.equal(done.result.source.endpoint,remote.endpoint);assert.deepEqual(requests,['GET']);
    assert.equal((await post(`/api/projects/${id}`,{source:{transport:'post'}},'PATCH')).status,200);
    const overridden=(await (await post(`/api/projects/${id}/jobs`,{kind:'fetch',parameters:{transport:'get',refresh:true}})).json()).job;assert.equal((await service.jobs.wait(overridden.id)).status,'succeeded');assert.deepEqual(requests,['GET','GET']);
    assert.equal((await post(`/api/projects/${id}/jobs`,{kind:'fetch',endpoint:'file:///etc/passwd'})).status,400);
    assert.equal((await post(`/api/projects/${id}/jobs`,{kind:'fetch',parameters:{cacheDir:'../outside'}})).status,400);
    assert.equal((await post(`/api/projects/${id}`,{source:{endpoint:'https://user:pass@host/api'}},'PATCH')).status,400);
  }finally{await service.close();await remote.close();}
});
test('nested HTTP provider override has priority over flat endpoint/transport parameters',async()=>{
  const root=await temp();let captured;const service=await createLocalServer({workspaceRoot:root,port:0,runner:async job=>{captured=job.parameters;return {status:'succeeded'};}});
  try{
    const id=[...service.projects.keys()][0];const response=await fetch(service.url+`/api/projects/${id}/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'fetch',endpoint:'http://flat-source.test/api',transport:'post',parameters:{provider:'dresel-europe'}})});const value=await response.json();assert.equal(response.status,202);await service.jobs.wait(value.job.id);assert.equal(captured.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(captured.transport,'get');
  }finally{await service.close();}
});
