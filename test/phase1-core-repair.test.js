import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compileScene,validateSceneManifest} from '../src/core/index.js';
import {decodeChunk,encodeChunk,sceneStats} from '../src/core/scene-codec.js';
import {farCrownGeometry,trunkGeometry} from '../src/core/lod-batching.js';
import {surfaceGeometry,farDeckGeometry,mergeRailSegments,stairGeometries,planarPatches,railGeometry} from '../src/core/lod-surfaces.js';
import {simplifyClosedRing} from '../src/core/lod-simplify.js';
import {lowBuilding} from '../src/core/geometry.js';
import {continuityFixture} from './phase1-core-fixture.js';

function area(g,downOnly=false){const p=g.attributes.position,index=g.index?.array;let result=0;for(let i=0;i<(index?.length??p.count);i+=3){const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index?index[i+k]:i+k)),n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));if(!downOnly||n.y<0)result+=Math.abs(n.y)/2;}return result;}
function manifold(g){const edges=new Map(),p=g.attributes.position;for(let i=0;i<p.count;i+=3){const keys=[0,1,2].map(k=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)].map(v=>v.toFixed(6)).join(','));for(let j=0;j<3;j++){const key=[keys[j],keys[(j+1)%3]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}assert.ok([...edges.values()].every(n=>n===2));}

