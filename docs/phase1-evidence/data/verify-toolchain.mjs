// Run against a checkout with real A/C/D integrated. No injected compiler or generator.
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const repository=path.resolve(process.argv[2]||'.');
const load=relative=>import(pathToFileURL(path.join(repository,relative)));
const {runCLI}=await load('src/cli/index.js');
const {JobManager,workerRunner}=await load('src/cli/jobs.js');
const {patchProject,importData}=await load('src/cli/project.js');
const {readJSON,atomicWrite,hash}=await load('src/data/common.js');
const root=await mkdtemp(path.join(os.tmpdir(),'city-toolchain-live-core-'));
const calls=[];
async function cli(args,expected='succeeded'){
  let stdout='',stderr='';const result=await runCLI([...args,'--json'],{cwd:root,stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});
  assert.equal(JSON.parse(stdout).status,expected,stdout);assert.equal(result.status,expected,JSON.stringify(result));calls.push({args,status:result.status,diagnostics:result.diagnostics,artifacts:result.artifacts});return result;
}
await cli(['init','sample','--sample']);await cli(['build','--project','sample','--offline']);
const first=await readJSON(path.join(root,'sample/city.lock.json'));
await cli(['build','--project','sample','--offline']);const second=await readJSON(path.join(root,'sample/city.lock.json'));assert.equal(first.contentHash,second.contentHash);
await cli(['validate','--project','sample','--offline']);
await cli(['export','web','--project','sample']);await cli(['export','glb','--project','sample']);
const glb=await readFile(path.join(root,'sample/exports/city.glb'));assert.equal(glb.subarray(0,4).toString(),'glTF');
const snapshot=await readJSON(path.join(repository,'public/data/beijing-cbd.json'));
const building=snapshot.elements.find(e=>e.type==='way'&&e.id===599547918);assert.ok(building?.geometry);
const lats=building.geometry.map(p=>p.lat),lons=building.geometry.map(p=>p.lon);
const area=[Math.min(...lats)-.0002,Math.min(...lons)-.0002,Math.max(...lats)+.0002,Math.max(...lons)+.0002];
await cli(['init','landmark','--area',area.join(',')]);
await atomicWrite(path.join(root,'standard.json'),{version:0.6,elements:[building]});
await cli(['data','import','standard.json','--project','landmark']);
const official=(await load('packages/landmarks/index.js')).recipes.find(r=>r.id==='china-zun');
const versions=[];
for(const [version,steps]of [['1.0.0',44],['1.1.0',20]]){
  const pack=path.join(root,`pack-${version}`);await mkdir(pack);await atomicWrite(path.join(pack,'recipe.json'),{...official,version,parameters:{...official.parameters,steps}});
  await cli(['landmarks','update',pack,'--project','landmark','--offline']);
  const lock=await readJSON(path.join(root,'landmark/city.lock.json')),manifest=await readJSON(path.join(root,'landmark/dist/manifest.json'));
  const record=Object.values(manifest.featureIndex).find(f=>f.sourceIds.includes('way/599547918'));
  assert.equal(record.provenance.recipeVersion,version);versions.push({version,contentHash:lock.contentHash,assetHashes:lock.assetHashes});
}
assert.notDeepEqual(versions[0].assetHashes,versions[1].assetHashes,'Recipe geometry must really change.');
await cli(['landmarks','update','--rollback','--project','landmark','--offline']);
const rollback=await readJSON(path.join(root,'landmark/city.lock.json'));assert.deepEqual(rollback.assetHashes,versions[0].assetHashes);assert.equal(rollback.contentHash,versions[0].contentHash);
// Cancel a real full-snapshot compilation, preserve prior scene, reopen queue and resume.
const sampleRoot=path.join(root,'sample'),oldManifest=await readFile(path.join(sampleRoot,'dist/manifest.json'));
await patchProject(sampleRoot,{area:Object.fromEntries(['south','west','north','east'].map((k,i)=>[k,snapshot.metadata.bbox[i]]))});
await importData(sampleRoot,path.join(repository,'public/data/beijing-cbd.json'));
let manager;let cancellationRequested=false;
manager=await new JobManager({directory:path.join(sampleRoot,'.city-cache/real-cancel-jobs'),runner:(job,progress,signal)=>workerRunner(job,event=>{
  progress(event);if(event.stage==='plan'&&!cancellationRequested){cancellationRequested=true;manager.cancel(job.id).catch(()=>{});}
},signal)}).open();
const job=await manager.enqueue('build',sampleRoot);const cancelled=await manager.wait(job.id);assert.equal(cancelled.status,'cancelled');assert.equal(hash(await readFile(path.join(sampleRoot,'dist/manifest.json'))),hash(oldManifest));await manager.close();
manager=await new JobManager({directory:path.join(sampleRoot,'.city-cache/real-cancel-jobs')}).open();await manager.resume(job.id);const resumed=await manager.wait(job.id);assert.equal(resumed.status,'succeeded');assert.equal(resumed.attempt,2);await manager.close();
// Two genuinely different geographic projects and one real missing-project fault.
const kyoto=await readJSON(path.join(repository,'public/data/kyoto-gion.json'));
const kyotoBuilding=kyoto.elements.find(e=>e.type==='way'&&e.tags?.building&&e.geometry?.length>=4);
const kyotoArea=[Math.min(...kyotoBuilding.geometry.map(p=>p.lat))-.0002,Math.min(...kyotoBuilding.geometry.map(p=>p.lon))-.0002,Math.max(...kyotoBuilding.geometry.map(p=>p.lat))+.0002,Math.max(...kyotoBuilding.geometry.map(p=>p.lon))+.0002];
await cli(['init','kyoto','--area',kyotoArea.join(',')]);await atomicWrite(path.join(root,'kyoto.json'),{elements:[kyotoBuilding]});await cli(['data','import','kyoto.json','--project','kyoto']);
await atomicWrite(path.join(root,'batch.json'),{projects:['landmark','kyoto','broken']});
const batch=await cli(['batch','batch.json','--offline','--concurrency','2'],'partial');assert.deepEqual(batch.jobs.map(j=>j.status),['succeeded','succeeded','failed']);
await cli(['init','broken','--sample']);const batchResumed=await cli(['batch','batch.json','--offline','--resume']);assert.deepEqual(batchResumed.jobs.map(j=>j.attempt),[1,1,2]);
const evidence={date:new Date().toISOString(),environment:{platform:process.platform,node:process.version},repository,temporaryProjects:root,realCompiler:true,injectedCompiler:false,syntheticSample:true,sampleContentHash:first.contentHash,source:{file:'public/data/beijing-cbd.json',sourceFeature:'way/599547918',sourceHash:hash(building)},glbBytes:glb.length,versions,rollbackContentHash:rollback.contentHash,cancellation:{requested:cancellationRequested,status:cancelled.status,priorScenePreserved:true,resumedStatus:resumed.status,attempt:resumed.attempt},batch:{statuses:batch.jobs.map(j=>j.status),resumedStatuses:batchResumed.jobs.map(j=>j.status),attempts:batchResumed.jobs.map(j=>j.attempt)},calls};
const output=process.argv[3];if(output)await writeFile(path.resolve(output),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
