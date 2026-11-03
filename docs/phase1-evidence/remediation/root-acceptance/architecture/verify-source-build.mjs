import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createProject,patchProject,readProject} from '../../../../../src/cli/project.js';
import {buildProject,validateProject,buildConfigHash} from '../../../../../src/cli/tasks.js';
import {hash,readJSON} from '../../../../../src/data/common.js';
const root=path.resolve('work/root-remediation-architecture/replay/source-lock-'+Date.now());await createProject(root,{sample:true,source:{provider:'dresel-europe'}});await buildProject(root);const initial=await readProject(root),snapshot=await readFile(path.join(root,'data/source.json')),manifest=await readFile(path.join(root,'dist/manifest.json')),lockBytes=await readFile(path.join(root,'city.lock.json')),lock=JSON.parse(lockBytes),records=[];
async function check(name,fn){try{const value=await fn();records.push({name,status:'pass',value});}catch(e){records.push({name,status:'fail',message:e.message});}}
const policy={provider:'custom',endpoint:'http://127.0.0.1:8123/interpreter',transport:'post',fallbackEndpoints:['https://overpass.private.coffee/api/interpreter'],fallbackPolicy:'unavailable'};
await check('all acquisition fields change without staling locked snapshot',async()=>{await patchProject(root,{source:policy});const current=await readProject(root);assert.equal(buildConfigHash(current),lock.inputs.buildConfigHash);assert.notEqual(hash(current),lock.inputs.configHash);assert.equal(hash(await readFile(path.join(root,'data/source.json'))),lock.inputs.sourceFileHash);assert.equal((await validateProject(root)).status,'succeeded');assert.equal(hash(await readFile(path.join(root,'dist/manifest.json'))),hash(manifest));assert.equal(hash(await readFile(path.join(root,'city.lock.json'))),hash(lockBytes));});
const baseline=await readProject(root);
async function stalePatch(name,patch,restore){await check(name,async()=>{await patchProject(root,patch);await assert.rejects(validateProject(root),e=>e.code==='STALE_BUILD');await patchProject(root,restore);assert.equal((await validateProject(root)).status,'succeeded');});}
await stalePatch('source kind remains locked',{source:{kind:'local'}},{source:{kind:baseline.source.kind}});
await copyFile(path.join(root,'data/source.json'),path.join(root,'data/copied.json'));
await stalePatch('source path identity remains locked despite equal bytes',{source:{file:'data/copied.json'}},{source:{file:baseline.source.file}});
await stalePatch('area remains locked',{area:{...baseline.area,east:baseline.area.east+.00001}},{area:baseline.area});
await stalePatch('seed remains locked',{seed:baseline.seed+1},{seed:baseline.seed});
await stalePatch('generation remains locked',{generation:{...baseline.generation,inferRoofs:!baseline.generation.inferRoofs}},{generation:baseline.generation});
await check('metadata-only byte changes remain locked',async()=>{await writeFile(path.join(root,'data/source.json'),Buffer.concat([snapshot,Buffer.from(' ')]));await assert.rejects(validateProject(root),e=>e.code==='STALE_BUILD');await writeFile(path.join(root,'data/source.json'),snapshot);assert.equal((await validateProject(root)).status,'succeeded');});
await check('OSM element changes remain locked',async()=>{const raw=JSON.parse(snapshot);raw.elements.find(e=>e.tags?.building).tags.height='47';await writeFile(path.join(root,'data/source.json'),JSON.stringify(raw));await assert.rejects(validateProject(root),e=>e.code==='STALE_BUILD');await writeFile(path.join(root,'data/source.json'),snapshot);assert.equal((await validateProject(root)).status,'succeeded');});
await check('projection origin stays in geometry hash',()=>assert.notEqual(buildConfigHash({...baseline,origin:{...baseline.origin,lon:baseline.origin.lon+.000001}}),buildConfigHash(baseline)));
const result={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'One synthetic sample compile and read-only validate/hash checks; no npm build, network, browser, or GPU',records,failures:records.filter(r=>r.status==='fail').length};await writeFile('work/root-remediation-architecture/replay/source-lock-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.failures)process.exitCode=1;
