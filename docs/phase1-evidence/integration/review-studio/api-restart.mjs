import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createProject,importData} from '../../src/cli/project.js';
import {validateProject} from '../../src/cli/tasks.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.dirname(fileURLToPath(import.meta.url));
const workspace=path.join(directory,'server-workspace'),project=path.join(workspace,'real-beijing');await mkdir(workspace,{recursive:true});
const raw=JSON.parse(await readFile(path.join(root,'public/data/beijing-cbd.json'))),[south,west,north,east]=raw.metadata.bbox;
await createProject(project,{name:'Independent crash and cancel Beijing',area:{south,west,north,east}});await importData(project,path.join(root,'public/data/beijing-cbd.json'));
const childScript=path.join(directory,'server-child.mjs');await writeFile(childScript,"import {createLocalServer} from '../../src/local-server/index.js';\nconst service=await createLocalServer({workspaceRoot:process.argv[2],port:0,sample:false,offline:true});console.log(JSON.stringify({url:service.url}));\n");
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),input:'Complete committed Beijing OSM snapshot, not a live download',results:[]};
let child,url;
async function start(){return new Promise((resolve,reject)=>{child=spawn(process.execPath,[childScript,workspace],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>reject(new Error('service startup timeout '+err)),15000);child.stderr.on('data',data=>err+=data);child.stdout.on('data',data=>{out+=data;if(out.includes('\n')){clearTimeout(timer);try{url=JSON.parse(out.split('\n')[0]).url;resolve();}catch(error){reject(error);}}});child.on('error',reject);child.on('exit',code=>{if(!url){clearTimeout(timer);reject(new Error('service exit '+code+' '+err));}});});}
async function stop(){if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;}child=null;url=null;}
async function request(route,body){const response=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
async function until(id,predicate){const deadline=Date.now()+120000;while(Date.now()<deadline){const job=(await request('/api/jobs/'+id)).job;if(predicate(job))return job;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('job timeout');}
try{
 await start();const opened=await request('/api/projects/open',{relativePath:'real-beijing'}),projectId=opened.project.id;
 const started=await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{offline:true}}),id=started.job.id;
 const interrupted=await until(id,job=>job.status==='running'&&job.stage!=='starting');await stop();await start();
 const restored=(await request('/api/jobs/'+id)).job;assert.equal(restored.status,'failed');assert.ok(restored.diagnostics.some(d=>d.code==='INTERRUPTED'));
 await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{offline:true},resume:id});const resumed=await until(id,job=>['failed','succeeded','cancelled'].includes(job.status));assert.equal(resumed.status,'succeeded',JSON.stringify(resumed));assert.equal(resumed.attempt,2);await validateProject(project);
 report.results.push({name:'actual worker process crash / restart / same-ID resume',status:'pass',id,interruptedStage:interrupted.stage,restoredStatus:restored.status,attempt:resumed.attempt,contentHash:resumed.result.contentHash});
 const before=await readFile(path.join(project,'dist/manifest.json'),'utf8');
 const next=await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{offline:true}});await until(next.job.id,job=>job.status==='running'&&job.stage!=='starting');await request(`/api/jobs/${next.job.id}/cancel`,{});const cancelled=await until(next.job.id,job=>['failed','succeeded','cancelled'].includes(job.status));assert.equal(cancelled.status,'cancelled');assert.equal(await readFile(path.join(project,'dist/manifest.json'),'utf8'),before);
 await request(`/api/projects/${projectId}/jobs`,{kind:'build',parameters:{offline:true},resume:next.job.id});const repeated=await until(next.job.id,job=>['failed','succeeded','cancelled'].includes(job.status));assert.equal(repeated.status,'succeeded');assert.equal(repeated.result.contentHash,resumed.result.contentHash);await validateProject(project);
 report.results.push({name:'actual worker cancellation preserves output / resume deterministic',status:'pass',id:next.job.id,cancelled:cancelled.status,attempt:repeated.attempt,contentHash:repeated.result.contentHash});
 report.status='pass';
}catch(error){report.status='fail';report.error=error.stack;process.exitCode=1;}finally{await stop();await writeFile(path.join(directory,'api-restart-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
