import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeOSM } from '../src/data/normalize.js';
import { fetchArea, areaQuery } from '../src/data/overpass.js';
import { requestJSON } from '../src/data/http.js';
import { searchPlaces } from '../src/data/search.js';
import { validateArea, atomicWrite, readJSON } from '../src/data/common.js';
import { createProject, readProject, patchProject, importData, SAMPLE_AREA, OFFLINE_SAMPLE } from '../src/cli/project.js';

const temp=()=>mkdtemp(path.join(os.tmpdir(),'city-data-test-'));
test('standard Overpass, Map JSON and legacy input normalize without requiring project metadata',()=>{
  for(const input of [OFFLINE_SAMPLE,{version:'0.6',elements:OFFLINE_SAMPLE.elements},{elements:OFFLINE_SAMPLE.elements,bounds:{minlat:SAMPLE_AREA.south,minlon:SAMPLE_AREA.west,maxlat:SAMPLE_AREA.north,maxlon:SAMPLE_AREA.east}}]){
    const result=normalizeOSM(input,{area:SAMPLE_AREA});assert.equal(result.raw.metadata.license,'ODbL-1.0');assert.equal(result.raw.elements.length,3);assert.equal(result.missing.length,0);
  }
  const reversed=normalizeOSM({...OFFLINE_SAMPLE,elements:[...OFFLINE_SAMPLE.elements].reverse()},{area:SAMPLE_AREA});
  assert.equal(reversed.contentHash,normalizeOSM(OFFLINE_SAMPLE,{area:SAMPLE_AREA}).contentHash);
  assert.throws(()=>normalizeOSM({elements:[],remark:'runtime timeout'},{area:SAMPLE_AREA}),/timeout/);
  assert.throws(()=>normalizeOSM({elements:[{type:'node',id:1,lat:NaN,lon:0}]},{area:SAMPLE_AREA}),/Invalid OSM/);
});
test('missing relation members and way nodes are diagnosed without fabricated closing edges',()=>{
  const data={elements:[{type:'relation',id:20,tags:{type:'multipolygon',natural:'water'},members:[{type:'way',ref:10,role:'outer'}]},{type:'way',id:11,nodes:[1,2,3]}]};
  const result=normalizeOSM(data,{area:SAMPLE_AREA});assert.equal(result.missing.length,4);assert.equal(result.raw.elements[1].geometry,undefined);assert.equal(result.diagnostics.filter(d=>d.code==='MISSING_REFERENCE').length,4);
});
test('area limits reject wide, dateline and polar areas before any request',()=>{
  assert.throws(()=>validateArea({south:0,west:170,north:1,east:-170}),/Invalid/);
  assert.throws(()=>validateArea({south:0,west:0,north:1,east:1}),/exceeds/);
  assert.throws(()=>validateArea({south:85,west:0,north:85.01,east:0.01}),/Invalid/);
  assert.match(areaQuery(SAMPLE_AREA),/\(\._;>>;\);out meta;/);
});
test('fetch completes references, records provenance, prefers cache and preserves it after failed/aborted refresh',async()=>{
  const cacheDir=await temp();let calls=0;
  const request=async()=>{calls++;return calls===1?{elements:[{type:'way',id:5,nodes:[9],tags:{building:'yes'}}]}:{elements:[{type:'node',id:9,lat:39.909,lon:116.46,version:3,timestamp:'2026-01-01T00:00:00Z'}]};};
  const args={area:SAMPLE_AREA,cacheDir,request};const first=await fetchArea(args);
  assert.equal(calls,2);assert.equal(first.missing.length,0);assert.equal(first.raw.metadata.sourceApi,'overpass');assert.equal(first.raw.metadata.objectVersions[0].version,3);assert.match(first.raw.metadata.sourceHash,/^[a-f0-9]{64}$/);
  const original=await readFile(first.cacheFile,'utf8');
  const cached=await fetchArea({...args,request:()=>{throw new Error('must not request');}});assert.equal(cached.cacheHit,true);
  await assert.rejects(fetchArea({...args,refresh:true,request:()=>{throw new Error('source down');}}),/source down/);
  const controller=new AbortController();
  await assert.rejects(fetchArea({...args,refresh:true,signal:controller.signal,request:async()=>{controller.abort();return OFFLINE_SAMPLE;}}),{name:'AbortError'});
  assert.equal(await readFile(first.cacheFile,'utf8'),original);
  const entry=await readJSON(first.cacheFile);entry.raw.elements[0].lat=1;await writeFile(first.cacheFile,JSON.stringify(entry));
  await assert.rejects(fetchArea({...args,offline:true}),e=>e.code==='CACHE_CORRUPT');
});
test('atomic writes cancelled before commit keep prior JSON intact',async()=>{
  const dir=await temp(),file=path.join(dir,'value.json');await atomicWrite(file,{old:true});
  const c=new AbortController();c.abort();await assert.rejects(atomicWrite(file,{old:false},{signal:c.signal}));assert.deepEqual(await readJSON(file),{old:true});
});
test('HTTP retries 429 on the same URL with Retry-After, bounds bytes and rejects malformed JSON',async()=>{
  let calls=0;const waits=[],urls=[];
  const result=await requestJSON('https://fixture.test/query',{minIntervalMs:0,sleep:async ms=>{waits.push(ms);},fetchImpl:async url=>{urls.push(url);return ++calls===1?new Response('',{status:429,headers:{'Retry-After':'2'}}):new Response('{"elements":[]}');}});
  assert.deepEqual(result,{elements:[]});assert.equal(calls,2);assert.equal(new Set(urls).size,1);assert.ok(waits.includes(2000));
  await assert.rejects(requestJSON('https://fixture.test/large',{retries:0,minIntervalMs:0,maxBytes:4,fetchImpl:async()=>new Response('12345678')}),e=>e.code==='DOWNLOAD_LIMIT');
  await assert.rejects(requestJSON('https://fixture.test/json',{retries:0,minIntervalMs:0,fetchImpl:async()=>new Response('not json')}),e=>e.code==='INVALID_JSON');
  await assert.rejects(requestJSON('https://fixture.test/limit',{retries:0,minIntervalMs:0,fetchImpl:async()=>new Response('',{status:429})}),e=>e.code==='RATE_LIMITED');
});
test('HTTP cancellation and timeout abort the underlying request',async()=>{
  const never=async(_,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  await assert.rejects(requestJSON('https://fixture.test/timeout',{timeoutMs:10,retries:0,minIntervalMs:0,fetchImpl:never}),e=>e.code==='TIMEOUT');
  const c=new AbortController();setTimeout(()=>c.abort(),10);
  await assert.rejects(requestJSON('https://fixture.test/cancel',{signal:c.signal,retries:0,minIntervalMs:0,fetchImpl:never}),{name:'AbortError'});
});
test('search preserves ambiguous candidates, empty results, offline coordinates, official IDs and OSM object links',async()=>{
  assert.equal((await searchPlaces('39.9,116.4',{offline:true}))[0].source,'coordinate');
  assert.equal((await searchPlaces('landmark:china-zun',{offline:true}))[0].id,'china-zun');
  const cacheDir=await temp();let calls=0;
  const options={cacheDir,request:async()=>{calls++;return {features:[1,2].map((id)=>({properties:{osm_type:'N',osm_id:id,name:'Springfield',country:`Country ${id}`},geometry:{coordinates:[id,10]}}))};}};
  const candidates=await searchPlaces('Springfield',options);assert.equal(candidates.length,2);
  assert.deepEqual(await searchPlaces('Springfield',{...options,offline:true}),candidates);assert.equal(calls,1);
  assert.deepEqual(await searchPlaces('missing',{request:async()=>({features:[]})}),[]);
  assert.equal((await searchPlaces('https://openstreetmap.org/way/123',{request:async()=>({elements:[{type:'way',id:123,center:{lat:10,lon:20}}]})}))[0].id,'way/123');
  await assert.rejects(searchPlaces('uncached',{cacheDir,offline:true}),e=>e.code==='OFFLINE_SEARCH_MISS');
});
test('project initialization/import fixes origin and rejects XML without overwriting old input',async()=>{
  const root=await temp();const config=await createProject(root,{name:'city',sample:true});assert.equal(config.generation.inferRoofs,false);
  await assert.rejects(patchProject(root,{origin:{lat:0,lon:0}}),e=>e.code==='ORIGIN_LOCKED');
  await patchProject(root,{area:{...SAMPLE_AREA,east:SAMPLE_AREA.east+0.001}});assert.deepEqual((await readProject(root)).origin,config.origin);
  const json=path.join(root,'standard.json');await atomicWrite(json,{elements:OFFLINE_SAMPLE.elements});await importData(root,json);
  const before=await readFile(path.join(root,config.source.file),'utf8');await assert.rejects(importData(root,path.join(root,'map.xml')),e=>e.code==='UNSUPPORTED_FORMAT');assert.equal(await readFile(path.join(root,config.source.file),'utf8'),before);
});
