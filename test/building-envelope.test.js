import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planBuildingEnvelopes} from '../src/building-envelope.js';
import {parseOSM,area} from '../src/osm.js';
const box=(id,x0,z0,x1,z1,height,minHeight=0)=>({id,outer:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]],holes:[],height,minHeight});
const surfaceArea=polys=>polys.reduce((s,[o,...h])=>s+area(o)-h.reduce((n,r)=>n+area(r),0),0);

test('podium and taller tower have a single owner for a shared facade and no buried roof',()=>{
  const podium=box('podium',0,0,20,20,10),tower=box('tower',10,10,20,20,60);
  const p=planBuildingEnvelopes([podium,tower]);
  assert.deepEqual(p.get('podium').wall([20,0],[20,20],[1,0,0]),[{t0:0,t1:.5,lo:0,hi:10}]);
  assert.deepEqual(p.get('tower').wall([20,10],[20,20],[1,0,0]),[{t0:0,t1:1,lo:0,hi:60}]);
  assert.deepEqual(p.get('tower').wall([10,10],[10,20],[-1,0,0]),[{t0:0,t1:1,lo:10,hi:60}]);
  assert.equal(surfaceArea(p.get('podium').roof),300);
});
test('party walls, equal-height duplicates and elevated parts preserve the union boundary',()=>{
  const a=box('a',0,0,10,10,10),b=box('b',10,0,20,10,20),raised=box('sky',0,0,10,10,40,30);
  let p=planBuildingEnvelopes([a,b,raised]);
  assert.deepEqual(p.get('a').wall([10,0],[10,10],[1,0,0]),[]);
  assert.deepEqual(p.get('b').wall([10,0],[10,10],[-1,0,0]),[{t0:0,t1:1,lo:10,hi:20}]);
  assert.equal(surfaceArea(p.get('a').roof),100,'air gap leaves the lower roof visible');
  const duplicate={...a,id:'duplicate'};p=planBuildingEnvelopes([a,duplicate]);
  assert.equal(surfaceArea(p.get('a').roof)+surfaceArea(p.get('duplicate').roof),100);
});
test('courtyard voids and narrow real gaps are not treated as occupied volumes',()=>{
  const a=box('courtyard',0,0,30,30,20);a.holes=[box('hole',5,5,25,25,1).outer];
  const b=box('inside-hole',8,8,18,18,30),c=box('separate',30.01,0,40,30,10);
  const p=planBuildingEnvelopes([a,b,c]);
  assert.deepEqual(p.get(b.id).wall([8,8],[18,8],[0,0,-1]),[{t0:0,t1:1,lo:0,hi:30}]);
  assert.deepEqual(p.get(a.id).wall([30,0],[30,30],[1,0,0]),[{t0:0,t1:1,lo:0,hi:20}]);
});
test('actual Guomao B snapshot resolves both exactly coincident podium facades',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url)));
  const data=parseOSM(raw),podium=data.buildings.find(b=>b.id==='w660651176'),tower=data.buildings.find(b=>b.id==='w916885302');
  const p=planBuildingEnvelopes([podium,tower]);
  for(const i of [5,6]){
    const a=podium.outer[i],b=podium.outer[(i+1)%podium.outer.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),n=[-dz/l,0,dx/l];
    assert.deepEqual(p.get(podium.id).wall(a,b,n),[]);
    assert.deepEqual(p.get(tower.id).wall(a,b,n),[{t0:0,t1:1,lo:0,hi:296}]);
  }
  assert(Math.abs(surfaceArea(p.get(podium.id).roof)-(podium.area-tower.area))<.001);
});
