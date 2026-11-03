import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath;if(!npm)throw new Error('Run this check through npm run check:package.');
const temporary=await mkdtemp(path.join(os.tmpdir(),'city-package-'));
async function command(args,cwd=root){
  return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.on('error',reject);child.on('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error(`Exit ${code}: ${stdout}\n${stderr}`)));});
}
let service;
try{
  const packed=JSON.parse((await command([npm,'pack','--ignore-scripts','--json','--pack-destination',temporary])).stdout)[0],files=packed.files.map(file=>file.path);
  for(const expected of ['bin/city.js','src/sdk/index.js','src/sdk/index.d.ts','src/core/index.js','src/core/index.d.ts','src/data/index.js','src/styles/index.js','src/landmark-registry.js','schemas/project.schema.json','studio/dist/index.html','dist-sdk/city-ink.js'])assert.ok(files.includes(expected),`Missing package entry ${expected}; run npm run build first.`);
  const denied=files.filter(file=>/^(?:work|public|private|\.city)/.test(file)||/(?:^|\/)(?:node_modules|\.city-cache|\.city-service)(?:\/|$)/.test(file)||/\.(?:cink|glb|tgz)$/.test(file));assert.deepEqual(denied,[]);
  const consumer=path.join(temporary,'consumer');await mkdir(consumer);await writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'city-package-consumer',private:true,type:'module'}));
  await command([npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund',path.join(temporary,packed.filename)],consumer);
  await copyFile(path.join(root,'examples/quickstart/typecheck.ts'),path.join(consumer,'typecheck.ts'));
  await command([path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',path.join(consumer,'typecheck.ts')],consumer);
  const installed=path.join(consumer,'node_modules/beijing-city-ink'),bin=path.join(installed,'bin/city.js'),project=path.join(consumer,'city');
  const cli=[];
  for(const args of [['--help','--json'],['init',project,'--sample','--json'],['build','--project',project,'--offline','--json'],['validate','--project',project,'--offline','--json'],['export','web','--project',project,'--json']]){
    const result=await command([bin,...args],consumer),json=JSON.parse(result.stdout);assert.equal(json.status,'succeeded',JSON.stringify(json));cli.push({args,result:json,progressOnStderr:result.stderr.length>0});
  }
  const {createLocalServer}=await import(pathToFileURL(path.join(installed,'src/local-server/index.js')).href);service=await createLocalServer({projectRoot:project,port:0,sample:false});
  const response=await fetch(service.url),html=await response.text();assert.equal(response.status,200);assert.match(html,/城市线境/);
  const script=html.match(/src="([^"]+\.js)"/)[1],module=await fetch(new URL(script,service.url+'/'));assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
  const projects=await fetch(service.url+'/api/projects').then(response=>response.json()),id=projects.projects[0].id;
  const manifest=await fetch(`${service.url}/projects/${id}/dist/manifest.json`).then(response=>response.json());assert.ok(manifest.chunks.length);
  assert.equal((await fetch(service.url+'/src/cli/project.js')).status,404);
  const report={date:new Date().toISOString(),status:'pass',archive:{filename:packed.filename,size:packed.size,unpackedSize:packed.unpackedSize,integrity:packed.integrity,shasum:packed.shasum,files:packed.files},consumer:{offlineInstall:true,strictTypes:true,cli,builtStudio:true,staticSdk:true,projectChunks:manifest.chunks.length},notes:['Temporary package installed offline from local npm cache.','No npm publish, push or external deployment.','Browser rendering is validated separately; this check verifies installed entry points, worker compiler and local server.']};
  await writeFile(path.join(root,'docs/phase1-evidence/integration/package-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,files:files.length,archiveBytes:packed.size,unpackedBytes:packed.unpackedSize,offlineInstall:true,strictTypes:true,builtStudio:true}));
}finally{await service?.close();await rm(temporary,{recursive:true,force:true});}
