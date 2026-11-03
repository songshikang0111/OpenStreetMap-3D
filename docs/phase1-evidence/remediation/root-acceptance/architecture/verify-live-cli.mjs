// Defaults to read-only preflight. --run --freeze <full HEAD> is required to
// update only the copied acceptance project; the original B project is unused.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';

const runFile=promisify(execFile);
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:path.dirname(fileURLToPath(import.meta.url)),encoding:'utf8'}).trim();
const evidenceRoot=path.resolve(repository,'work/root-remediation-architecture/replay');
const project=path.resolve(repository,'work/root-remediation-acceptance/live-rebuild');
const cli=path.join(repository,'bin/city.js');
const expected={sourceFileHash:'cc8d7da7f9059f9705091995c348c57cf9a656cc48de42a21fd2ab50a319e4a6',contentHash:'69427e177a82fc1671deee1230ff438bccf6482af014e350dce82859c1c11aab'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>sha(stable(value));
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:repository,encoding:'utf8'}).trim();
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(['--run','--preflight'].includes(args[i]))options[args[i].slice(2)]=true;
  else if(['--freeze','--output'].includes(args[i])&&args[i+1])options[args[i].slice(2)]=args[++i];
  else throw new Error(`Unknown or incomplete option: ${args[i]}`);
}
assert(!(options.run&&options.preflight),'Choose --run or --preflight.');
if(options.run)assert.match(options.freeze||'',/^[a-f0-9]{40}$/,'--run requires the exact full --freeze commit.');
const output=path.resolve(repository,options.output||path.join(evidenceRoot,options.run?'formal-live-cli-results.json':'cli-preflight.json'));
assert(output.startsWith(evidenceRoot+path.sep)&&output.endsWith('.json'),'Evidence output must remain under work/root-remediation-architecture/replay/.');
const records=[],report={schemaVersion:1,date:new Date().toISOString(),mode:options.run?'formal-offline-cli':'preflight-only',status:'running',repository,project,expected,requestedFreeze:options.freeze||null,commandsExecuted:0,records,limits:['No new public download; this reuses the separately evidenced B live snapshot.','Only the copied work/root-remediation-acceptance/live-rebuild project may be changed.','No browser, GPU, npm build, full test suite or edits to the original B project.']};
let baseline;

