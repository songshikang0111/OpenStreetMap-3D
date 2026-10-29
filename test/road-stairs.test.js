import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoadStairs} from '../src/road-stairs.js';

const flight=(extra={})=>({key:'stairs',points:[[0,0],[20,0]],distances:[0,20],length:20,y0:.47,y1:7,width:2,roadIds:[1],source:'osm-steps-inferred-elevation',...extra});
const near=(a,b,tolerance=1e-5)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('OSM steps generate actual horizontal treads, outward risers/soffits, and exact endpoint landings',()=>{
  const f=flight(),snapshot=JSON.stringify(f),built=buildRoadStairs([f]);
  assert.equal(JSON.stringify(f),snapshot,'input route must not be mutated');
  assert.equal(built.stats.stairFlights,1);assert.equal(built.stats.stairTreads,39);
  assert.equal(built.group.children.length,3);
  const tread=built.group.children[0],shell=built.group.children[1],p=tread.geometry.attributes.position,n=tread.geometry.attributes.normal;
  const heights=new Set();let start=0,end=0;
  for(let i=0;i<p.count;i+=3){
    near(p.getY(i),p.getY(i+1));near(p.getY(i),p.getY(i+2));assert(n.getY(i)>.999);
    heights.add(p.getY(i).toFixed(4));
    for(let j=0;j<3;j++){
      if(Math.abs(p.getX(i+j))<1e-6){near(p.getY(i+j),f.y0);start++;}
      if(Math.abs(p.getX(i+j)-20)<1e-6){near(p.getY(i+j),f.y1);end++;}
      assert(Math.abs(p.getZ(i+j))<=1+1e-6);
    }
  }
  assert.equal(heights.size,40);assert(start&&end);
  let risers=0,bottom=0,sides=0;
  const q=shell.geometry.attributes.position,sn=shell.geometry.attributes.normal;
  for(let i=0;i<q.count;i++){
    if(sn.getY(i)<-.9)bottom++;
    if(sn.getX(i)<-.9)risers++;
    if(Math.abs(sn.getZ(i))>.9){assert(q.getZ(i)*sn.getZ(i)>0);sides++;}
  }
  assert(risers&&bottom&&sides);
  for(const mesh of built.group.children){
    assert(mesh.castShadow&&mesh.receiveShadow&&mesh.userData.procedural);
    for(const key of ['position','normal','color','objectId'])assert([...mesh.geometry.attributes[key].array].every(Number.isFinite));
  }
  assert(built.stats.stairTriangles<4000);built.dispose();
});

test('reversing a descending source way gives identical stairs and handrails',()=>{
  const a=buildRoadStairs([flight({points:[[0,0],[8,0],[10,6],[20,6]]})]);
  const b=buildRoadStairs([flight({points:[[20,6],[10,6],[8,0],[0,0]],y0:7,y1:.47})]);
  assert.deepEqual(a.stats,b.stats);
  for(let i=0;i<a.group.children.length;i++)for(const key of ['position','normal','color'])assert.deepEqual(a.group.children[i].geometry.attributes[key].array,b.group.children[i].geometry.attributes[key].array);
  a.dispose();b.dispose();
});

test('two stair wings meet a shared elevated platform without a railing across their mouths',()=>{
  const f1=flight({key:'west',points:[[-20,0],[0,0]]}),f2=flight({key:'east',points:[[20,0],[0,0]],roadIds:[2]});
  const built=buildRoadStairs([f2,f1]);
  assert.equal(built.stats.stairFlights,2);assert.equal(built.stats.stairTreads,78);
  for(const f of built.group.userData.stairFlights){near(f.end[0],0);near(f.y1,7);near(f.y0,.47);}
  const rails=built.group.children[2].geometry.attributes.position;
  // A cross-bar across either opening would introduce vertices near the
  // centre of the opening; all rails remain on the two longitudinal edges.
  for(let i=0;i<rails.count;i++)assert(Math.abs(rails.getZ(i))>.85);
  built.dispose();
});

test('polyline landings remain inside the source extent and share bend sections',()=>{
  const built=buildRoadStairs([flight({points:[[0,0],[10,0],[10,10]]})]);
  const p=built.group.children[0].geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    assert(p.getX(i)>=-1e-6&&p.getX(i)<=11.001);
    assert(p.getZ(i)>=-1.001&&p.getZ(i)<=10.001);
  }
  assert([...p.array].every(Number.isFinite));
  // The +x to +z miter has the same two corner vertices from both sides.
  let inner=0,outer=0;
  for(let i=0;i<p.count;i++){if(Math.abs(p.getX(i)-9)<1e-5&&Math.abs(p.getZ(i)-1)<1e-5)inner++;if(Math.abs(p.getX(i)-11)<1e-5&&Math.abs(p.getZ(i)+1)<1e-5)outer++;}
  assert(inner>=2&&outer>=2);built.dispose();
});

test('degenerate flights skip cleanly and excessive inferred rises are explicitly flagged',()=>{
  const empty=buildRoadStairs([flight({y1:.47}),flight({points:[[1,1],[1,1]]}),flight({y0:NaN})]);
  assert.equal(empty.stats.stairFlights,0);assert.equal(empty.stats.stairSkippedFlights,3);assert.equal(empty.group.children.length,0);empty.dispose();
  const steep=buildRoadStairs([flight({points:[[0,0],[3,0]]})]);
  assert.equal(steep.stats.stairSteepFlights,1,'short available run must not claim a realistic stair proportion');
  assert(steep.stats.stairTriangles<4000);steep.dispose();
});
