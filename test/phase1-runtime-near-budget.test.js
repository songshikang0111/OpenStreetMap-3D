import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {measureGroup} from '../src/runtime/resources.js';
import {createBudget,budgetPlan} from '../src/runtime/policy.js';
import {ChunkStreamer} from '../src/runtime/streamer.js';
import {NearDetails} from '../src/runtime/near-details.js';
import {normalizeManifest} from '../src/runtime/manifest.js';
import {costContext} from '../src/runtime/render-cost.js';
import {compileScene} from '../src/core/index.js';
import {decodeChunk} from '../src/core/scene-codec.js';
import {continuityFixture} from './phase1-core-fixture.js';
import {bindSceneStyle,createStyleShared} from '../src/styles/index.js';

const tick=()=>new Promise(r=>setTimeout(r,0));
function detailGroup(count){const group=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),count);mesh.userData.city={lodRole:'detail'};group.add(mesh);return group;}
function makeManifest(nearDetails){return normalizeManifest({schemaVersion:1,bounds:[-5,-5,-5,5,5,5],chunks:[{id:'c',contentBounds:[-5,-5,-5,5,5,5],lods:[{level:0,uri:'high',bytes:1000,triangles:4920,minScreenPixels:0,...(nearDetails===undefined?{}:{nearDetails})},{level:1,uri:'low',bytes:1000,triangles:60,nearDetails:5}]}]},'https://example.test/manifest.json');}

test('near detail counts are geometry units, independent of material groups and root standby visibility',()=>{
 const group=detailGroup(9),mesh=new THREE.Mesh(new THREE.BoxGeometry(),[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial()]);mesh.userData.city={lodRole:'near'};group.add(mesh);
 const body=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());group.add(body);
 assert.equal(measureGroup(group).nearDetails,10);
 group.visible=false;assert.equal(measureGroup(group).nearDetails,0);assert.equal(measureGroup(group,{includeHiddenRoot:true}).nearDetails,10);assert.equal(group.visible,false);
 mesh.visible=false;assert.equal(measureGroup(group,{includeHiddenRoot:true}).nearDetails,9);
 for(const child of group.children){child.geometry.dispose();for(const m of [child.material].flat())m.dispose();}
});

test('manifest near counts are optional, validated and superseded by measured costs',()=>{
 for(const value of [-1,.5,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>makeManifest(value),{code:'INVALID_LOD'});
 const manifest=makeManifest(410),projected=[{visible:true,pixels:2000,chunk:manifest.chunks[0]}];
 assert.equal(budgetPlan(projected,new Map(),createBudget({nearDetails:400}),1000).requests[0].index,1);
 projected[0].detailCosts=[10,5];assert.equal(budgetPlan(projected,new Map(),createBudget({nearDetails:400}),1000).requests[0].index,0);
 projected[0].detailCosts=[410,5];projected[0].chunk.lods[0].nearDetails=0;assert.equal(budgetPlan(projected,new Map(),createBudget({nearDetails:400}),1000).requests[0].index,1);
});

test('legacy missing or underdeclared counts are learned before mount and cannot cause repeat high requests',async()=>{
 for(const declared of [undefined,0,410]){
  const budget=createBudget({nearDetails:400,minResidenceMs:0}),manifest=makeManifest(declared),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
  const requests=[];const stream=new ChunkStreamer({manifest,budget,readAsset:async url=>{requests.push(url);return new ArrayBuffer(0);},decodeChunk:(_bytes,lod)=>detailGroup(lod.level===0?410:5)});
  const context=costContext(camera,{scenePasses:4,colorPasses:1,shadowPasses:0,fixedCalls:3,fixedTriangles:6});
  for(let i=0;i<40;i++){stream.update(camera,720,i*40,{renderContext:context});assert(stream.frameCost().nearDetails<=400);assert.equal(stream.stats().missingChunks.length,stream.current.size?0:1);await tick();}
  assert.equal(stream.current.get('c').index,1);assert(stream.isSettled());assert(requests.filter(url=>url.endsWith('/high')).length<=1);assert.equal(stream.stats().nearDetails,5);
  // Standby / offscreen-root visibility does not erase the intrinsic cost cache.
  await stream.rebind(()=>null);assert.equal(stream.detailCache.get('c:https://example.test/low'),5);
  await stream.dispose();assert.equal(stream.detailCache.size,0);assert.equal(stream.registry.refs.size,0);assert.equal(stream.estimatedBytes(),0);
 }
});

test('real CINK facade and complete tree profiles share the remaining global near budget',async()=>{
 const {raw,config}=continuityFixture(),result=await compileScene(raw,config),lod=result.manifest.chunks[0].lods.find(l=>l.id==='high'),group=await decodeChunk(result.assets[lod.uri],lod),body=measureGroup(group).nearDetails;
 assert(body>0);const shared=createStyleShared(),bindGroup=g=>bindSceneStyle(g,{style:'comic',shared}),binding=bindGroup(group),budget=createBudget({nearDetails:body+120}),near=new NearDetails({budget,bindGroup});
 const details=group.userData.city.nearDetails,wall=details.facadeWalls[0],camera=new THREE.PerspectiveCamera();camera.position.set(wall.a[0]+wall.normal[0]*8,15,wall.a[1]+wall.normal[2]*8);
 near.update([{group}],camera,0,900000,5);assert(near.stats().nearDetails>0);assert(body+near.stats().nearDetails<=budget.nearDetails);
 // Explicit SDK headroom must be used once, and an older caller is also safe.
 near.update([{group}],camera,40,900000,5,{nearDetails:10});assert(near.stats().nearDetails<=10);
 budget.nearDetails=body-1;near.update([{group}],camera,80,900000,5);assert.equal(near.stats().nearDetails,0);assert.equal(near.stats().geometries,0);assert.equal(measureGroup(group).nearDetails,body);
 const tree=details.trees[0];group.userData.city.nearDetails={...details,facadeWalls:[],trees:[tree]};camera.position.set(tree.x+3,tree.h*.7,tree.z+3);
 budget.nearDetails=body+23;near.update([{group}],camera,120,900000,5);assert.equal(near.stats().nearDetails,0);
 budget.nearDetails=body+24;near.update([{group}],camera,160,900000,5);assert.equal(near.stats().nearDetails,24);assert.equal(near.stats().crownClusters,18);assert.equal(near.stats().branches,6);
 near.dispose();assert.equal(near.registry.refs.size,0);binding.dispose();group.traverse(o=>o.geometry?.dispose());
});
