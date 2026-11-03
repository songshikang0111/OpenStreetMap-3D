import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {collectDrawUnits,costContext,drawUnitCost,renderProfile,renderWithProfile} from '../src/runtime/render-cost.js';
import {ChunkStreamer} from '../src/runtime/streamer.js';
import {createBudget,budgetPlan,projectChunks} from '../src/runtime/policy.js';
import {normalizeManifest} from '../src/runtime/manifest.js';

test('frame costs separate view, offscreen shadow casters, groups, instances and double-sided color',()=>{
 const group=new THREE.Group(),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 const material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);mesh.castShadow=true;group.add(mesh);
 const profile={scenePasses:4,colorPasses:1,shadowPasses:1,fixedCalls:3,fixedTriangles:6};
 const context=costContext(camera,profile);let units=collectDrawUnits(group),cost=drawUnitCost(units,context);
 assert.equal(cost.frameTriangles,72);assert.equal(cost.frameCalls,6);
 mesh.position.x=30;units=collectDrawUnits(group);cost=drawUnitCost(units,context);
 assert.equal(cost.triangles,0);assert.equal(cost.shadowTriangles,12);assert.equal(cost.frameTriangles,12);
 mesh.castShadow=false;cost=drawUnitCost(collectDrawUnits(group),context);assert.equal(cost.frameTriangles,0);
 const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),3);group.clear();group.add(inst);assert.equal(collectDrawUnits(group)[0].triangles,36);
 group.visible=false;assert.equal(collectDrawUnits(group).length,1);assert.equal(group.visible,false);
});

test('external pipeline pass observation is independent of geometry and restores renderer after failure',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),screen=new THREE.Scene();
 const renderer={shadowMap:{autoUpdate:true},info:{render:{calls:0,triangles:0}},render(object){this.info.render.calls++;this.info.render.triangles+=object===screen?2:120;}};
 const original=renderer.render;
 const profile=renderWithProfile(renderer,{render(){renderer.render(scene,camera);renderer.shadowMap.autoUpdate=false;renderer.render(scene,camera);renderer.render(screen,camera);}},scene,camera,true);
 assert.deepEqual(profile,{scenePasses:2,colorPasses:2,shadowPasses:1,fixedCalls:1,fixedTriangles:2});assert.equal(renderer.render,original);
 assert.throws(()=>renderWithProfile(renderer,{render(){throw Error('failed');}},scene,camera,true));assert.equal(renderer.render,original);
 assert.equal(renderProfile({ink:{aoEnabled:false,material:{uniforms:{mode:{value:0}}}}},true).fixedTriangles,4);
});

test('budget upgrades require headroom while hard caps override residence',()=>{
 const p={visible:true,pixels:2000,chunk:{id:'x',lods:[{triangles:590,bytes:1},{triangles:300,bytes:1},{triangles:100,bytes:1}]}};
 const budget=createBudget({visibleTriangles:600,minResidenceMs:0});
 assert.equal(budgetPlan([p],new Map(),budget,1000).requests[0].index,0);
 assert.equal(budgetPlan([p],new Map([['x',{index:1,since:0}]]),budget,1000).requests[0].index,1);
 assert.equal(budgetPlan([p],new Map([['x',{index:0,since:999}]]),{...budget,minResidenceMs:750,visibleTriangles:400},1000).requests[0].index,1);
});

test('counted coarse standby preserves coverage during immediate camera budget changes and is released',async()=>{
 const manifest=normalizeManifest({schemaVersion:1,bounds:[-5,-5,-5,5,5,5],chunks:[{id:'x',contentBounds:[-5,-5,-5,5,5,5],lods:[{uri:'high',level:0,bytes:10,triangles:100,minScreenPixels:0},{uri:'low',level:1,bytes:10,triangles:12}]}]},'https://example.test/manifest.json');
 const budget=createBudget({minResidenceMs:0,visibleTriangles:10000}),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 const streamer=new ChunkStreamer({manifest,budget,readAsset:async()=>new ArrayBuffer(0),decodeChunk:(_bytes,lod)=>{const g=new THREE.Group();g.add(new THREE.Mesh(lod.level===0?new THREE.SphereGeometry(1,16,12):new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));return g;}});
 const context=costContext(camera,{scenePasses:1,colorPasses:1,shadowPasses:0,fixedCalls:0,fixedTriangles:0});
 for(let t=0;t<100;t++){streamer.update(camera,720,t*40,{renderContext:context});await new Promise(r=>setTimeout(r,0));}
 assert.equal(streamer.current.get('x').index,0);assert.equal(streamer.standby.size,1);assert(streamer.estimatedBytes()>streamer.current.get('x').estimatedBytes);
 budget.visibleTriangles=20;streamer.update(camera,720,5000,{renderContext:context});assert.equal(streamer.current.get('x').index,1);assert.equal(streamer.stats().missingChunks.length,0);assert(streamer.frameCost().triangles<=20);
 await streamer.dispose();assert.equal(streamer.registry.refs.size,0);assert.equal(streamer.estimatedBytes(),0);
});

test('standby admission cannot alternate targets at a narrow resident limit',async()=>{
 for(const underDeclared of [false,true]){
  const manifest=normalizeManifest({schemaVersion:1,bounds:[-5,-5,-5,5,5,5],chunks:[{id:'x',contentBounds:[-5,-5,-5,5,5,5],lods:[{uri:'high',level:0,bytes:1500,triangles:100,minScreenPixels:0},{uri:'low',level:1,bytes:1000,triangles:12}]}]},'https://example.test/manifest.json');
  const budget=createBudget({minResidenceMs:0,residentBytes:underDeclared?10000:2000}),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
  const requests=[];const streamer=new ChunkStreamer({manifest,budget,readAsset:async url=>{requests.push(url);return new ArrayBuffer(0);},decodeChunk:(_bytes,lod)=>{const g=new THREE.Group();g.add(new THREE.Mesh(lod.level===0&&underDeclared?new THREE.SphereGeometry(1,32,24):new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));return g;}});
  const context=costContext(camera,{scenePasses:1,colorPasses:1,shadowPasses:0,fixedCalls:0,fixedTriangles:0});
  for(let i=0;i<100;i++){streamer.update(camera,720,i*40,{renderContext:context});await new Promise(r=>setTimeout(r,0));}
  assert.equal(streamer.current.get('x').index,1);assert.equal(streamer.counters.swaps,0);assert(requests.filter(url=>url.endsWith('/high')).length<=1);assert(streamer.estimatedBytes()<=budget.residentBytes);assert(streamer.isSettled());await streamer.dispose();
 }
});

test('cached world-space units remain isolated when chunks reuse one asset URL with different transforms',()=>{
 const manifest=normalizeManifest({schemaVersion:1,bounds:[-1,-1,-1,101,1,1],chunks:[0,100].map((x,i)=>({id:String(i),contentBounds:[x-1,-1,-1,x+1,1,1],transform:{translation:[x,0,0]},lods:[{uri:'shared',bytes:1,triangles:12}]}))},'https://example.test/manifest.json');
 const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);const context=costContext(camera,{scenePasses:1,colorPasses:1,shadowPasses:0});
 const cache=new Map(manifest.chunks.map(chunk=>[`${chunk.id}:${chunk.lods[0].url}`,[{sphere:chunk.box.getBoundingSphere(new THREE.Sphere()),triangles:12,drawCalls:1}]]));
 const projected=projectChunks(manifest.chunks,camera,720,100,context,cache);
 assert.equal(projected[0].costs[0].frameTriangles,12);assert.equal(projected[1].costs[0].frameTriangles,0);
});
