import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeView,encodeView} from '../src/view-state.js';
import {parseOSM} from '../src/osm.js';

test('saved view round-trips camera, seed, style and visibility',()=>{
  const state={version:2,mode:1,seed:27,view:'citic',position:[390,270,660],target:[0,265,0],parameters:{lens:42,'ao-strength':80,'facade-detail':35},toggles:{'trees-toggle':false}};
  assert.deepEqual(decodeView(encodeView(state)),state);
});
test('view decoder rejects malformed payloads and strips unsupported or unsafe inputs',()=>{
  assert.equal(decodeView('#v=not-json'),null);
  assert.equal(decodeView(encodeView({version:1})),null);
  const result=decodeView(encodeView({version:2,mode:99,seed:-2,position:[1e6,0,0],target:[0,0],view:'unknown',parameters:{lens:999,haze:-50,code:'alert(1)'},toggles:{'trees-toggle':'false'}}));
  assert.deepEqual(result,{version:2,mode:3,seed:1,parameters:{lens:100,haze:0},toggles:{}});
});
test('reroll changes estimates while retaining every tagged height, floor and footprint',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url),'utf8'));
  const a=parseOSM(raw,1).buildings,b=parseOSM(raw,2).buildings;
  assert.equal(a.length,b.length);
  let changed=0;
  for(let i=0;i<a.length;i++){
    assert.equal(a[i].osmId,b[i].osmId);assert.deepEqual(a[i].outer,b[i].outer);
    if(a[i].source==='estimated')changed+=a[i].height!==b[i].height;
    else assert.equal(a[i].height,b[i].height);
  }
  assert.ok(changed>0);
});
