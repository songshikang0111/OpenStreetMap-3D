import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compileScene,validateSceneManifest} from '../src/core/index.js';
import {decodeChunk,sceneStats} from '../src/core/scene-codec.js';
import {farCrownGeometry,trunkGeometry} from '../src/core/lod-batching.js';
import {surfaceGeometry,farDeckGeometry,mergeRailSegments,stairGeometries} from '../src/core/lod-surfaces.js';
import {simplifyClosedRing} from '../src/core/lod-simplify.js';
import {lowBuilding} from '../src/core/geometry.js';
import {continuityFixture} from './phase1-core-fixture.js';

function area(g,downOnly=false){const p=g.attributes.position,index=g.index?.array;let result=0;for(let i=0;i<(index?.length??p.count);i+=3){const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index?index[i+k]:i+k)),n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));if(!downOnly||n.y<0)result+=Math.abs(n.y)/2;}return result;}
function manifold(g){const edges=new Map(),p=g.attributes.position;for(let i=0;i<p.count;i+=3){const keys=[0,1,2].map(k=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)].map(v=>v.toFixed(6)).join(','));for(let j=0;j<3;j++){const key=[keys[j],keys[(j+1)%3]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}assert.ok([...edges.values()].every(n=>n===2));}

test('repair far tree prototypes are closed real six/four-face assets within their source envelopes',()=>{
  for(const [g,count]of [[farCrownGeometry(),6],[trunkGeometry(),4]]){assert.equal(g.attributes.position.count/3,count);manifold(g);for(const v of g.attributes.position.array)assert.ok(Number.isFinite(v));g.computeBoundingBox();assert.ok(g.boundingBox.min.y<=-.5);assert.ok(g.boundingBox.max.y>=.5);for(let i=0;i<g.attributes.position.count;i++)assert.ok(Math.hypot(g.attributes.position.getX(i),g.attributes.position.getZ(i))<=1.000001);}
});

test('repair closed-ring simplification bounds every omitted source point without mutating it',()=>{
  const ring=[[0,0],[1,.05],[2,0],[3,.04],[4,0],[4,4],[0,4]],copy=structuredClone(ring),simple=simplifyClosedRing(ring,.1);assert.ok(simple.length<ring.length);assert.deepEqual(ring,copy);
  for(const p of ring){let distance=Infinity;for(let i=0;i<simple.length;i++){const a=new THREE.Vector3(simple[i][0],0,simple[i][1]),b=simple[(i+1)%simple.length],v=new THREE.Vector3(p[0],0,p[1]);distance=Math.min(distance,new THREE.Line3(a,new THREE.Vector3(b[0],0,b[1])).closestPointToPoint(v,true,new THREE.Vector3()).distanceTo(v));}assert.ok(distance<=.100001);}
});

test('repair road retriangulation retains union coverage, islands, inner holes and the source height plane',()=>{
  const rectangle=(x,z,w,d)=>({polygon:[[x,z],[x+w,z],[x+w,z+d],[x,z+d]],y:.32});
  const g=surfaceGeometry([rectangle(0,0,10,2),rectangle(0,8,10,2),rectangle(0,2,2,6),rectangle(8,2,2,6)],'#777e7c');assert.ok(Math.abs(area(g)-64)<.00001);
  for(let i=0;i<g.attributes.position.count;i++){assert.ok(Math.abs(g.attributes.position.getY(i)-.32)<1e-6);const x=g.attributes.position.getX(i),z=g.attributes.position.getZ(i);assert.ok(!(x>2&&x<8&&z>2&&z<8));}
});