test('repair far tree prototypes are closed real four-face assets within their source envelopes',()=>{
  for(const [g,count]of [[farCrownGeometry(),4],[trunkGeometry(),4]]){assert.equal(g.attributes.position.count/3,count);manifold(g);for(const v of g.attributes.position.array)assert.ok(Number.isFinite(v));g.computeBoundingBox();assert.ok(g.boundingBox.min.y<=-.5);assert.ok(g.boundingBox.max.y>=.5);for(let i=0;i<g.attributes.position.count;i++)assert.ok(Math.hypot(g.attributes.position.getX(i),g.attributes.position.getZ(i))<=1.000001);}
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

test('repair plane families enforce the 2mm bound, including rejected models and both slab planes',()=>{
  const items=[0,.0019,.0042].map((offset,i)=>({polygon:[[i*10,0],[(i+1)*10,0],[(i+1)*10,4],[i*10,4]],y:7+offset,thickness:.65}));
  for(const secondary of [undefined,d=>d.y]){
    const patches=planarPatches(items,d=>d.y-.65,()=>'',secondary);assert.equal(patches.length,2);
    for(const patch of patches)for(const ring of patch.rings)for(const [x,z]of ring){
      const choices=items.filter(d=>x>=d.polygon[0][0]-1e-6&&x<=d.polygon[1][0]+1e-6);
      assert.ok(choices.some(d=>Math.abs(patch.a*x+patch.b*z+patch.c-(d.y-.65))<=.002001));
      if(secondary)assert.ok(choices.some(d=>Math.abs(patch.secondary.a*x+patch.secondary.b*z+patch.secondary.c-d.y)<=.002001));
    }
  }
});

test('repair far thin rails keep the complete upper outline with a double-sided triangle',()=>{
  const rail={roadId:1,width:.28,walk:true,a:[0,0],b:[20,0],yA:3,yB:5},g=railGeometry([rail]);
  assert.equal(g.attributes.position.count,3);assert.equal(g.userData.lodDoubleSided,true);
  const points=Array.from({length:3},(_,i)=>new THREE.Vector3().fromBufferAttribute(g.attributes.position,i).toArray());
  assert.ok(points.some(p=>p[0]===0&&Math.abs(p[1]-4.1125)<1e-6));assert.ok(points.some(p=>p[0]===20&&Math.abs(p[1]-6.1125)<1e-6));
  assert.equal(railGeometry([{...rail,walk:false}]).attributes.position.count,6);
});

test('repair slab union removes internal side duplicates within the bounded plane error and retains separated slabs',()=>{
  const decks=[0,.0038].map((offset,i)=>({polygon:[[i*10,0],[(i+1)*10,0],[(i+1)*10,4],[i*10,4]],y:7+offset,thickness:.65}));
  const countInterior=g=>{let count=0;const p=g.attributes.position;for(let i=0;i<p.count;i+=3)if([0,1,2].every(k=>Math.abs(p.getX(i+k)-10)<1e-6))count++;return count;};
  const merged=farDeckGeometry(decks);assert.equal(countInterior(merged),0);assert.ok(Math.abs(area(merged,true)-80)<1e-5);
  assert.equal(countInterior(farDeckGeometry([decks[0],{...decks[1],y:7.02}])),4);
  const stacked=farDeckGeometry([decks[0],{...decks[0],y:7.0038}]),p=stacked.attributes.position,n=stacked.attributes.normal;let sides=0;
  for(let i=0;i<p.count;i+=3)if(Math.abs(n.getY(i))<.1)sides++;assert.equal(sides,8,'same-facing outer skins must remain as one complete envelope');
  stacked.computeBoundingBox();assert.ok(Math.abs(stacked.boundingBox.max.y-7.0038)<1e-6);assert.ok(Math.abs(stacked.boundingBox.min.y-6.35)<1e-6);
});

test('repair stair envelopes preserve both landings, width and connected endpoint heights',()=>{
  const [top,shell,rails]=stairGeometries([{key:'steps',points:[[0,0],[20,0]],width:3,y0:.32,y1:7,roadIds:[1]}]);top.computeBoundingBox();assert.equal(top.boundingBox.min.x,0);assert.equal(top.boundingBox.max.x,20);assert.ok(Math.abs(top.boundingBox.min.y-.32)<1e-6);assert.equal(top.boundingBox.max.y,7);assert.equal(top.boundingBox.max.z-top.boundingBox.min.z,3);assert.ok(shell.attributes.position.count>0);assert.equal(rails.userData.lodDoubleSided,true);
});

test('repair grounded silhouettes omit only buried bases; elevated parts retain underside structure',()=>{
  const building={id:'a',outer:[[0,0],[10,0],[10,10],[0,10]],holes:[],height:20,minHeight:0,tags:{building:'yes'}};
  const grounded=lowBuilding(building,new THREE.MeshStandardMaterial(),false),floating=lowBuilding({...building,minHeight:5},grounded.material,false);
  assert.ok(!Array.from(grounded.geometry.attributes.normal.array).filter((_,i)=>i%3===1).some(y=>y<-.5));assert.ok(Array.from(floating.geometry.attributes.normal.array).filter((_,i)=>i%3===1).some(y=>y<-.5));
});

test('independent repair review: footprint simplification cannot push a valid courtyard through the exterior',()=>{
  const b={id:'courtyard',outer:[[0,0],[10,0],[10,10],[5,10.14],[0,10]],holes:[[[4,8],[4,10.08],[6,10.08],[6,8]]],height:20,minHeight:0,tags:{building:'yes'}};
  const mesh=lowBuilding(b,new THREE.MeshStandardMaterial(),false),g=mesh.geometry;let roofArea=0;
  const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i+=3)if(n.getY(i)>.5){const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,i+k));roofArea+=v[1].sub(v[0]).cross(v[2].sub(v[0])).length()/2;}
  assert.ok(Math.abs(roofArea-96.54)<.0001,`courtyard area ${roofArea}`);
});

