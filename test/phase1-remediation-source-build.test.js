import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,readFile,writeFile,copyFile} from 'node:fs/promises';
import {projectFixture} from './helpers/project-style.js';
import {readProject,patchProject} from '../src/cli/project.js';
import {buildProject,validateProject,buildConfigHash} from '../src/cli/tasks.js';
import {exportProject} from '../src/cli/export.js';

test('saving acquisition policies preserves a built external-style project while source identity and actual data remain locked',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-source-build-'));
  try{
    await projectFixture(root);await buildProject(root);const before=await readProject(root),original=buildConfigHash(before);
    await patchProject(root,{source:{...before.source,provider:'dresel-europe',endpoint:'https://ovp.dresel.systems/api/interpreter',transport:'get',fallbackEndpoints:['http://127.0.0.1:8123/interpreter'],fallbackPolicy:'unavailable'}});
    assert.equal(buildConfigHash(await readProject(root)),original);await validateProject(root);
    const exported=await exportProject(root,{format:'web',output:'exports/nonroot/city'});assert.equal(exported.status,'succeeded');
    const published=JSON.parse(await readFile(path.join(root,'exports/nonroot/city/viewer-config.json'),'utf8'));assert.equal(published.style.id,'project-sepia');assert.equal(published.style.parameters.warmth,.23);
    await patchProject(root,{source:{kind:'local'}});await assert.rejects(validateProject(root),error=>error.code==='STALE_BUILD');
    await patchProject(root,{source:{kind:before.source.kind}});await validateProject(root);
    await copyFile(path.join(root,'data/source.json'),path.join(root,'data/other.json'));await patchProject(root,{source:{file:'data/other.json'}});await assert.rejects(validateProject(root),error=>error.code==='STALE_BUILD');
    await patchProject(root,{source:{file:before.source.file}});await validateProject(root);
    const raw=JSON.parse(await readFile(path.join(root,'data/source.json'),'utf8'));raw.elements.find(item=>item.tags?.building).tags.height='30';await writeFile(path.join(root,'data/source.json'),JSON.stringify(raw));
    await assert.rejects(validateProject(root),error=>error.code==='STALE_BUILD');
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'city-source-build-')));await rm(root,{recursive:true,force:true});}
});
