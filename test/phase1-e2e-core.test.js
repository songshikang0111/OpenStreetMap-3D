import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,validateProjectConfig} from '../src/core/index.js';
import {decodeChunk} from '../src/core/scene-codec.js';
import {createLandmarkRegistry} from '../src/landmark-registry.js';
import {bindSceneStyle} from '../src/styles/index.js';
import {getStyle} from '../src/styles/index.js';
import {MeshStandardMaterial} from 'three';
import official from '../packages/landmarks/index.js';
import {continuityFixture} from './phase1-core-fixture.js';

test('integrated compiler uses official registry once and records grouped rule provenance',async()=>{
  const {raw,config}=continuityFixture(),result=await compileScene(raw,config);
  assert.equal(result.manifest.featureIndex.w599547918.provenance.recipeId,'china-zun');
  const cctv=['w547523486','w547523487','w548126516','w548126517'].map(id=>result.manifest.featureIndex[id]);
  assert.equal(new Set(cctv.map(feature=>feature.atomicGroupId)).size,1);assert.ok(cctv.every(feature=>feature.provenance.recipeId==='cctv-headquarters'));
  for(const descriptor of result.manifest.chunks.flatMap(chunk=>chunk.lods)){
    const group=await decodeChunk(result.assets[descriptor.uri],descriptor),binding=bindSceneStyle(group,{style:'comic'});binding.dispose();
    group.traverse(mesh=>{mesh.geometry?.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material?.dispose();});
  }
});

test('official override changes actual high geometry and leaves one source owner',async()=>{
  const {raw,config}=continuityFixture(),recipe=structuredClone(official.recipes[0]);recipe.version='1.0.1';recipe.parameters.ribWidth=1.1;
  const base=await compileScene(raw,config),changed=await compileScene(raw,config,{landmarkRegistry:createLandmarkRegistry({overrides:{'china-zun':recipe}})});
  const high=result=>result.manifest.chunks[0].lods.find(lod=>lod.id==='high');assert.notEqual(high(base).hash,high(changed).hash);
  const group=await decodeChunk(changed.assets[high(changed).uri],high(changed)),owners=[];
  group.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.city?.featureId==='w599547918'&&mesh.userData.city.kind==='building')owners.push(mesh);});
  assert.equal(owners.length,1);assert.equal(changed.manifest.featureIndex.w599547918.provenance.recipeVersion,'1.0.1');
});

test('shared project contract accepts CLI import, runtime low and locked recipe objects',()=>{
  const {config}=continuityFixture();assert.equal(validateProjectConfig({...config,source:{kind:'import',file:'data/source.json'},quality:'low',landmarks:{enabled:true,packages:[{path:'rules/package.json',hash:'a'.repeat(64)}]}}).valid,true);
});

test('integrated project strict policy rejects unknown generators while degraded retains source bodies',async()=>{
  const {raw,config}=continuityFixture(),recipe=structuredClone(official.recipes[0]);recipe.generator='missing/generator';
  const registry=createLandmarkRegistry({overrides:{'china-zun':recipe}});
  const degraded=await compileScene(raw,config,{landmarkRegistry:registry});
  assert.ok(degraded.report.diagnostics.some(diagnostic=>diagnostic.code==='LANDMARK_GENERATOR_UNKNOWN'));assert.equal(degraded.manifest.featureIndex.w599547918.provenance.recipeId,undefined);
  await assert.rejects(compileScene(raw,{...config,landmarks:{enabled:true,policy:'strict',packages:[]}},{landmarkRegistry:registry}),error=>error.code==='LANDMARK_GENERATOR_UNKNOWN');
  assert.equal(validateProjectConfig({...config,camera:{position:[NaN,0,0]}}).valid,false);
});

test('CINK partitions and far batches preserve roof/wall/structure roles for external style binding',async()=>{
  const {raw,config}=continuityFixture(),result=await compileScene(raw,{...config,tiling:{divisions:2}});
  for(const level of ['low','medium','high']){
    const seen=new Set();
    for(const chunk of result.manifest.chunks){
      const descriptor=chunk.lods.find(lod=>lod.id===level),group=await decodeChunk(result.assets[descriptor.uri],descriptor);
      group.traverse(mesh=>{if(!mesh.isMesh||!mesh.geometry.userData.city?.materialRoles)return;const g=mesh.geometry;for(const part of g.groups)for(let i=part.start;i<part.start+part.count;i++){const vertex=g.index?g.index.getX(i):i;assert.equal(mesh.userData.city.materialRoleTable[g.attributes.cityMaterialRole.getX(vertex)],g.userData.city.materialRoles[part.materialIndex],`${level} role attribute disagrees with group`);}});
      const style={...getStyle('color'),id:'role-audit',createMaterial({object,role}){if(object.userData.city.featureIds.includes('w1'))seen.add(role);return new MeshStandardMaterial();}};
      const binding=bindSceneStyle(group,{style});binding.dispose();
    }
    for(const role of ['wall','roof','structure'])assert.ok(seen.has(role),`${level} missing ${role}`);
  }
});