test('independent repair review: source self-intersection cannot be introduced by a narrow-ring simplification',()=>{
  const outer=[[0,.235119184],[1,.257118494],[2,.491658322],[3,.518163899],[4,.483617495],[5,.359336246],[5,.296939350],[4,.390005104],[3,.431073],[2,.450974426],[1,.211291329],[0,.172191698]];
  const expected=Math.abs(outer.reduce((sum,p,i)=>{const q=outer[(i+1)%outer.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
  const g=lowBuilding({id:'narrow',outer,holes:[],height:5,minHeight:0,tags:{}},new THREE.MeshStandardMaterial(),false).geometry;assert.ok(Math.abs(area(g)-expected)<1e-6);
});

test('independent repair review: bridge bottom retains shallow interior grade breaks and clamp planes',()=>{
  const decks=[1,1,8].map((y,i)=>({roadId:1,level:'7',thickness:.65,polygon:[[i*100,0],[(i+1)*100,0],[(i+1)*100,8],[i*100,8]],a:[i*100,4],b:[(i+1)*100,4],yA:y,yB:[1,8,8][i]}));
  const height=(g,x,z)=>{const p=g.attributes.position,n=g.attributes.normal,heights=[];for(let i=0;i<p.count;i+=3){if(n.getY(i)>=-.1)continue;const a=new THREE.Vector2(p.getX(i),p.getZ(i)),b=new THREE.Vector2(p.getX(i+1),p.getZ(i+1)),c=new THREE.Vector2(p.getX(i+2),p.getZ(i+2)),q=new THREE.Vector2(x,z),det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(det)<1e-9)continue;const u=((b.y-c.y)*(q.x-c.x)+(c.x-b.x)*(q.y-c.y))/det,v=((c.y-a.y)*(q.x-c.x)+(a.x-c.x)*(q.y-c.y))/det,w=1-u-v;if(Math.min(u,v,w)>=-1e-6)heights.push(u*p.getY(i)+v*p.getY(i+1)+w*p.getY(i+2));}return heights;};
  const g=farDeckGeometry(decks);for(const [x,y]of [[50,.35],[100,.35],[150,3.85],[250,7.35]]){const heights=height(g,x,4);assert.ok(heights.length>0);for(const value of heights)assert.ok(Math.abs(value-y)<.001,`${x}: ${value} vs ${y}`);}
  const clamp=farDeckGeometry([{...decks[0],yA:.32,yB:7}]);const h=height(clamp,50,4);for(const value of h)assert.ok(Math.abs(value-(.18+6.35)/2)<.001);
});

test('independent repair review: external material arrays keep authored role/color order in every level',async()=>{
  const {raw,config}=continuityFixture(),r=await compileScene(raw,config,{landmarkRegistry:{match:()=>[{recipeId:'external',recipeVersion:'1',claimedFeatureIds:['w1']}],generate:()=>{
    const group=new THREE.Group(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,2,0,0,2,0,0,2,2,2,2,0],3));g.computeVertexNormals();g.addGroup(0,3,0);g.addGroup(3,3,1);g.userData.city={materialRoles:['wall','roof']};const mesh=new THREE.Mesh(g,[new THREE.MeshStandardMaterial({color:'red'}),new THREE.MeshStandardMaterial({color:'blue'})]);mesh.name='external colors';mesh.userData.city={featureId:'w1',materialRole:'wall'};group.add(mesh);return {group,claimedFeatureIds:['w1']};
  }}});
  for(const d of r.manifest.chunks[0].lods){const g=await decodeChunk(r.assets[d.uri],d),mesh=g.children.find(m=>m.name==='external colors');assert.deepEqual(mesh.geometry.userData.city.materialRoles,['wall','roof']);assert.deepEqual(mesh.material.map(m=>m.color.getHex()),[0xff0000,0x0000ff]);}
});

test('independent repair review: one atomic mesh keeps every member of a multipart claim',async()=>{
  const {raw,config}=continuityFixture(),ids=['w548126516','w548126517','w547523487','w547523486'];
  const result=await compileScene(raw,{...config,tiling:{divisions:2}},{landmarkRegistry:{recipes:[],match:()=>[{recipeId:'single-multipart',recipeVersion:'1',generatorId:'custom',claimedFeatureIds:ids}],generate:()=>{
    const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(3,10,4),new THREE.MeshStandardMaterial()));return {group,claimedFeatureIds:ids};
  }}});
  const owner=result.manifest.featureIndex[ids[0]].ownerChunk;
  for(const id of ids){assert.equal(result.manifest.featureIndex[id].ownerChunk,owner);assert.deepEqual(result.manifest.featureIndex[id].chunkIds,[owner]);}
  const chunk=result.manifest.chunks.find(c=>c.id===owner);for(const d of chunk.lods){const group=await decodeChunk(result.assets[d.uri],d),mesh=group.children.find(o=>o.userData.city.recipeId==='single-multipart');assert.deepEqual([...mesh.userData.city.featureIds].sort(),[...ids].sort());}
});

