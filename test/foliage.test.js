import test from 'node:test';
import assert from 'node:assert/strict';
import { crownGeometry, crownBase, crownProfile, crownEnvelope, crownMorphWeight, treeLODWeights, TREE_LOD } from '../src/foliage.js';
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
    const edges=new Map(),normals=new Map(),key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
    for(let i=0;i<p.count;i++){const normal=[n.getX(i),n.getY(i),n.getZ(i)],existing=normals.get(key(i));if(existing)assert.deepEqual(normal,existing);else normals.set(key(i),normal);}
    for(let i=0;i<p.count;i+=3)for(const [s,t]of [[0,1],[1,2],[2,0]]){const k=[key(i+s),key(i+t)].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
    assert([...edges.values()].every(c=>c===2));a.dispose();b.dispose();
  }
});

test('tree LOD keeps a common opaque crown in every pass and deterministic geometry on return',()=>{
  const data={bounds:[-500,-500,500,500],roads:[],buildings:[],greens:[],trees:[{id:1,point:[0,0],height:8}],treeRows:[],streetNodes:[]};
  const life=buildStreetLife(data),camera={position:{x:0,y:3,z:10}},near=life.treeGroup.getObjectByName('Nearby crown clusters');
  const base=life.treeGroup.getObjectByName('Distant tree crowns');
  life.updateLOD(camera);const first=near.instanceMatrix.array.slice();assert.equal(near.count,TREE_LOD.clusters);assert.equal(base.count,1);
  for(const mesh of [base,near]){assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.alphaTest,0);assert.equal(mesh.castShadow,true);assert.equal(mesh.userData.inkClass,2);assert.equal(mesh.customDepthMaterial,undefined);}
  life.updateLOD({position:{x:400,y:500,z:400}});assert.equal(near.count,0);assert.equal(base.count,1);
  life.updateLOD(camera);assert.equal(life.treeCount,1);assert.deepEqual(near.instanceMatrix.array,first);
  assert.equal(life.plan.trees[0].source,'osm');life.dispose();
});

const illustrativeTree=(key,x=0,z=0)=>({key,x,z,h:8,shape:'spreading',rotation:.37,variation:.42});

test('branch-associated canopy profiles are seeded, bounded and lower in triangles than the previous budget',()=>{
  const tree=illustrativeTree('a'),a=crownProfile(tree),b=crownProfile(tree),other=crownProfile(illustrativeTree('b'));
  assert.deepEqual(a,b);assert.notDeepEqual(a.clusters,other.clusters);
  assert.equal(a.clusters.length,18);assert.equal(a.branches.length,6);
  assert.equal(a.clusters.length+1,19,'persistent base belongs to the 19-mass near crown');
  assert(new Set(a.clusters.map(c=>c.scale.join(','))).size>12,'lobes have different proportions');
  const envelope=crownEnvelope(tree);
  for(const c of a.clusters){assert(c.position.every(Number.isFinite));assert(c.scale.every(v=>v>0));assert(c.position[1]-c.scale[1]*1.17>=envelope.bottom);assert(c.position[1]+c.scale[1]*1.17<=envelope.top);assert(Math.hypot(c.position[0],c.position[2])+Math.max(c.scale[0],c.scale[2])*1.17<=envelope.radius);}
  a.branches.forEach((branch,i)=>assert.deepEqual(branch.b,a.clusters[i*3+1].position));
  const far=crownGeometry(),near=crownGeometry(true),perTree=far.attributes.position.count/3+near.attributes.position.count/3*TREE_LOD.clusters;
  assert.equal(far.attributes.position.count/3,180);assert.equal(near.attributes.position.count/3,320);assert(perTree<19*500);
  far.dispose();near.dispose();
});

test('broad crowns have a varied horizontal silhouette without repeated vertical tiers',()=>{
  const widths=[],depths=[],heights=[],centers=[];
  for(let i=0;i<40;i++){
    const tree={...illustrativeTree(`form-${i}`),seed:7},profile=crownProfile(tree),base=profile.base;
    assert(base.scale[0]>base.scale[1]*1.08,'mature spreading trees retain their broad canopy');
    assert(base.scale[1]/base.scale[0]>.57,'far trees must keep leafy volume instead of flattening to umbrellas');
    const groups=Array.from({length:3},(_,leaf)=>profile.clusters.filter((_,j)=>j%3===leaf).map(c=>c.position[1]));
    const means=groups.map(group=>group.reduce((s,y)=>s+y,0)/group.length);
    assert(Math.max(...means)-Math.min(...means)<tree.h*.12,'three branch leaves must not become three separate floors');
    widths.push(base.scale[0]);depths.push(base.scale[2]/base.scale[0]);heights.push(base.scale[1]);centers.push(base.position[0]);
  }
  assert(Math.max(...widths)-Math.min(...widths)>.25);
  assert(Math.max(...depths)-Math.min(...depths)>.13);
  assert(Math.max(...heights)-Math.min(...heights)>.6,'far envelopes must preserve tree-level vertical variety');
  assert(Math.max(...centers)-Math.min(...centers)>.35,'asymmetric crown centres must vary independently');
  const tree=illustrativeTree('seed');
  assert.notDeepEqual(crownProfile({...tree,seed:1}),crownProfile({...tree,seed:2}));
  assert(crownBase({...tree,shape:'columnar'}).scale[0]<crownBase({...tree,shape:'spreading'}).scale[0]*.65);
});

