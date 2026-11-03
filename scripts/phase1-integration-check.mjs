import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {runCLI,exitCode,runBatch} from '../src/cli/index.js';
import {createProject,readProject,patchProject,importData,SAMPLE_AREA} from '../src/cli/project.js';
import {buildProject,validateProject} from '../src/cli/tasks.js';
import {exportProject} from '../src/cli/export.js';
import {createLocalServer} from '../src/local-server/index.js';
import official from '../packages/landmarks/index.js';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.join(root,'work/integration-e2e',new Date().toISOString().replaceAll(/[:.]/g,'-'));
const evidence=path.join(root,'docs/phase1-evidence/integration');await mkdir(directory,{recursive:true});await mkdir(evidence,{recursive:true});
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),directory,node:process.version,results:[]};
async function check(name,operation){const started=performance.now();try{const details=await operation();report.results.push({name,status:'pass',durationMs:performance.now()-started,details});console.log(JSON.stringify({name,status:'pass'}));}catch(error){report.results.push({name,status:'fail',durationMs:performance.now()-started,error:error.stack});console.error(JSON.stringify({name,status:'fail',error:error.message}));}await writeFile(path.join(evidence,'e2e-results.json'),JSON.stringify(report,null,2));}
const project=path.join(directory,'sample'),second=path.join(directory,'sample-two'),broken=path.join(directory,'recovered');
await check('offline project / deterministic rebuild',async()=>{
  await createProject(project,{sample:true,name:'Offline e2e synthetic'});await createProject(second,{sample:true,name:'Second discrete synthetic project'});await createProject(broken,{area:SAMPLE_AREA,name:'Initially missing input'});
  const first=await buildProject(project),rebuilt=await buildProject(project);assert.equal(rebuilt.contentHash,first.contentHash);await validateProject(project);
  return {contentHash:first.contentHash,report:first.report,source:'Explicitly synthetic offline example; not live OSM evidence'};
});
await check('runtime-only settings do not stale geometry; geometry input does',async()=>{
  const config=await readProject(project);
  await patchProject(project,{camera:{position:[200,160,200],target:[0,10,0],fov:50},style:{id:'line',parameters:{}},quality:'low'});
  await validateProject(project);
  await patchProject(project,{seed:config.seed+1});await assert.rejects(validateProject(project),error=>error.code==='STALE_BUILD');
  await patchProject(project,{seed:config.seed});await validateProject(project);
});
await check('CLI JSON / batch partial failure and resume',async()=>{
  let stdout='',stderr='';const help=await runCLI(['--help','--json'],{stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});assert.equal(JSON.parse(stdout).schemaVersion,1);assert.equal(exitCode(help),0);
  const list=path.join(directory,'batch.json');await writeFile(list,JSON.stringify({projects:[{project:'sample',kind:'build'},{project:'sample-two',kind:'build'},{project:'recovered',kind:'build'}]}));
  const partial=await runBatch(list,{concurrency:2});assert.equal(partial.status,'partial');assert.equal(exitCode(partial),2);assert.equal(partial.jobs.filter(j=>j.status==='succeeded').length,2);
  await importData(broken,path.join(project,'data/source.json'));const resumed=await runBatch(list,{resume:true,concurrency:2});assert.equal(resumed.status,'succeeded');assert.equal(exitCode(resumed),0);
  return {partial:partial.jobs.map(j=>({id:j.id,status:j.status,diagnostics:j.diagnostics})),resumed:resumed.jobs.map(j=>({id:j.id,status:j.status})),help:help.help,stderr};
});
await check('complete static export / nested output / cancellation preserves old site',async()=>{
  const exported=await exportProject(project,{format:'web',output:'exports/nested'});assert.equal(exported.status,'succeeded');await readFile(path.join(project,'exports/nested/assets/city-ink.js'));
  await exportProject(project,{format:'web'});const before=await readFile(path.join(project,'site/viewer-config.json'),'utf8');
  const controller=new AbortController();await assert.rejects(exportProject(project,{format:'web',signal:controller.signal,onProgress:p=>{if(p.stage==='publish-site')controller.abort();}}));
  assert.equal(await readFile(path.join(project,'site/viewer-config.json'),'utf8'),before);
  const html=await readFile(path.join(project,'site/index.html'),'utf8');assert.ok(!/https?:\/\//.test(html));
  return {output:exported.artifacts,cancelledBeforePublication:true};
});
await check('actual local API / origin and path boundary / worker cancel and resume',async()=>{
  const service=await createLocalServer({workspaceRoot:directory,port:0,sample:false});
  const request=async(route,body,extra={})=>{const response=await fetch(service.url+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),...extra});return {status:response.status,value:await response.json()};};
  try{
    const opened=await request('/api/projects/open',{relativePath:'sample'});assert.equal(opened.status,200);const id=opened.value.project.id;
    const listed=await request('/api/projects');assert.ok(listed.value.projects.some(p=>p.id===id));
    const escape=await request('/api/projects/open',{relativePath:'../'});assert.equal(escape.status,403);
    const cross=await request('/api/projects',undefined,{headers:{Origin:'https://untrusted.invalid'}});assert.equal(cross.status,403);
    const coordinates=await request('/api/search?q=39.9095%2C116.4605'),landmark=await request('/api/search?q=china-zun');assert.equal(coordinates.value.candidates[0].source,'coordinate');assert.equal(landmark.value.candidates[0].source,'official-landmark-index');
    const large=path.join(directory,'cancel-real');const raw=JSON.parse(await readFile(path.join(root,'public/data/beijing-cbd.json'),'utf8'));const [south,west,north,east]=raw.metadata.bbox;
    await createProject(large,{name:'Cancel real Beijing snapshot',area:{south,west,north,east}});await importData(large,path.join(root,'public/data/beijing-cbd.json'));
    const registered=await request('/api/projects/open',{relativePath:'cancel-real'}),projectId=registered.value.project.id;
    const started=await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{}}),jobId=started.value.job.id;
    await new Promise(resolve=>setTimeout(resolve,200));await request(`/api/jobs/${jobId}/cancel`,{});
    const wait=async job=>{const deadline=Date.now()+120000;while(Date.now()<deadline){const r=await request(`/api/jobs/${job}`);if(['succeeded','failed','cancelled'].includes(r.value.job.status))return r.value.job;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Job timeout');};
    const cancelled=await wait(jobId);assert.equal(cancelled.status,'cancelled');
    const retried=await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{},resume:jobId});const done=await wait(retried.value.job.id);assert.equal(done.status,'succeeded');
    const asset=await fetch(`${service.url}/projects/${projectId}/dist/manifest.json`);assert.equal(asset.status,200);
    return {registered:id,coordinates:coordinates.value.candidates,landmark:landmark.value.candidates,cancelled:{id:jobId,status:cancelled.status},resumed:{id:done.id,status:done.status,report:done.result?.report}};
  }finally{await service.close();}
});
await check('CLI PNG and complete GLB signatures',async()=>{
  const png=await exportProject(project,{format:'png'}),glb=await exportProject(project,{format:'glb'});
  const pngBytes=await readFile(path.join(project,png.artifacts[0])),glbBytes=await readFile(path.join(project,glb.artifacts[0]));
  assert.equal(pngBytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(glbBytes.subarray(0,4).toString(),'glTF');
  await cp(path.join(project,png.artifacts[0]),path.join(evidence,'sample-export.png'));
  return {png:{...png,bytes:pngBytes.length},glb:{...glb,bytes:glbBytes.length}};
});
await check('real CLI recipe versions / geometry change / locked rollback',async()=>{
  const source=JSON.parse(await readFile(path.join(root,'public/data/beijing-cbd.json'),'utf8')),zun=source.elements.find(element=>element.type==='way'&&element.id===599547918);
  assert.ok(zun);const latitudes=zun.geometry.map(point=>point.lat),longitudes=zun.geometry.map(point=>point.lon),area={south:Math.min(...latitudes)-.001,west:Math.min(...longitudes)-.001,north:Math.max(...latitudes)+.001,east:Math.max(...longitudes)+.001};
  const city=path.join(directory,'rules-real'),file=path.join(directory,'zun-real.json');await writeFile(file,JSON.stringify({...source,elements:[zun]}));await createProject(city,{name:'Real OSM China Zun rule update',area});await importData(city,file);await buildProject(city);
  const hashes=[];
  for(const [version,ribWidth] of [['1.0.1',.7],['1.1.0',1.2]]){
    const recipe=structuredClone(official.recipes[0]);recipe.version=version;recipe.parameters.ribWidth=ribWidth;
    const pack=path.join(directory,`recipes-${version}`);await mkdir(pack);await writeFile(path.join(pack,'recipes.json'),JSON.stringify({schemaVersion:1,id:'integration/landmarks',version,engineCompatibility:'>=1.0.0 <2.0.0',recipes:[recipe]}));
    const result=await runCLI(['landmarks','update',pack,'--project',city,'--json'],{stdout:{write(){}},stderr:{write(){}}});assert.equal(result.status,'succeeded',JSON.stringify(result.diagnostics));
    const manifest=JSON.parse(await readFile(path.join(city,'dist/manifest.json'),'utf8'));hashes.push(manifest.chunks.flatMap(chunk=>chunk.lods.filter(lod=>lod.id==='high').map(lod=>lod.hash)));await validateProject(city);
  }
  assert.notDeepEqual(hashes[0],hashes[1]);
  const rollback=await runCLI(['landmarks','update','--rollback','--project',city,'--json'],{stdout:{write(){}},stderr:{write(){}}});assert.equal(rollback.status,'succeeded');
  const restored=JSON.parse(await readFile(path.join(city,'dist/manifest.json'),'utf8')).chunks.flatMap(chunk=>chunk.lods.filter(lod=>lod.id==='high').map(lod=>lod.hash));assert.deepEqual(restored,hashes[0]);
  return {versions:['1.0.1','1.1.0','1.0.1'],highGeometryHashes:[...hashes,restored],input:'Real OSM China Zun way/599547918 from repository snapshot; complete inline geometry'};
});
report.status=report.results.every(item=>item.status==='pass')?'pass':'fail';await writeFile(path.join(evidence,'e2e-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,directory}));process.exitCode=report.status==='pass'?0:1;
