import assert from 'node:assert/strict';
import path from 'node:path';import os from 'node:os';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {continuityFixture} from '../../test/phase1-core-fixture.js';
import {compileScene,validateProjectConfig} from '../../src/core/index.js';import {decodeChunk} from '../../src/core/scene-codec.js';
import {createProject,patchProject} from '../../src/cli/project.js';import {JobManager,workerRunner} from '../../src/cli/jobs.js';import {validateProject} from '../../src/cli/tasks.js';import {acquireProjectLock,withProjectLock} from '../../src/cli/project-lock.js';import {hash} from '../../src/data/common.js';
import official from '../../packages/landmarks/index.js';
const report={date:new Date().toISOString(),nearOwnership:[],worker:{}};
const {raw,config}=continuityFixture();let expectedDetails;
for(const divisions of [1,2,4]){
 const result=await compileScene({...raw,elements:divisions===4?[...raw.elements].reverse():raw.elements},{...config,tiling:{divisions}}),walls=[],trees=[];
 const claimed=new Set(Object.values(result.manifest.featureIndex).filter(f=>f.provenance.recipeId).map(f=>f.featureId));
 for(const chunk of result.manifest.chunks){const lod=chunk.lods.find(l=>l.id==='high'),group=await decodeChunk(result.assets[lod.uri],lod),details=group.userData.city.nearDetails;
  for(const wall of details.facadeWalls){assert(!claimed.has(wall.featureId));assert.equal(result.manifest.featureIndex[wall.featureId].ownerChunk,chunk.id);walls.push(wall);}
  for(const tree of details.trees){assert.equal(result.manifest.featureIndex[tree.featureId].ownerChunk,chunk.id);trees.push(tree);}
  const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
 }
 assert.equal(new Set(walls.map(w=>w.key)).size,walls.length);assert.equal(new Set(trees.map(t=>t.featureId)).size,trees.length);assert.deepEqual(trees.map(t=>t.featureId).sort(),Object.values(result.manifest.featureIndex).filter(f=>f.kind==='tree').map(f=>f.featureId).sort());
 const signature=hash({walls:walls.sort((a,b)=>a.key.localeCompare(b.key)),trees:trees.sort((a,b)=>a.featureId.localeCompare(b.featureId))});if(expectedDetails)assert.equal(signature,expectedDetails);else expectedDetails=signature;
 report.nearOwnership.push({divisions,walls:walls.length,trees:trees.length,claimedLandmarks:claimed.size,signature});
}
const temporary=await mkdtemp(path.join(os.tmpdir(),'city-review-worker-'));let manager;
try {
 const project=path.join(temporary,'project'),queue=path.join(temporary,'queue');const normalizedConfig=validateProjectConfig(config).value;
 await createProject(project,{...normalizedConfig,source:{kind:'local',file:'data/source.json'}});await writeFile(path.join(project,'data/source.json'),JSON.stringify(raw));
 let cancelNext=false,lockCheck;
 manager=await new JobManager({directory:queue,runner:(job,onProgress,signal)=>workerRunner(job,p=>{onProgress(p);if(cancelNext&&p.stage==='plan'){cancelNext=false;lockCheck=(async()=>{let held=false;try{const release=await acquireProjectLock(project);await release();}catch(error){held=error.code==='PROJECT_BUSY';}assert(held,'Concurrent access must reject PROJECT_BUSY');await manager.cancel(job.id);})();}},signal)}).open();
 const first=await manager.enqueue('build',project),built=await manager.wait(first.id);assert.equal(built.status,'succeeded');const initialManifest=await readFile(path.join(project,'dist/manifest.json'));
 await patchProject(project,{seed:config.seed+1});cancelNext=true;const second=await manager.enqueue('build',project),cancelled=await manager.wait(second.id);await lockCheck;assert.equal(cancelled.status,'cancelled');assert.deepEqual(await readFile(path.join(project,'dist/manifest.json')),initialManifest);await manager.close();
 manager=await new JobManager({directory:queue}).open();await manager.resume(second.id);const resumed=await manager.wait(second.id);assert.equal(resumed.status,'succeeded');assert.equal(resumed.attempt,2);assert.notEqual(hash(await readFile(path.join(project,'dist/manifest.json'))),hash(initialManifest));await withProjectLock(project,()=>validateProject(project));
 report.worker={baseline:built.status,cancelled:cancelled.status,priorManifestPreserved:true,projectLockRejected:true,resumed:resumed.status,attempt:resumed.attempt,validateAfterResume:'succeeded'};
 const snapshots=[];
 for(const [version,ribWidth] of [['1.0.1',.7],['1.0.2',1.1]]){const directory=path.join(temporary,version);await mkdir(directory);const recipe=structuredClone(official.recipes[0]);recipe.version=version;recipe.parameters.ribWidth=ribWidth;await writeFile(path.join(directory,'recipes.json'),JSON.stringify({schemaVersion:1,id:'review-package',version,engineCompatibility:official.engineCompatibility,recipes:[recipe]}));const job=await manager.enqueue('update-landmarks',project,{packagePath:directory}),result=await manager.wait(job.id);assert.equal(result.status,'succeeded');snapshots.push(JSON.parse(await readFile(path.join(project,'city.lock.json'),'utf8')));}
 assert.notDeepEqual(snapshots[0].assetHashes,snapshots[1].assetHashes);const rollback=await manager.enqueue('update-landmarks',project,{rollback:true}),rolled=await manager.wait(rollback.id);assert.equal(rolled.status,'succeeded');const finalLock=JSON.parse(await readFile(path.join(project,'city.lock.json'),'utf8'));assert.deepEqual(finalLock.assetHashes,snapshots[0].assetHashes);assert.equal(finalLock.contentHash,snapshots[0].contentHash);await withProjectLock(project,()=>validateProject(project));report.worker.recipes={versions:['1.0.1','1.0.2'],assetsChanged:true,rollbackAssetsEqual:true,rollbackContentHashEqual:true,finalValidate:'succeeded'};
}finally{await manager?.close();assert(path.resolve(temporary).startsWith(path.join(os.tmpdir(),'city-review-worker-')));await rm(temporary,{recursive:true,force:true});}
console.log(JSON.stringify(report));await writeFile(new URL('./node-flows-results.json',import.meta.url),JSON.stringify(report,null,2));
