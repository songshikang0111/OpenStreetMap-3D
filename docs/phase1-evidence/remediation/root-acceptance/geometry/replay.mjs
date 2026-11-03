import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Preserve archived originals; execute copies from ignored work. The source
// version guard uses the equivalent integrated commit, reachable in a normal
// clone, instead of requiring the donor worktree's cherry-picked Git object.
const archiveDirectory=dirname(fileURLToPath(import.meta.url));
const usage='Usage: node <archived-geometry>/replay.mjs --assets-root <official-cases-directory>';
function optionValue(name){const args=process.argv.slice(2),inline=args.find(s=>s.startsWith(name+'='));if(inline)return inline.slice(name.length+1);const index=args.indexOf(name);return index>=0?args[index+1]:undefined;}
function isRepository(candidate){return existsSync(join(candidate,'package.json'))&&existsSync(join(candidate,'src','core','index.js'))&&existsSync(join(candidate,'scripts','phase1-build-cases.mjs'));}
function repositoryFromGit(directory){try{const candidate=execFileSync('git',['-C',directory,'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();return isRepository(candidate)?resolve(candidate):null;}catch{return null;}}
function findRepository(){for(const directory of [archiveDirectory,process.cwd()]){const fromGit=repositoryFromGit(directory);if(fromGit)return fromGit;let candidate=resolve(directory);while(true){if(isRepository(candidate))return candidate;const parent=dirname(candidate);if(parent===candidate)break;candidate=parent;}}throw new Error('Cannot locate the City Ink repository from this archive or the current directory. Run from its checkout.');}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
function fail(message){process.stderr.write(message+'\n');process.exitCode=1;}
if(process.argv.includes('--help'))process.stdout.write(usage+'\n');
else{
 try{
  const suppliedAssets=optionValue('--assets-root');if(!suppliedAssets||suppliedAssets.startsWith('--'))throw new Error(usage+'\n--assets-root must be supplied explicitly.');
  const assetsRoot=resolve(process.cwd(),suppliedAssets);if(!existsSync(assetsRoot)||!statSync(assetsRoot).isDirectory())throw new Error('Asset directory does not exist: '+assetsRoot);
  const repository=findRepository(),manifest=JSON.parse(readFileSync(join(archiveDirectory,'staging-manifest.json'),'utf8').replace(/^\uFEFF/,'')),files=manifest.canonicalReplayFiles;
  if(!Array.isArray(files)||files.length===0)throw new Error('The archive is missing canonicalReplayFiles.');
  const workDirectory=join(repository,'work');mkdirSync(workDirectory,{recursive:true});
  // One directory directly below work keeps original ../../src and ../../test
  // imports valid, and every fresh runner output stays outside the docs archive.
  const replayDirectory=mkdtempSync(join(workDirectory,'root-remediation-geometry-replay-'));
  const fromRoot=relative(repository,replayDirectory).split(sep);if(fromRoot.length!==2||fromRoot[0]!=='work')throw new Error('Replay output must be a single directory directly below repository/work.');
  try{execFileSync('git',['-C',repository,'check-ignore','--quiet',replayDirectory],{stdio:'ignore',windowsHide:true});}catch{throw new Error('The replay directory is not Git-ignored: '+replayDirectory);}
  for(const file of files){if(typeof file.path!=='string'||isAbsolute(file.path)||basename(file.path)!==file.path)throw new Error('Canonical replay files must be top-level archive files.');const source=join(archiveDirectory,file.path),target=join(replayDirectory,file.path),bytes=readFileSync(source);if(digest(bytes)!==file.sha256)throw new Error('Archived canonical SHA-256 mismatch: '+file.path);copyFileSync(source,target);if(digest(readFileSync(target))!==file.sha256)throw new Error('Copied canonical SHA-256 mismatch: '+file.path);}
  const runnerPath=join(replayDirectory,'run-final-geometry.mjs'),originalRunner=readFileSync(runnerPath,'utf8');
  const historical="sourceFrozenCommit='3b62b40281c116352dd8bd379cb22331d026f2df'",integrated="sourceFrozenCommit='e11990c5dc6175dbdae7c2789b2c3a4e4f7f0a9c'";
  if(originalRunner.split(historical).length!==2)throw new Error('Unexpected canonical source-version guard.');
  const portableRunner=originalRunner.replace(historical,integrated);writeFileSync(runnerPath,portableRunner);
  writeFileSync(join(replayDirectory,'source-reference-adaptation.json'),JSON.stringify({historicalCommit:'3b62b40281c116352dd8bd379cb22331d026f2df',integratedCommit:'e11990c5dc6175dbdae7c2789b2c3a4e4f7f0a9c',purpose:'Same frozen core content, reachable source reference for a normal integration-branch clone. No assertion or threshold changes.',originalRunnerSHA256:digest(Buffer.from(originalRunner)),derivedRunnerSHA256:digest(Buffer.from(portableRunner))},null,2));
  process.stdout.write('Replay workspace: '+replayDirectory+'\n');
  const child=spawn(process.execPath,[join(replayDirectory,'run-final-geometry.mjs'),'--run','--assets-root='+assetsRoot],{cwd:repository,stdio:'inherit',windowsHide:true});
  child.once('error',error=>fail('Unable to start canonical geometry runner: '+error.message));
  child.once('exit',(code,signal)=>{if(signal)fail('Canonical geometry runner stopped by '+signal);else process.exitCode=code??1;});
 }catch(error){fail(error.message);}
}
