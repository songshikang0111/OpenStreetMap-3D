import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { compileScene, validateProjectConfig, validateSceneManifest } from '../src/core/index.js';
import { decodeChunk, encodeChunk, sceneStats } from '../src/core/scene-codec.js';
import { continuityFixture } from './phase1-core-fixture.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const totals=(r,lod)=>r.manifest.chunks.reduce((s,c)=>{const l=c.lods.find(l=>l.id===lod);for(const k of ['triangles','bytes','drawCalls','residentBytes'])s[k]=(s[k]||0)+(l?.[k]||0);return s;},{});
let fixtureResult;
const compiled=()=>fixtureResult??=(async()=>{const {raw,config}=continuityFixture();return compileScene(raw,config);})();
async function worldSignature(result,lod='high') {
  const records=[];
  for(const c of result.manifest.chunks){
    const descriptor=c.lods.find(l=>l.id===lod),g=await decodeChunk(result.assets[descriptor.uri],descriptor);g.updateMatrixWorld(true);
    g.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.attributes.position,indices=mesh.geometry.index?.array,count=indices?.length??p.count;
      const m=new THREE.Matrix4(),v=new THREE.Vector3();
      if(mesh.isInstancedMesh){
        for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);records.push(JSON.stringify(['instance',mesh.name,mesh.userData.city.instanceFeatureIds[i],m.toArray()]));}
      }else for(let i=0;i<count;i+=3){
        const points=[0,1,2].map(k=>v.fromBufferAttribute(p,indices?indices[i+k]:i+k).applyMatrix4(mesh.matrixWorld).toArray());
        records.push(JSON.stringify([mesh.userData.city.materialRole,points]));
      }
    });
  }
  return hash(records.sort().join('\n'));
}

test('project config defaults lock one origin without mutating input and rejects unsupported areas',()=>{
  const {config}=continuityFixture(),input=structuredClone(config);delete input.origin;
  const result=validateProjectConfig(input);assert.equal(result.valid,true);assert.ok(result.value.origin);assert.equal(input.origin,undefined);
  for(const bad of [{...config,schemaVersion:9},{...config,seed:NaN},{...config,area:{south:-1,north:1,west:179,east:-179}},{...config,area:{south:84,north:85,west:1,east:1.01}},{...config,area:{south:0,north:1,west:0,east:1}},{...config,tiling:{sizeMeters:0}},{...config,origin:{lat:0,lon:0}}])assert.equal(validateProjectConfig(bad).valid,false);
});

test('same locked input produces byte-identical manifest and binary resources, independent of element traversal',async()=>{
  const first=await compiled(),{raw,config}=continuityFixture();raw.elements.reverse();const again=await compileScene(raw,config);
  assert.deepEqual(again.manifest,first.manifest);assert.deepEqual(Object.keys(again.assets),Object.keys(first.assets));
  for(const path of Object.keys(first.assets))assert.equal(hash(first.assets[path]),hash(again.assets[path]),path);
  const changed=await compileScene(raw,{...config,seed:config.seed+1});assert.notEqual(first.manifest.hashes.world,changed.manifest.hashes.world);
});

test('fixed coverage 1/4/16 tiles preserves exact world triangles, bridge grades, water and stable object identities',async()=>{
  const one=await compiled(),{raw,config}=continuityFixture(),signature=await worldSignature(one),lowSignature=await worldSignature(one,'low');
  for(const divisions of [2,4]){
    const result=await compileScene(raw,{...config,tiling:{divisions}});
    assert.equal(result.manifest.chunks.length,divisions*divisions);
    assert.equal(await worldSignature(result),signature,'shared geometry must not gain gaps, overlaps or moved points');
    assert.equal(await worldSignature(result,'low'),lowSignature);
    assert.equal(result.manifest.hashes.world,one.manifest.hashes.world);
    assert.deepEqual(Object.keys(result.manifest.featureIndex),Object.keys(one.manifest.featureIndex));
    for(const id of ['w1','w548126516','w548126517','w547523487','w547523486'])assert.equal(result.manifest.featureIndex[id].chunkIds.length,1,`${id} is atomic`);
    const cctv=['w548126516','w548126517','w547523487','w547523486'].map(id=>result.manifest.featureIndex[id].ownerChunk);assert.equal(new Set(cctv).size,1);
    for(const f of Object.values(result.manifest.featureIndex).filter(f=>f.kind==='tree'))assert.equal(f.chunkIds.length,1,`${f.featureId} trunk/crown own the same tile`);
  }
});

test('true far LOD cuts submitted triangles, resident bytes, asset bytes and draw calls; high restores attachments',async()=>{
  const result=await compiled(),low=totals(result,'low'),medium=totals(result,'medium'),high=totals(result,'high');
  for(const key of ['triangles','residentBytes','bytes','drawCalls'])assert.ok(low[key]<medium[key],`${key}: low=${low[key]} medium=${medium[key]}`);
  assert.ok(high.triangles>medium.triangles);assert.ok(high.bytes>medium.bytes);
  assert.equal(validateSceneManifest(result.manifest).valid,true);
  console.log(JSON.stringify({syntheticFixtureLOD:{low,medium,high}}));
});

