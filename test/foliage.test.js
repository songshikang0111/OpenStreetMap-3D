import test from 'node:test';
import assert from 'node:assert/strict';
import { crownGeometry } from '../src/foliage.js';
import { buildStreetLife } from '../src/streetlife.js';

test('canopy surfaces have reproducible closed seams, unit normals and a bounded mesh budget',()=>{
  for(const detailed of [false,true]){
    const a=crownGeometry(detailed),b=crownGeometry(detailed),p=a.attributes.position,n=a.attributes.normal;
    assert.deepEqual(p.array,b.attributes.position.array);assert(p.count<=1500);
    for(let i=0;i<p.count;i++){
      const r=Math.hypot(p.getX(i),p.getY(i),p.getZ(i));assert(r>.7&&r<1.3);
      assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);
    }
    // The triangle soup duplicates shared positions, but they must coincide.
    const edges=new Map(),key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
    for(let i=0;i<p.count;i+=3)for(const [s,t]of [[0,1],[1,2],[2,0]]){const k=[key(i+s),key(i+t)].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
    assert([...edges.values()].every(c=>c===2));a.dispose();b.dispose();
  }
});

test('tree LOD changes appearance only, and rebuilding a near view repeats the leaf transforms',()=>{
  const data={bounds:[-500,-500,500,500],roads:[],buildings:[],greens:[],trees:[{id:1,point:[0,0],height:8}],treeRows:[],streetNodes:[]};
  const life=buildStreetLife(data),camera={position:{x:0,y:3,z:10}},near=life.treeGroup.getObjectByName('Nearby crown clusters');
  life.updateLOD(camera);const first=near.instanceMatrix.array.slice();assert.equal(near.count,19);
  life.updateLOD({position:{x:400,y:500,z:400}});assert.equal(near.count,0);
  life.updateLOD(camera);assert.equal(life.treeCount,1);assert.deepEqual(near.instanceMatrix.array,first);
  assert.equal(life.plan.trees[0].source,'osm');life.dispose();
});
