import test from 'node:test';
import assert from 'node:assert/strict';
import { crownGeometry, crownProfile, crownEnvelope } from '../src/foliage.js';
import { buildStreetLife } from '../src/streetlife.js';

test('needle crowns are closed pointed meshes with reproducible normals and a bounded budget',()=>{
  for(const shape of ['cypress','conifer']){
    const g=crownGeometry(false,shape),p=g.attributes.position,n=g.attributes.normal,edges=new Map();
    assert(p.count/3<=800);assert.deepEqual(p.array,crownGeometry(false,shape).attributes.position.array);
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
    let tipRadius=0,baseRadius=0;
    for(let i=0;i<p.count;i++){
      assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);
      if(p.getY(i)>.8)tipRadius=Math.max(tipRadius,Math.hypot(p.getX(i),p.getZ(i)));
      if(p.getY(i)<0)baseRadius=Math.max(baseRadius,Math.hypot(p.getX(i),p.getZ(i)));
    }
    assert(tipRadius<baseRadius*.45,'top must taper to a leader, not a stretched round canopy');
    for(let i=0;i<p.count;i+=3)for(const [a,b]of [[0,1],[1,2],[2,0]]){const k=[key(i+a),key(i+b)].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
    assert([...edges.values()].every(count=>count===2));g.dispose();
  }
});

test('conifer envelopes enclose actual far and near vertices across morph weights and seeds',()=>{
  const leaves=crownGeometry(true);
  for(const shape of ['cypress','conifer']){
    const far=crownGeometry(false,shape);
    for(let seed=0;seed<12;seed++){
      const tree={key:`needle-${seed}`,seed,shape,x:80,z:-90,h:9,rotation:seed*.4,variation:.3};
      const profile=crownProfile(tree),envelope=crownEnvelope(tree);
      assert.equal(profile.clusters.length,18);assert.equal(profile.branches.length,6);
      for(const weight of [0,.2,.7,1])for(const [index,part]of [profile.base,...profile.clusters].entries()){
        const p=(index?leaves:far).attributes.position,c=Math.cos(part.angle),s=Math.sin(part.angle),scale=index?weight:1;
        const pos=index?part.position.map((v,axis)=>part.anchor[axis]+(v-part.anchor[axis])*weight):part.position;
        for(let i=0;i<p.count;i++){
          const x=p.getX(i)*part.scale[0]*scale,z=p.getZ(i)*part.scale[2]*scale,y=pos[1]+p.getY(i)*part.scale[1]*scale;
          assert(Math.hypot(pos[0]+x*c+z*s-tree.x,pos[2]-x*s+z*c-tree.z)<=envelope.radius+1e-6);
          assert(y>=envelope.bottom-1e-6&&y<=envelope.top+1e-6);
        }
      }
    }
    far.dispose();
  }
  leaves.dispose();
});

test('mixed crown batches preserve pointed silhouettes at every distance and reuse the shared near budget',()=>{
  const data={bounds:[-200,-200,200,200],roads:[],buildings:[],greens:[],trees:[],treeRows:[],streetNodes:[]};
  const landscapeTrees=['cypress','conifer','round'].map((shape,i)=>({point:[i*15,0],shape,key:shape,height:10}));
  const life=buildStreetLife(data,{landscapeTrees}),needle=life.treeGroup.getObjectByName('Distant cypress crowns');
  assert.equal(needle.count,1);const far=needle.instanceMatrix.array.slice();
  life.updateLOD({position:{x:15,y:8,z:20}});assert.deepEqual(needle.instanceMatrix.array,far);
  assert.equal(life.treeGroup.getObjectByName('Nearby crown clusters').count,54);
  life.updateLOD({position:{x:15,y:8,z:400}});assert.deepEqual(needle.instanceMatrix.array,far);
  assert.equal(life.treeGroup.getObjectByName('Nearby crown clusters').count,0);
  assert(life.stats.maxCrownTriangles<=180+2*800+3*18*320);
  life.dispose();
});