test('placement envelope encloses actual shared geometry for all crown habits and seed variations',()=>{
  const geometries=[crownGeometry(),crownGeometry(true)];
  for(const shape of ['spreading','round','vase','columnar'])for(let i=0;i<12;i++){
    const tree={...illustrativeTree(`envelope-${i}`,731,-429),shape,seed:i%3,rotation:i*.41};
    const profile=crownProfile(tree),envelope=crownEnvelope(tree);
    for(const [index,part] of [profile.base,...profile.clusters].entries()){
      const p=geometries[index===0?0:1].attributes.position,cos=Math.cos(part.angle),sin=Math.sin(part.angle);
      for(let vertex=0;vertex<p.count;vertex++){
        const x=p.getX(vertex)*part.scale[0],z=p.getZ(vertex)*part.scale[2];
        const wx=part.position[0]+x*cos+z*sin,wz=part.position[2]-x*sin+z*cos,y=part.position[1]+p.getY(vertex)*part.scale[1];
        assert(Math.hypot(wx-tree.x,wz-tree.z)<=envelope.radius+1e-6);
        assert(y>=envelope.bottom-1e-6 && y<=envelope.top+1e-6);
      }
    }
  }
  geometries.forEach(g=>g.dispose());
});

test('distance transitions are continuous at near, former hard cutoff and far boundaries',()=>{
  const trees=[illustrativeTree('a')],y=crownBase(trees[0]).position[1];
  const at=x=>treeLODWeights(trees,{x,y,z:0});
  assert.equal(at(10).weights[0],1);assert.equal(at(111).weights[0],0);
  for(const boundary of [TREE_LOD.nearDistance,95,TREE_LOD.distance]){
    const a=at(boundary-.001),b=at(boundary+.001);
    assert(Math.abs(a.weights[0]-b.weights[0])<.0001,`continuous at ${boundary} m`);
  }
  assert(at(94.9).weights[0]>at(95.1).weights[0]);
});

test('nearest-tree budget changes at zero weight, without source-order or location dependence',()=>{
  const trees=Array.from({length:95},(_,i)=>illustrativeTree(`inner-${i}`,Math.cos(i)*20,Math.sin(i)*20));
  trees.push(illustrativeTree('left',-80,0),illustrativeTree('right',80,0));
  const y=crownBase(trees[0]).position[1];
  const a=treeLODWeights(trees,{x:-.01,y,z:0}),b=treeLODWeights(trees,{x:.01,y,z:0});
  for(const result of [a,b])assert(result.active.length<=96);
  assert(a.weights[95]<.0001&&b.weights[96]<.0001,'the entering/leaving 96th crown must be almost invisible');
  assert.equal(a.weights[96],0);assert.equal(b.weights[95],0);
  trees.forEach((_,i)=>assert(Math.abs(a.weights[i]-b.weights[i])<.0001));
  const reversed=treeLODWeights([...trees].reverse(),{x:-.01,y,z:0});
  trees.forEach((_,i)=>assert.equal(a.weights[i],reversed.weights[trees.length-1-i]));
  const translated=treeLODWeights(trees.map(t=>({...t,x:t.x+8732,z:t.z-3159})),{x:8731.99,y,z:-3159});
  trees.forEach((_,i)=>assert(Math.abs(a.weights[i]-translated.weights[i])<1e-6));
});

