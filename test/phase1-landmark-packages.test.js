import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createLandmarkRegistry,checkLandmarkPackage} from '../src/landmark-registry.js';
import {parseOSM} from '../src/osm.js';
const root=fileURLToPath(new URL('../',import.meta.url));
// Invoke npm's JS entrypoint directly: avoids Windows shell quoting of temp paths.
const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const npm=(args,cwd)=>execFileSync(process.execPath,[npmCli,...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});

test('official npm archives install offline, update/lock/rebuild/rollback and exclude generated/private artifacts',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-ink-pack-'));
  try {
    const packed=[];
    for(const name of ['landmarks','styles']){
      const report=JSON.parse(npm(['pack','--json','--pack-destination',temp],path.join(root,'packages',name)))[0];
      const files=report.files.map(f=>f.path);
      assert(files.includes('index.js'));assert(files.includes('index.d.ts'));assert(files.includes('LICENSE'));assert(files.includes('README.md'));
      assert(files.every(f=>!/(node_modules|cache|public\/data|\.glb$|\.gltf$|\.env|handoff|\.tgz$)/.test(f)));
      packed.push({...report,archive:path.join(temp,report.filename)});
    }
    const project=path.join(temp,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'pack-fixture',private:true,type:'module'}));
    const install=archive=>npm(['install','--offline','--ignore-scripts','--no-audit','--no-fund','--legacy-peer-deps',archive],project);
    for(const item of packed)install(item.archive);
    fs.symlinkSync(path.join(root,'node_modules/three'),path.join(project,'node_modules/three'),process.platform==='win32'?'junction':'dir');
    const installed=path.join(project,'node_modules/@city-ink/landmarks/index.js');
    const v1=(await import(`${pathToFileURL(installed)}?version=1`)).default;
    const official=(await import(pathToFileURL(path.join(project,'node_modules/@city-ink/styles/index.js')))).officialStyles;
    const external=(await import(pathToFileURL(path.join(project,'node_modules/@city-ink/styles/cel.js')))).default;
    assert.equal(official.length,4);assert.equal(typeof external.createPipeline,'function');
    const old=checkLandmarkPackage(v1);assert(old.valid);
    const lockPath=path.join(project,'city.lock.json');fs.writeFileSync(lockPath,JSON.stringify(old.lock));
    const source=path.join(temp,'v2');fs.cpSync(path.join(root,'packages/landmarks'),source,{recursive:true});
    const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));pkg.version='1.1.0';fs.writeFileSync(path.join(source,'package.json'),JSON.stringify(pkg));
    fs.writeFileSync(path.join(source,'index.js'),fs.readFileSync(path.join(source,'index.js'),'utf8').replaceAll("'1.0.0'","'1.1.0'").replace('ribWidth: 0.48','ribWidth: 0.84'));
    const update=JSON.parse(npm(['pack','--json','--pack-destination',temp],source))[0];install(path.join(temp,update.filename));
    const v2=(await import(`${pathToFileURL(installed)}?version=2`)).default;
    const next=checkLandmarkPackage(v2);assert(next.valid);assert.equal(next.lock.version,'1.1.0');fs.writeFileSync(lockPath,JSON.stringify(next.lock));
    const data=parseOSM(JSON.parse(fs.readFileSync(path.join(root,'public/data/beijing-cbd.json'))));
    const generate=pack=>{const registry=createLandmarkRegistry({recipes:pack.recipes}),ctx={origin:data.metadata.center,project:data.project};const match=registry.match(data.buildings,ctx).find(m=>m.recipeId==='china-zun');const out=registry.generate(match,ctx);const hash=createHash('sha256');out.group.traverse(o=>{if(o.isMesh)hash.update(Buffer.from(o.geometry.attributes.position.array.buffer));});return hash.digest('hex');};
    const before=generate(v1),after=generate(v2);assert.notEqual(before,after);
    install(packed[0].archive);const rollback=(await import(`${pathToFileURL(installed)}?version=rollback`)).default;
    fs.writeFileSync(lockPath,JSON.stringify(checkLandmarkPackage(rollback).lock));assert.equal(generate(rollback),before);
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath)),old.lock);
    if(process.env.CITY_PACK_EVIDENCE)fs.writeFileSync(process.env.CITY_PACK_EVIDENCE,JSON.stringify({date:'2026-11-03',node:process.version,platform:process.platform,packages:packed.map(({archive,...item})=>item),update:{version:'1.1.0',hash:after},rollback:{version:'1.0.0',hash:before},offlineInstall:true},null,2));
  }finally{
    const resolved=path.resolve(temp),parent=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('city-ink-pack-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
