import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createProject,patchProject} from '../src/cli/project.js';
import {buildProject,validateProject} from '../src/cli/tasks.js';

test('real project keeps geometry valid after camera/material/quality save and rejects changed generation seed',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'city-runtime-config-'));
  try{
    await createProject(directory,{sample:true});await buildProject(directory);
    const initial=JSON.parse(await readFile(path.join(directory,'city.lock.json'),'utf8'));
    await patchProject(directory,{camera:{position:[200,100,200],target:[0,10,0],fov:50},style:{id:'line',parameters:{}},quality:'low'});
    await validateProject(directory);await buildProject(directory);
    const next=JSON.parse(await readFile(path.join(directory,'city.lock.json'),'utf8'));
    assert.deepEqual(next.assetHashes,initial.assetHashes);assert.equal(next.inputs.buildConfigHash,initial.inputs.buildConfigHash);assert.notEqual(next.inputs.configHash,initial.inputs.configHash);
    await patchProject(directory,{seed:2});await assert.rejects(validateProject(directory),error=>error.code==='STALE_BUILD');
  }finally{await rm(directory,{recursive:true,force:true});}
});