test('small camera movement updates geometry continuously, including former 15 m grid boundaries',()=>{
  const data={bounds:[-500,-500,500,500],roads:[],buildings:[],greens:[],trees:[{id:1,point:[0,0],height:8}],treeRows:[],streetNodes:[]};
  const life=buildStreetLife(data),near=life.treeGroup.getObjectByName('Nearby crown clusters'),base=life.treeGroup.getObjectByName('Distant tree crowns');
  const pose=x=>({position:{x,y:6.43,z:65}});
  life.updateLOD(pose(7.49));const before=near.instanceMatrix.array.slice(),baseBefore=base.instanceMatrix.array.slice();
  life.updateLOD(pose(7.51));const after=near.instanceMatrix.array;
  const delta=Math.max(...after.map((v,i)=>Math.abs(v-before[i])));assert(delta>0&&delta<.002);
  assert(Math.max(...base.instanceMatrix.array.map((v,i)=>Math.abs(v-baseBefore[i])))<.002);
  const version=near.instanceMatrix.version;life.updateLOD(pose(7.51));assert.equal(near.instanceMatrix.version,version,'stationary cameras need no repeated upload');
  for(const z of [109.99,110,110.01]){life.updateLOD({position:{x:0,y:6.43,z}});assert.equal(base.count,1);if(z<110)assert(life.lodState.weights[0]<1e-6);else assert.equal(near.count,0);}
  life.dispose();
});

test('dense groves obey the cap with non-singular opaque instances and retain every base crown',()=>{
  const trees=Array.from({length:196},(_,i)=>({id:i+1,point:[(i%14-6.5)*4,(Math.floor(i/14)-6.5)*4],height:8}));
  const data={bounds:[-100,-100,100,100],roads:[],buildings:[],greens:[],trees,treeRows:[],streetNodes:[]},life=buildStreetLife(data);
  assert.equal(life.treeCount,196);
  const base=life.treeGroup.getObjectByName('Distant tree crowns'),near=life.treeGroup.getObjectByName('Nearby crown clusters'),branches=life.treeGroup.getObjectByName('Nearby branching');
  for(const x of [-.01,0,.01,3.99,4.01]){
    life.updateLOD({position:{x,y:3,z:0}});
    assert(life.stats.nearTrees>0&&life.stats.nearTrees<=96);assert(life.lodState.radius<110);assert.equal(base.count,196);
    assert.equal(near.count,life.stats.nearTrees*18);assert.equal(branches.count,life.stats.nearTrees*6);
    for(const mesh of [base,near,branches])for(let i=0;i<mesh.count;i++){
      const a=mesh.instanceMatrix.array,o=i*16;
      const determinant=a[o]*(a[o+5]*a[o+10]-a[o+9]*a[o+6])-a[o+4]*(a[o+1]*a[o+10]-a[o+9]*a[o+2])+a[o+8]*(a[o+1]*a[o+6]-a[o+5]*a[o+2]);
      assert(determinant>0,'normal/depth/shadow passes require non-singular active transforms');
    }
    assert(life.stats.crownTriangles<=196*180+96*18*320);
  }
  life.dispose();
});

test('middle-distance silhouettes expose several leaf lobes outside the shared base crown',()=>{
  const directions=[];
  for(const y of [-.4,0,.4])for(let i=0;i<24;i++)directions.push([Math.cos(i*Math.PI/12),y,Math.sin(i*Math.PI/12)]);
  // Measure the actual uploaded geometry rather than inferring visibility from
  // a nonzero LOD weight: a nonzero lobe can still be entirely buried in base.
  const supports=(mesh,instance)=>{
    const p=mesh.geometry.attributes.position,m=mesh.instanceMatrix.array,o=instance*16,result=directions.map(()=>-Infinity);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),world=[m[o]*x+m[o+4]*y+m[o+8]*z+m[o+12],m[o+1]*x+m[o+5]*y+m[o+9]*z+m[o+13],m[o+2]*x+m[o+6]*y+m[o+10]*z+m[o+14]];
      directions.forEach((d,j)=>{result[j]=Math.max(result[j],world[0]*d[0]+world[1]*d[1]+world[2]*d[2]);});
    }
    return result;
  };
  let minimumExposed=18;
  for(const id of [1,2,3,4]){
    const life=buildStreetLife({bounds:[-200,-200,200,200],roads:[],buildings:[],greens:[],trees:[{id,point:[0,0],height:8}],treeRows:[],streetNodes:[]});
    const base=life.treeGroup.getObjectByName('Distant tree crowns'),lobes=life.treeGroup.getObjectByName('Nearby crown clusters');
    for(const distance of [65,80,90]){
      life.updateLOD({position:{x:0,y:6.43,z:distance}});
      const envelope=supports(base,0);let exposed=0;
      for(let i=0;i<lobes.count;i++)if(supports(lobes,i).some((extent,j)=>extent>envelope[j]+.025))exposed++;
      minimumExposed=Math.min(minimumExposed,exposed);
      assert(exposed>=4,`tree ${id} at ${distance} m has only ${exposed} lobes beyond the base silhouette`);
    }
    life.dispose();
  }
  assert.equal(crownMorphWeight(0),0);assert.equal(crownMorphWeight(1),1);
  assert(crownMorphWeight(.25)>.65);
  console.log('Canopy silhouette regression: minimum exposed lobes',minimumExposed);
});