function contained(root,relative){
  assert.equal(typeof relative,'string');assert(!path.isAbsolute(relative));
  const result=path.resolve(root,relative),rel=path.relative(root,result);
  assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Project-relative file escapes the copied project.');return result;
}
async function preflight(){
  const actual=await realpath(project),allowed=await realpath(path.dirname(project));
  assert.equal(path.dirname(actual),allowed,'Copied project must not resolve outside its acceptance parent.');
  const configFile=path.join(project,'city.config.json'),configBytes=await readFile(configFile),config=JSON.parse(configBytes);
  const sourceFile=contained(project,config.source.file),sourceBytes=await readFile(sourceFile),raw=JSON.parse(sourceBytes);
  assert.equal(sha(sourceBytes),expected.sourceFileHash,'Copied source differs from the genuine B download.');
  assert.equal(hash(raw.elements),expected.contentHash,'Actual OSM elements differ from the recorded download.');
  assert.equal(raw.metadata.contentHash,expected.contentHash);
  assert.equal(raw.elements.length,1111);
  assert.equal(raw.elements.filter(e=>e.tags?.building).length,5);
  assert.equal(raw.elements.filter(e=>e.tags?.['building:part']).length,21);
  assert.equal(config.source.kind,'overpass');assert.equal(config.source.provider,'dresel-europe');
  assert.equal(config.source.endpoint,'https://ovp.dresel.systems/api/interpreter');assert.equal(config.source.transport,'get');
  const metadata=raw.metadata;
  assert.equal(metadata.endpoint,config.source.endpoint);assert.equal(metadata.transport,'get');
  assert(Number.isFinite(Date.parse(metadata.retrievedAt)),'Missing original retrieval timestamp.');
  assert.match(metadata.sourceHash,/^[a-f0-9]{64}$/);
  const cacheKey=hash({area:config.area,endpoint:config.source.endpoint,queryVersion:metadata.queryVersion,transport:'get'});
  const cacheFile=path.join(project,'.city-cache/data',`${cacheKey}.json`),cacheBytes=await readFile(cacheFile),cache=JSON.parse(cacheBytes);
  assert.equal(cache.key,cacheKey);assert.equal(cache.contentHash,expected.contentHash);
  assert.equal(cache.snapshotHash,hash(cache.raw));assert.equal(hash(cache.raw.elements),expected.contentHash);
  assert.equal(hash(cache.raw),hash(raw),'Cache and downloaded snapshot differ.');
  const oldLock=await json(path.join(project,'city.lock.json'));
  assert.equal(oldLock.inputs.sourceFileHash,expected.sourceFileHash);assert.equal(oldLock.inputs.dataHash,expected.contentHash);
  const source={provider:metadata.provider,endpoint:metadata.endpoint,transport:metadata.transport,retrievedAt:metadata.retrievedAt,osmBaseTimestamp:metadata.osmBaseTimestamp,sourceHash:metadata.sourceHash,contentHash:metadata.contentHash,sourceFileHash:sha(sourceBytes),attribution:metadata.attribution,license:metadata.license,queryVersion:metadata.queryVersion};
  baseline={configFile,configHash:sha(configBytes),sourceFile,sourceBytes,cacheFile,cacheHash:sha(cacheBytes),cacheKey,source};
  report.preflight={head:git('rev-parse','HEAD'),trackedChanges:git('status','--porcelain','--untracked-files=no'),source,elements:raw.elements.length,buildings:5,buildingParts:21,cacheKey,cacheSnapshotHash:cache.snapshotHash,previousEngineHash:oldLock.inputs.engineHash,previousContentHash:oldLock.contentHash,previousManifestHash:oldLock.manifestHash,previousBuiltAt:oldLock.build?.builtAt,commandsExecuted:0};
}
function freezeCheck(){
  assert.equal(git('rev-parse','HEAD'),options.freeze,'HEAD moved during the formal acceptance run.');
  assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked worktree changes violate the frozen run.');
}
async function assertInputsUnchanged(){
  assert.equal(sha(await readFile(baseline.sourceFile)),expected.sourceFileHash,'Source file changed during offline commands.');
  assert.equal(sha(await readFile(baseline.configFile)),baseline.configHash,'Project config changed during the run.');
  assert.equal(sha(await readFile(baseline.cacheFile)),baseline.cacheHash,'Existing data cache was changed.');
}
async function command(words){
  freezeCheck();await assertInputsUnchanged();
  const argv=[cli,...words,'--project',project,'--offline','--json'],started=performance.now();
  let stdout='',stderr='',exitCode=0;
  try{({stdout,stderr}=await runFile(process.execPath,argv,{cwd:repository,windowsHide:true,maxBuffer:32*1024*1024,timeout:300000}));}
  catch(error){stdout=error.stdout||'';stderr=error.stderr||'';exitCode=error.code??1;}
  let result;try{result=JSON.parse(stdout);}catch{records.push({argv,exitCode,elapsedMs:Math.round(performance.now()-started),stdout,stderr});throw new Error('Formal CLI did not return one JSON envelope.');}
  records.push({argv,exitCode,elapsedMs:Math.round(performance.now()-started),result,stderr});report.commandsExecuted++;
  assert.equal(exitCode,0,`CLI exit for ${words.join(' ')}`);assert.equal(result.status,'succeeded',`CLI status for ${words.join(' ')}`);
  freezeCheck();await assertInputsUnchanged();return result;
}
async function captureBuild(){
  const lock=await json(path.join(project,'city.lock.json')),manifestBytes=await readFile(path.join(project,'dist/manifest.json')),manifest=JSON.parse(manifestBytes);
  assert.equal(lock.inputs.sourceFileHash,expected.sourceFileHash);assert.equal(lock.inputs.dataHash,expected.contentHash);
  assert.equal(sha(manifestBytes),lock.manifestHash);
  assert.equal(hash({manifest,assets:lock.assetHashes}),lock.contentHash);
  for(const [name,digest]of Object.entries(lock.assetHashes))assert.equal(sha(await readFile(contained(path.join(project,'dist'),name))),digest,`Actual asset mismatch: ${name}`);
  const metadata=manifest.sources[0].metadata;
  for(const field of ['endpoint','transport','retrievedAt','osmBaseTimestamp','sourceHash','contentHash'])assert.deepEqual(metadata[field],baseline.source[field],`Lost source provenance: ${field}`);
  return {inputs:lock.inputs,contentHash:lock.contentHash,manifestHash:lock.manifestHash,assetHashes:lock.assetHashes,manifestHashes:manifest.hashes,features:Object.keys(manifest.featureIndex).length,chunks:manifest.chunks.length,builtAt:lock.build.builtAt};
}

try{
  await preflight();
  if(!options.run){report.status='prepared';report.note='No CLI commands or scene rebuild executed. Await an explicit product freeze and permission to run during a CPU/GPU-safe window.';}
  else{
    freezeCheck();
    const fetched=await command(['data','fetch']);assert.equal(fetched.job.kind,'fetch');assert.equal(fetched.job.result.cacheHit,true);assert.equal(fetched.job.result.source.cacheKey,baseline.cacheKey);assert.deepEqual(fetched.job.result.source.attempts,[]);
    for(const field of ['endpoint','transport','retrievedAt','osmBaseTimestamp','sourceHash'])assert.equal(fetched.job.result.source[field],baseline.source[field]);
    await command(['build']);await command(['validate']);const first=await captureBuild();
    await command(['build']);await command(['validate']);const second=await captureBuild();
    const {builtAt:firstAt,...firstCore}=first,{builtAt:secondAt,...secondCore}=second;assert.deepEqual(secondCore,firstCore,'Locked repeated builds differ in content/assets/manifest/inputs.');
    report.builds=[first,second];report.deterministic=true;report.sourceFileUnchanged=true;report.cacheUnchanged=true;report.provenanceUnchanged=true;report.status='succeeded';report.freeze=options.freeze;
  }
}catch(error){report.status='failed';report.error={name:error.name,code:error.code,message:error.message};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await mkdir(evidenceRoot,{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,mode:report.mode,commandsExecuted:report.commandsExecuted,output,error:report.error}));}
