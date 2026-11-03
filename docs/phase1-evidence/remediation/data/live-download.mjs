// Explicit live probe: one formal CLI fetch, then offline cache/build/validation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {hash,readJSON} from '../../../../src/data/common.js';
const repository=fileURLToPath(new URL('../../../../',import.meta.url));
const cli=path.join(repository,'bin/city.js'),run=promisify(execFile);
const options=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,args)=>index%2?pairs:[...pairs,[value.replace(/^--/,''),args[index+1]]],[]));
const endpoint=options.endpoint||'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const transport=options.transport||'get',area=options.area||'39.9109,116.4595,39.9122,116.4615';
const base=path.join(repository,'work/data-remediation');await mkdir(base,{recursive:true});const project=await mkdtemp(path.join(base,'live-'));
const records=[];
async function command(args){
  const started=performance.now();let stdout,stderr,exitCode=0;
  try{({stdout,stderr}=await run(process.execPath,[cli,...args,'--json'],{cwd:repository,maxBuffer:8*1024*1024}));}
  catch(error){({stdout,stderr}=error);exitCode=error.code;}
  const result=JSON.parse(stdout);records.push({args,status:result.status,exitCode,elapsedMs:Math.round(performance.now()-started),result,stderr});
  if(result.status!=='succeeded')throw Object.assign(new Error(JSON.stringify(result.diagnostics)),{records,exitCode});return result;
}
try{
  await command(['init',project,'--name','Live OSM extract','--area',area,'--endpoint',endpoint,'--transport',transport]);
  const first=await command(['data','fetch','--project',project]);assert.equal(first.job.result.cacheHit,false);
  const snapshot=await readJSON(path.join(project,'data/source.json')),sourceFileHash=hash(await readFile(path.join(project,'data/source.json')));
  assert.equal(snapshot.metadata.endpoint,endpoint);assert.equal(snapshot.metadata.transport,transport);assert.ok(snapshot.metadata.retrievedAt);assert.match(snapshot.metadata.sourceHash,/^[a-f0-9]{64}$/);assert.ok(snapshot.elements.some(e=>e.tags?.building),'Live area must contain real buildings.');
  const cached=await command(['data','fetch','--project',project,'--offline']);assert.equal(cached.job.result.cacheHit,true);assert.equal(hash(await readFile(path.join(project,'data/source.json'))),sourceFileHash);
  await command(['build','--project',project,'--offline']);await command(['validate','--project',project,'--offline']);
  const lock=await readJSON(path.join(project,'city.lock.json')),manifest=await readJSON(path.join(project,'dist/manifest.json'));
  assert.equal(lock.inputs.sourceFileHash,sourceFileHash);assert.equal(manifest.sources[0].metadata.endpoint,endpoint);
  const result={recordedAt:new Date().toISOString(),repository,project,environment:{node:process.version,platform:process.platform},source:{endpoint,transport,area,retrievedAt:snapshot.metadata.retrievedAt,osmBaseTimestamp:snapshot.metadata.osmBaseTimestamp,sourceHash:snapshot.metadata.sourceHash,contentHash:snapshot.metadata.contentHash,sourceFileHash},elements:snapshot.elements.length,buildings:snapshot.elements.filter(e=>e.tags?.building).length,manifestHash:lock.manifestHash,sceneContentHash:lock.contentHash,chunks:manifest.chunks.length,status:'succeeded',records};
  const output=path.resolve(options.output||path.join(base,'formal-cli-results.json'));await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,output,project,elements:result.elements,buildings:result.buildings,chunks:result.chunks,source:result.source}));
}catch(error){const output=path.resolve(options.output||path.join(base,'formal-cli-results.json'));await writeFile(output,JSON.stringify({recordedAt:new Date().toISOString(),project,status:'failed',message:error.message,records},null,2));console.error(error.message);process.exitCode=1;}