test('independent repair review: caster metadata is optional, bounded independently, and verified against real assets',async()=>{
  const {normalizeManifest}=await import('../src/runtime/manifest.js'),{raw,config}=continuityFixture(),r=await compileScene(raw,config),d=r.manifest.chunks[0].lods.find(d=>d.id==='high');
  for(const value of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER]){const m=structuredClone(r.manifest),l=m.chunks[0].lods.find(d=>d.id==='high');delete l.shadowTriangles;delete l.shadowDrawCalls;for(const u of l.drawUnits){delete u.shadowTriangles;delete u.shadowDrawCalls;}l.drawUnits[0].shadowTriangles=value;assert.equal(validateSceneManifest(m).valid,false);assert.throws(()=>normalizeManifest(m,'https://example.test/manifest.json'));}
  const partial=structuredClone(r.manifest),p=partial.chunks[0].lods.find(d=>d.id==='high');delete p.shadowTriangles;delete p.shadowDrawCalls;for(const u of p.drawUnits){delete u.shadowTriangles;delete u.shadowDrawCalls;}p.drawUnits[0].shadowTriangles=d.drawUnits[0].shadowTriangles;assert.equal(validateSceneManifest(partial).valid,true);await decodeChunk(r.assets[d.uri],p);
  const lie=structuredClone(d);lie.shadowTriangles=lie.shadowDrawCalls=0;for(const u of lie.drawUnits)u.shadowTriangles=u.shadowDrawCalls=0;await assert.rejects(decodeChunk(r.assets[d.uri],lie),{code:'INVALID_CHUNK'});
  const unitLie=structuredClone(d);delete unitLie.shadowTriangles;delete unitLie.shadowDrawCalls;for(const u of unitLie.drawUnits){delete u.shadowTriangles;delete u.shadowDrawCalls;}const i=d.drawUnits.findIndex(u=>u.shadowTriangles>0);unitLie.drawUnits[i].shadowTriangles=0;await assert.rejects(decodeChunk(r.assets[d.uri],unitLie),{code:'INVALID_CHUNK'});
  const legacy=structuredClone(d);delete legacy.shadowTriangles;delete legacy.shadowDrawCalls;for(const u of legacy.drawUnits){delete u.shadowTriangles;delete u.shadowDrawCalls;}await decodeChunk(r.assets[d.uri],legacy);
  const badAggregate=structuredClone(r.manifest),a=badAggregate.chunks[0].lods[0];delete a.drawUnits;a.shadowTriangles=-1;assert.throws(()=>normalizeManifest(badAggregate,'https://example.test/manifest.json'));
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

test('repair nearDetails is the actual active complete-group count and remains optional for old assets',async()=>{
  const {measureGroup,ResourceRegistry}=await import('../src/runtime/resources.js'),group=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  const details=new THREE.InstancedMesh(geometry,material,3);details.userData.city={lodRole:'detail'};group.add(details);const near=new THREE.Mesh(geometry,material);near.userData.city={lodRole:'near'};group.add(near);const body=new THREE.Mesh(geometry,material);body.userData.city={lodRole:'body'};group.add(body);
  const hidden=new THREE.Group();hidden.visible=false;const ignored=new THREE.Mesh(geometry,material);ignored.userData.city={lodRole:'detail'};hidden.add(ignored);group.add(hidden);
  assert.equal(sceneStats(group).nearDetails,4);assert.equal(measureGroup(group).nearDetails,4);const payload=encodeChunk(group);assert.equal(sceneStats(await decodeChunk(payload,{nearDetails:4})).nearDetails,4);await assert.rejects(decodeChunk(payload,{nearDetails:0}),{code:'INVALID_CHUNK'});await decodeChunk(payload,{});
  const registry=new ResourceRegistry(),resources=registry.retain(group);group.visible=false;assert.equal(sceneStats(group).nearDetails,0);assert.ok(registry.stats().geometryArrayBytes>0);registry.release(resources);
  const {raw,config}=continuityFixture(),r=await compileScene(raw,config),{normalizeManifest}=await import('../src/runtime/manifest.js');
  for(const d of r.manifest.chunks[0].lods){const decoded=await decodeChunk(r.assets[d.uri],d);assert.equal(d.nearDetails,measureGroup(decoded).nearDetails);assert.equal(d.drawUnits.some(u=>'nearDetails'in u),false);}
  for(const value of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1]){const m=structuredClone(r.manifest);m.chunks[0].lods[0].nearDetails=value;assert.equal(validateSceneManifest(m).valid,false);assert.throws(()=>normalizeManifest(m,'https://example.test/manifest.json'));}
  const legacy=structuredClone(r.manifest);for(const c of legacy.chunks)for(const d of c.lods)delete d.nearDetails;assert.equal(validateSceneManifest(legacy).valid,true);normalizeManifest(legacy,'https://example.test/manifest.json');
});
