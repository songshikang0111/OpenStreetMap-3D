import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { continuityFixture } from './phase1-core-fixture.js';
import { compileScene } from '../src/core/index.js';
import { decodeChunk } from '../src/core/scene-codec.js';
import { normalizeManifest } from '../src/runtime/manifest.js';
import { createBudget, chooseLod } from '../src/runtime/policy.js';
import { NearDetails } from '../src/runtime/near-details.js';
import { bindSceneStyle, createStyleShared } from '../src/styles/index.js';
import { ResourceRegistry } from '../src/runtime/resources.js';
import { InkRenderer } from '../src/ink-renderer.js';

test('real CINK low/medium/high bind every official style; numeric level order is preserved and sorted by detail', async () => {
  const {raw,config}=continuityFixture(),result=await compileScene(raw,{...config,tiling:{divisions:2}}),m=normalizeManifest(result.manifest,'https://example.test/city/manifest.json');
  assert.deepEqual(m.chunks[0].lods.map(l=>l.id),['high','medium','low']);
  const highTrees=[],wallKeys=[];
  for(const c of result.manifest.chunks)for(const lod of c.lods){
    const group=await decodeChunk(result.assets[lod.uri],lod),registry=new ResourceRegistry();let resources=registry.retain(group);
    for(const style of ['comic','line','color','white']){const binding=bindSceneStyle(group,{style,shared:createStyleShared()});assert(binding);binding.dispose();}
    if(lod.id==='high'){assert.equal(group.userData.city.nearDetails.schemaVersion,1);highTrees.push(...group.userData.city.nearDetails.trees.map(t=>t.featureId));wallKeys.push(...group.userData.city.nearDetails.facadeWalls.map(w=>w.key));}
    registry.release(resources);
  }
  assert(highTrees.length>0);assert.equal(new Set(highTrees).size,highTrees.length);assert.equal(new Set(wallKeys).size,wallKeys.length);
  const projected={chunk:m.chunks[0],pixels:1000,scale:1000,distance:100};
  assert.equal(chooseLod(projected,null,createBudget({minResidenceMs:0}),1000),0);
});
test('rehydrated near frames and crown clusters obey one global budget and release all buffers when distant',async()=>{
  const {raw,config}=continuityFixture(),result=await compileScene(raw,config),c=result.manifest.chunks[0],lod=c.lods.find(l=>l.id==='high'),group=await decodeChunk(result.assets[lod.uri],lod);
  const details=group.userData.city.nearDetails;assert(details.facadeWalls.length>0);
  const near=new NearDetails({budget:createBudget({nearDetails:1500,unloadDelayMs:0}),bindGroup:g=>bindSceneStyle(g,{style:'comic',shared:createStyleShared()})});
  const wall=details.facadeWalls[0],camera=new THREE.PerspectiveCamera();camera.position.set(wall.a[0]+wall.normal[0]*8,15,wall.a[1]+wall.normal[2]*8);
  near.update([{group}],camera,1000,900000,5);assert(near.stats().frames>0);assert(near.stats().nearDetails<=1500);assert(near.stats().triangles*5<=900000);
  const tree=details.trees[0];camera.position.set(tree.x+3,tree.h*.7,tree.z+3);near.update([{group}],camera,2000,900000,5);assert(near.stats().crownClusters>0);assert(near.stats().nearDetails<=1500);
  camera.position.set(5000,5000,5000);near.update([{group}],camera,3000,900000,5);assert.equal(near.stats().geometries,0);assert.equal(near.registry.refs.size,0);near.dispose();
});
test('streamed classification clones are released on eviction rather than retained until viewer disposal',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),ink=new InkRenderer({},scene,camera),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  for(let i=0;i<5;i++){
    const group=new THREE.Group(),a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry,material);a.userData.inkClass=1;b.userData.inkClass=2;group.add(a,b);ink.prepareGroup(group);assert(ink._classificationClones.size>0);ink.releaseGroup(group);assert.equal(ink._classificationClones.size,0);
  }
  ink.dispose();geometry.dispose();material.dispose();
});