test('repair bridge slabs keep their complete footprint, bottom and exact outer grade after grade-sample merging',()=>{
  const decks=Array.from({length:30},(_,i)=>({roadId:1,level:'7',thickness:.65,polygon:[[i*4,0],[(i+1)*4,0],[(i+1)*4,8],[i*4,8]],a:[i*4,4],b:[(i+1)*4,4],yA:7+i*.04,yB:7+(i+1)*.04}));
  const g=farDeckGeometry(decks);assert.ok(g.attributes.position.count/3<decks.length*10);assert.ok(Math.abs(area(g,true)-120*8)<.001);
  for(let i=0;i<g.attributes.position.count;i++){const x=g.attributes.position.getX(i),y=g.attributes.position.getY(i);assert.ok(Math.min(Math.abs(y-(7+x*.01)),Math.abs(y-(6.35+x*.01)))<.001);}
});

test('repair rails merge source-contiguous runs but never jump gaps, widths or source identities',()=>{
  const source=Array.from({length:50},(_,i)=>({roadId:1,width:.28,walk:false,a:[i*4,0],b:[(i+1)*4,0],yA:7,yB:7}));
  const merged=mergeRailSegments([...source,{...source[0],roadId:2},{...source[0],width:.5},{...source[0],a:[300,0],b:[304,0]}]);assert.equal(merged.length,4);assert.ok(merged.some(r=>r.roadId===1&&r.width===.28&&r.a[0]===0&&r.b[0]===200));
});

test('repair stair envelopes preserve both landings, width and connected endpoint heights',()=>{
  const [top,shell,rails]=stairGeometries([{key:'steps',points:[[0,0],[20,0]],width:3,y0:.32,y1:7,roadIds:[1]}]);top.computeBoundingBox();assert.equal(top.boundingBox.min.x,0);assert.equal(top.boundingBox.max.x,20);assert.ok(Math.abs(top.boundingBox.min.y-.32)<1e-6);assert.equal(top.boundingBox.max.y,7);assert.equal(top.boundingBox.max.z-top.boundingBox.min.z,3);assert.ok(shell.attributes.position.count>0);assert.equal(rails.userData.lodDoubleSided,true);
});

test('repair grounded silhouettes omit only buried bases; elevated parts retain underside structure',()=>{
  const building={id:'a',outer:[[0,0],[10,0],[10,10],[0,10]],holes:[],height:20,minHeight:0,tags:{building:'yes'}};
  const grounded=lowBuilding(building,new THREE.MeshStandardMaterial(),false),floating=lowBuilding({...building,minHeight:5},grounded.material,false);
  assert.ok(!Array.from(grounded.geometry.attributes.normal.array).filter((_,i)=>i%3===1).some(y=>y<-.5));assert.ok(Array.from(floating.geometry.attributes.normal.array).filter((_,i)=>i%3===1).some(y=>y<-.5));
});

test('repair caster statistics match actual flags; low has full body identities with no caster work',async()=>{
  const {raw,config}=continuityFixture(),r=await compileScene(raw,{...config,tiling:{divisions:4}});assert.equal(validateSceneManifest(r.manifest).valid,true);
  const trees=new Set(),buildings=new Set();
  for(const chunk of r.manifest.chunks){assert.ok(chunk.lods.some(l=>l.id==='low'));const d=chunk.lods.find(l=>l.id==='low'),g=await decodeChunk(r.assets[d.uri],d);assert.equal(d.shadowTriangles,0);assert.equal(d.shadowDrawCalls,0);assert.equal(sceneStats(g).triangles,d.triangles);assert.equal(sceneStats(g).drawCalls,d.drawCalls);
    g.traverse(o=>{if(!o.isMesh)return;assert.equal(o.castShadow,false);if(o.userData.city.kind==='tree')for(const id of o.userData.city.instanceFeatureIds)trees.add(id);if(o.userData.city.kind==='building')for(const id of o.userData.city.featureIds)buildings.add(id);});
  }
  for(const f of Object.values(r.manifest.featureIndex)){if(f.kind==='tree')assert.ok(trees.has(f.featureId));if(f.kind==='building')assert.ok(buildings.has(f.featureId));}
  const invalid=structuredClone(r.manifest);invalid.chunks[0].lods[0].shadowTriangles=1;assert.equal(validateSceneManifest(invalid).valid,false);
});
