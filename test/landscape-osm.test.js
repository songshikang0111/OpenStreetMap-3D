import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOSM,mergeOSMOverlay } from '../src/osm.js';

test('landscape overlay merges idempotently and keeps baseline buildings/roads intact',()=>{
  const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'));
  const raw=read('beijing-cbd'),baseline=parseOSM(raw),overlay=read('landscape-details');
  mergeOSMOverlay(raw,overlay,'landscape-details');const length=raw.elements.length;
  mergeOSMOverlay(raw,overlay,'landscape-details');assert.equal(raw.elements.length,length);
  const data=parseOSM(raw);
  assert.deepEqual(data.buildings,baseline.buildings);assert.deepEqual(data.roads,baseline.roads);
  assert.equal(data.landscapes.filter(p=>p.kind==='plaza').length,4);
  assert.equal(data.landscapes.filter(p=>p.kind==='parking').length,8);
  assert.equal(data.landscapes.filter(p=>p.kind==='construction').length,4);
  assert.ok(data.landscapeContexts.some(p=>p.context==='commercial'));
  assert.equal(data.water.length,baseline.water.length+1);
});

test('overlapping ground polygons are retained even when their centre falls outside the extract',()=>{
  const geometry=[[.008,-.005],[.03,-.005],[.03,.005],[.008,.005],[.008,-.005]].map(([lon,lat])=>({lat,lon}));
  const raw={metadata:{bbox:[-.01,-.01,.01,.01]},elements:[{type:'way',id:1,tags:{landuse:'grass'},geometry}]};
  assert.equal(parseOSM(raw).landscapes.length,1);
});