test('codec roundtrip preserves procedural attributes, multi-material roles, instances, source IDs and selection',async()=>{
  const group=new THREE.Group(),g=new THREE.BoxGeometry(1,2,3),n=g.attributes.position.count;
  g.setAttribute('aFacade',new THREE.Float32BufferAttribute(new Float32Array(n*4).fill(.125),4));
  g.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(17),1));
  const materials=Array.from({length:6},(_,i)=>new THREE.MeshStandardMaterial({color:0xffffff-i,userData:{city:{materialRole:i?'wall':'roof'}}}));
  const mesh=new THREE.InstancedMesh(g,materials,2);mesh.name='fixture';mesh.userData={inkClass:1,generatedFacade:true,city:{featureIds:['a','b'],instanceFeatureIds:['a','b'],sourceIds:['way/1','way/2'],materialRole:'wall'}};
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(10,20,30));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-10,3,4));mesh.setColorAt(0,new THREE.Color('red'));mesh.setColorAt(1,new THREE.Color('blue'));group.add(mesh);
  const payload=encodeChunk(group),decoded=await decodeChunk(payload,{bytes:payload.length,hash:hash(payload)}),copy=decoded.children[0];
  assert.deepEqual(copy.userData,mesh.userData);assert.deepEqual(copy.geometry.groups,g.groups);assert.deepEqual(copy.geometry.attributes.aFacade.array,g.attributes.aFacade.array);assert.deepEqual(copy.geometry.attributes.cityFeature.array,g.attributes.cityFeature.array);assert.deepEqual(copy.instanceMatrix.array,mesh.instanceMatrix.array);assert.deepEqual(copy.instanceColor.array,mesh.instanceColor.array);
  assert.deepEqual(copy.material.map(m=>m.userData),materials.map(m=>m.userData));assert.deepEqual(sceneStats(decoded),sceneStats(group));assert.deepEqual(encodeChunk(decoded),payload);
  assert.equal(copy.material[0].onBeforeCompile.toString().includes('installFacadeShader'),false,'runtime code is supplied by style binding');
});

test('codec and manifest reject corruption, unsupported versions and invalid resource references',async()=>{
  const result=await compiled(),descriptor=result.manifest.chunks[0].lods[0],bytes=result.assets[descriptor.uri];
  for(const bad of [bytes.subarray(0,8),new Uint8Array(20)])await assert.rejects(decodeChunk(bad),{code:'INVALID_CHUNK'});
  const badVersion=bytes.slice();new DataView(badVersion.buffer).setUint32(4,9,true);await assert.rejects(decodeChunk(badVersion),{code:'UNSUPPORTED_CHUNK_VERSION'});
  const badHash=bytes.slice();badHash[badHash.length-1]^=1;await assert.rejects(decodeChunk(badHash,descriptor),{code:'INVALID_CHUNK'});
  const manifest=structuredClone(result.manifest);manifest.chunks[0].lods[0].uri='../outside.cink';assert.equal(validateSceneManifest(manifest).valid,false);
  manifest.schemaVersion=2;assert.equal(validateSceneManifest(manifest).valid,false);
});

test('progress cancellation yields an explicit error and no partial success',async()=>{
  const {raw,config}=continuityFixture(),controller=new AbortController(),stages=[];
  await assert.rejects(compileScene(raw,config,{signal:controller.signal,onProgress:p=>{stages.push(p.stage);if(p.stage==='geometry')controller.abort();}}),{code:'BUILD_CANCELLED'});
  assert.deepEqual(stages,['parse','plan','geometry']);
});

test('injected registry claims multipart objects once; failed recipes diagnose fallback; disable uses generic bodies',async()=>{
  const {raw,config}=continuityFixture();let generated=0;
  const claimed=['w548126516','w548126517','w547523487','w547523486'];
  const landmarkRegistry={match:()=>[{recipeId:'external/cctv',recipeVersion:'1.2.3',claimedFeatureIds:claimed}],generate:()=>{generated++;const group=new THREE.Group();group.position.set(20,0,100);group.add(new THREE.Mesh(new THREE.BoxGeometry(12,200,12),new THREE.MeshStandardMaterial()));return {group,claimedFeatureIds:claimed,provenance:{source:'test-recipe'}};}};
  const result=await compileScene(raw,{...config,tiling:{divisions:4}},{landmarkRegistry});assert.equal(generated,1);
  for(const id of claimed)assert.equal(result.manifest.featureIndex[id].provenance.recipeVersion,'1.2.3');
  assert.equal(new Set(claimed.map(id=>result.manifest.featureIndex[id].ownerChunk)).size,1);
  const failed=await compileScene(raw,config,{landmarkRegistry:{...landmarkRegistry,generate:()=>{throw Error('broken');}}});assert.ok(failed.report.diagnostics.some(d=>d.code==='LANDMARK_GENERATION_FAILED'));
  const disabled=await compileScene(raw,{...config,landmarks:{enabled:false}},{landmarkRegistry});assert.equal(generated,1);assert.equal(disabled.manifest.featureIndex.w548126516.atomicGroupId,undefined);
});
