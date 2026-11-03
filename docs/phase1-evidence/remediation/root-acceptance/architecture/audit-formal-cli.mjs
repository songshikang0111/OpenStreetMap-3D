// Read-only audit of completed CLI records and existing files; no city commands.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:path.dirname(fileURLToPath(import.meta.url)),encoding:'utf8'}).trim();
const directory=path.dirname(fileURLToPath(import.meta.url)),outputDirectory=path.join(repository,'work/root-remediation-architecture/replay'),target=path.join(repository,'work/root-remediation-acceptance/live-rebuild');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_key,o)=>o&&typeof o==='object'&&!Array.isArray(o)?Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]])):o);
const formal=await json(path.join(directory,'formal-live-cli-results.json')),rejected=await json(path.join(directory,'cli-copied-job-store-rejected.json'));
assert.equal(formal.status,'succeeded');assert.equal(formal.commandsExecuted,5);assert.equal(formal.records.length,5);
assert.equal(formal.freeze,'e11990c5dc6175dbdae7c2789b2c3a4e4f7f0a9c');
const words=formal.records.map(record=>{
 assert.equal(record.exitCode,0);assert.equal(record.result.status,'succeeded');assert(record.argv.includes('--offline'));assert(record.argv.includes('--json'));
 const index=record.argv.indexOf('--project');assert.equal(path.resolve(record.argv[index+1]),target);return record.argv.slice(1,index);
});
assert.deepEqual(words,[['data','fetch'],['build'],['validate'],['build'],['validate']]);
const fetched=formal.records[0].result.job.result;assert.equal(fetched.cacheHit,true);assert.deepEqual(fetched.source.attempts,[]);
const [first,second]=formal.builds,{builtAt:firstAt,...firstCore}=first,{builtAt:secondAt,...secondCore}=second;assert.deepEqual(firstCore,secondCore);
const sourceBytes=await readFile(path.join(target,'data/source.json')),source=JSON.parse(sourceBytes),configBytes=await readFile(path.join(target,'city.config.json')),lock=await json(path.join(target,'city.lock.json'));
assert.equal(sha(sourceBytes),formal.expected.sourceFileHash);assert.equal(sha(stable(source.elements)),formal.expected.contentHash);assert.equal(sha(configBytes),second.inputs.configHash);
assert.equal(lock.contentHash,second.contentHash);assert.deepEqual(lock.assetHashes,second.assetHashes);assert.equal(sha(await readFile(path.join(target,'dist/manifest.json'))),second.manifestHash);
for(const [name,digest]of Object.entries(second.assetHashes))assert.equal(sha(await readFile(path.join(target,'dist',name))),digest);
for(const field of ['endpoint','transport','retrievedAt','osmBaseTimestamp','sourceHash'])assert.equal(source.metadata[field],formal.preflight.source[field]);
const cache=await json(path.join(target,'.city-cache/data',`${fetched.source.cacheKey}.json`));assert.equal(cache.snapshotHash,sha(stable(cache.raw)));assert.equal(cache.snapshotHash,formal.preflight.cacheSnapshotHash);assert.equal(sha(stable(cache.raw.elements)),formal.expected.contentHash);
assert.equal(rejected.status,'failed');assert.equal(rejected.records.length,1);assert.equal(rejected.records[0].exitCode,1);assert.equal(rejected.records[0].result.diagnostics[0].code,'JOB_PROJECT_ESCAPE');
const movedDirectory=path.join(repository,'work/root-remediation-acceptance/copied-original-machine-job-store'),moved=[];
for(const file of(await readdir(movedDirectory)).filter(file=>file.endsWith('.json'))){const job=await json(path.join(movedDirectory,file));assert.notEqual(path.resolve(job.project),target);moved.push({file,kind:job.kind,project:job.project});}
assert.equal(moved.length,3);
const originalProject=moved[0].project;assert(moved.every(job=>job.project===originalProject));
assert.equal(sha(await readFile(path.join(originalProject,'data/source.json'))),formal.expected.sourceFileHash);assert.equal(sha(await readFile(path.join(originalProject,'city.config.json'))),sha(configBytes));
const currentJobs=[];for(const file of(await readdir(path.join(target,'.city-cache/jobs'))).filter(file=>file.endsWith('.json'))){const job=await json(path.join(target,'.city-cache/jobs',file));assert.equal(path.resolve(job.project),target);assert.equal(job.status,'succeeded');currentJobs.push({id:job.id,kind:job.kind});}
const checks=await json(path.join(repository,'docs/phase1-evidence/remediation/integration/final-checks/checks.json'));assert.equal(checks.commit,formal.freeze);assert.equal(checks.afterCommit,formal.freeze);const checkEntries=['tests','types','build','package'].map(name=>({name,exitCode:checks[name]}));assert(checkEntries.every(check=>check.exitCode===0));
const tap=await readFile(path.join(repository,'docs/phase1-evidence/remediation/integration/final-checks/tests.tap'),'utf8');assert.match(tap,/# tests 344\r?\n/);assert.match(tap,/# pass 344\r?\n/);assert.match(tap,/# fail 0\r?\n/);
const observedHead=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
const productDelta=execFileSync('git',['diff','--name-only',formal.freeze,observedHead,'--','src','bin','studio','schemas','package.json','package-lock.json','scripts','test','vite.config.js','vite.sdk.config.js','vite.studio.config.js'],{cwd:repository,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);assert.deepEqual(productDelta,[]);
const result={date:new Date().toISOString(),status:'pass',scope:'Only read stored completed CLI evidence, job records, snapshot/cache/config/manifest/assets and final checks; no city CLI, network, browser or GPU executed.',executionFreeze:formal.freeze,observedHead,productDelta,commands:words.map((words,index)=>({words,exitCode:formal.records[index].exitCode,status:formal.records[index].result.status})),source:{...formal.preflight.source,actualFileHash:sha(sourceBytes),actualElementHash:sha(stable(source.elements))},cacheHit:true,cacheAttempts:[],repeatedBuild:{contentHash:second.contentHash,manifestHash:second.manifestHash,assetCount:Object.keys(second.assetHashes).length,inputsAndAssetHashesIdentical:true,actualFileHashesMatch:true,builtAt:[firstAt,secondAt]},copiedJobStore:{firstAttempt:'JOB_PROJECT_ESCAPE, exit 1',movedDirectory,originalProject,movedJobs:moved.length,newJobs:currentJobs,originalSourceAndConfigStillMatch:true,note:'Absolute-project-bound local operation/recovery state was copied. Root moved only the copied jobs directory intact; this is distinct from project inputs and the source data cache. The original B project was not edited by this audit.'},checks:{commit:checks.commit,status:'pass (derived from four exact zero exit codes)',tests:344,checks:checkEntries}};
await mkdir(outputDirectory,{recursive:true});await writeFile(path.join(outputDirectory,'formal-cli-audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,executionFreeze:result.executionFreeze,commands:result.commands.length,cacheHit:result.cacheHit,repeatedBuild:result.repeatedBuild,originalSourceAndConfigStillMatch:true,checks:result.checks},null,2));
