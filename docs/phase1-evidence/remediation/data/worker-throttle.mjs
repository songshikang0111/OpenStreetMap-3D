// Local HTTP fixture, four real batch workers. This is not live-map evidence.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {createProject,OFFLINE_SAMPLE} from '../../../../src/cli/project.js';
import {runCLI} from '../../../../src/cli/index.js';
const repository=fileURLToPath(new URL('../../../../',import.meta.url));
const base=path.join(repository,'work/data-remediation');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'throttle-'));
const requests=[];const server=createServer((req,res)=>{requests.push({at:Date.now(),method:req.method,url:req.url});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(OFFLINE_SAMPLE));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}/interpreter`;
try{
  for(let index=0;index<4;index++)await createProject(path.join(root,`city-${index}`),{sample:true,source:{endpoint,transport:'get'}});
  const list=path.join(root,'batch.json');await writeFile(list,JSON.stringify({projects:Array.from({length:4},(_,index)=>({project:`city-${index}`,kind:'fetch'}))}));
  let stdout='',stderr='';const result=await runCLI(['batch',list,'--concurrency','4','--json'],{cwd:repository,stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});
  assert.equal(JSON.parse(stdout).status,'succeeded');assert.equal(result.status,'succeeded');assert.equal(requests.length,4);
  const relativeMs=requests.map(r=>r.at-requests[0].at),gaps=relativeMs.slice(1).map((time,index)=>time-relativeMs[index]);assert.ok(gaps.every(ms=>ms>=1000));
  const record={recordedAt:new Date().toISOString(),fixture:true,injectedRunner:false,realBatchWorkers:4,concurrency:4,scope:'One parent CLI process brokers HTTP for its worker threads. No cross-process global rate limit is claimed.',endpoint,relativeMs,gaps,statuses:result.jobs.map(job=>job.status),methods:requests.map(r=>r.method),projectRoot:root};
  const output=path.resolve(process.argv[2]||path.join(base,'worker-throttle.json'));await writeFile(output,JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await new Promise(resolve=>server.close(resolve));}
