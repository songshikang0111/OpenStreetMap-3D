import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {projectFixture} from './helpers/project-style.js';
import {prepareProjectStyle,projectStyleCachePath} from '../src/local-server/project-styles.js';

test('studio preview uses the real declared style bundle and immutable local assets',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-studio-style-'));
  try{
    const style=await projectFixture(root),preview=await prepareProjectStyle(root,'p1',style);
    assert.equal(preview.style.id,'project-sepia');assert.equal(preview.style.parameters.warmth,.23);
    assert.match(preview.sdkUrl,/^\/projects\/p1\/style-preview\/[a-f0-9]{64}\/assets\/city-ink\.js$/);
    assert.ok(preview.styleModule.stylesheets.length>0);
    const sdk=await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'assets/city-ink.js')));
    const manifest=JSON.parse(await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'preview.json')),'utf8'));
    assert.equal(manifest.sdkUrl,preview.sdkUrl);assert.ok(sdk.length>0);
    const changed=await prepareProjectStyle(root,'p1',{...style,parameters:{warmth:.42}});
    assert.equal(changed.style.parameters.warmth,.42);
    await assert.rejects(prepareProjectStyle(root,'p1',{...style,entry:'../escape.js'}));
    assert.deepEqual(await readFile(path.join(root,projectStyleCachePath(preview.report.hash,'assets/city-ink.js'))),sdk);
    assert.throws(()=>projectStyleCachePath('../escape','x.js'));
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'city-studio-style-')));await rm(root,{recursive:true,force:true});}
});
