import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { compileScene, validateProjectConfig, validateSceneManifest } from '../src/core/index.js';
import { decodeChunk, encodeChunk, sceneStats } from '../src/core/scene-codec.js';
import { continuityFixture } from './phase1-core-fixture.js';
import { partitionMesh } from '../src/core/geometry.js';

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

test('independent review: matcher errors and empty generated groups retain default bodies with diagnostics',async()=>{
  const {raw,config}=continuityFixture(),base=await compiled();
  const match={recipeId:'broken',recipeVersion:'1',claimedFeatureIds:['w1']};
  for(const registry of [{match:()=>{throw Error('matcher failed');}}, {match:()=>[match],generate:()=>({group:new THREE.Group(),claimedFeatureIds:['w1']})}]){
    const r=await compileScene(raw,config,{landmarkRegistry:registry});assert.ok(r.report.diagnostics.some(d=>/^LANDMARK_(MATCH|GENERATION)_FAILED$/.test(d.code)));
    assert.equal(r.manifest.featureIndex.w1.provenance.recipeId,undefined);assert.deepEqual(r.manifest.featureIndex.w1.bounds,base.manifest.featureIndex.w1.bounds);
    assert.equal(totals(r,'medium').triangles,totals(base,'medium').triangles);
  }
});

test('independent review: registry supports repeated instances for a single claimed building',async()=>{
  const {raw,config}=continuityFixture();
  const match={recipeId:'instanced',recipeVersion:'1',claimedFeatureIds:['w1']};
  const r=await compileScene(raw,{...config,tiling:{divisions:4}},{landmarkRegistry:{match:()=>[match],generate:()=>{
    const group=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(5,20,5),new THREE.MeshStandardMaterial(),2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-10,10,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(10,10,0));group.add(mesh);return {group,claimedFeatureIds:['w1']};
  }}});
  assert.equal(r.manifest.featureIndex.w1.chunkIds.length,1);const chunk=r.manifest.chunks.find(c=>c.id===r.manifest.featureIndex.w1.ownerChunk),d=chunk.lods.find(d=>d.id==='medium'),g=await decodeChunk(r.assets[d.uri],d);
  const m=g.children.find(m=>m.userData.city.recipeId==='instanced');assert.deepEqual(m.userData.city.instanceFeatureIds,['w1','w1']);assert.equal(m.count,2);
});

test('independent review: partitioning reorders custom per-instance shader attributes with matrix/color/identity',async()=>{
  const geometry=new THREE.BoxGeometry(1,1,1);geometry.setAttribute('aVariant',new THREE.InstancedBufferAttribute(new Float32Array([11,22]),1));
  const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),2);mesh.userData.city={instanceFeatureIds:['a','b']};mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-10,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(10,0,0));mesh.updateMatrixWorld();
  const pieces=partitionMesh(mesh,{at:x=>x<0?'left':'right'},()=>undefined,[]);
  for(const [id,m]of pieces){assert.equal(m.geometry.attributes.aVariant.getX(0),id==='left'?11:22);assert.deepEqual(m.userData.city.instanceFeatureIds,[id==='left'?'a':'b']);const g=new THREE.Group();g.add(m);const decoded=await decodeChunk(encodeChunk(g));assert.equal(decoded.children[0].geometry.attributes.aVariant.getX(0),id==='left'?11:22);}
});

test('independent review: null chunk metadata returns a structured corruption error',async()=>{
  const header=new TextEncoder().encode('null'),payload=new Uint8Array(16),view=new DataView(payload.buffer);payload.set([67,73,78,75]);view.setUint32(4,1,true);view.setUint32(8,header.length,true);payload.set(header,12);
  await assert.rejects(decodeChunk(payload),{code:'INVALID_CHUNK'});
});

test('compiled multi-role buildings preserve roof/wall roles through the typed attribute table',async()=>{
  const r=await compiled(),d=r.manifest.chunks[0].lods.find(d=>d.id==='medium'),group=await decodeChunk(r.assets[d.uri],d),mesh=group.children.find(m=>m.userData.city.featureId==='w1');
  const table=mesh.userData.city.materialRoleTable,roles=new Set(mesh.geometry.attributes.cityMaterialRole.array);assert.ok(roles.has(table.indexOf('roof')));assert.ok(roles.has(table.indexOf('wall'))||roles.has(table.indexOf('glass')));
});

test('independent review: shared primitive geometries cannot overwrite road/structure material roles',async()=>{
  const r=await compiled(),d=r.manifest.chunks[0].lods.find(d=>d.id==='high'),group=await decodeChunk(r.assets[d.uri],d);
  const zebra=group.children.find(m=>m.name==='Inferred zebra crossings');assert.ok(zebra);const table=zebra.userData.city.materialRoleTable;
  assert.deepEqual([...new Set(zebra.geometry.attributes.cityMaterialRole.array)],[table.indexOf('road')]);
  const greens=Object.values(r.manifest.featureIndex).filter(f=>f.provenance.source==='inferred-green');assert.ok(greens.length>0);assert.ok(greens.every(f=>f.sourceIds.includes('way/51')));
});

test('independent review: partition and budget statistics respect draw ranges and material group intersections',()=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1,10,0,0,11,0,0,10,0,1],3));geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute([1,1,1,1,1,1],1));geometry.setDrawRange(0,3);
  const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.userData.city={featureIds:['a']};mesh.updateMatrixWorld();
  const parts=partitionMesh(mesh,{at:()=> 'one'},()=>undefined,[null,'a']);assert.equal(parts[0][1].geometry.attributes.position.count,3);
  geometry.setDrawRange(0,Infinity);geometry.addGroup(0,3,0);mesh.material=[material];const g=new THREE.Group();g.add(mesh);assert.equal(sceneStats(g).triangles,1);assert.equal(sceneStats(g).drawCalls,1);
  assert.equal(partitionMesh(mesh,{at:()=> 'one'},()=>undefined,[null,'a'])[0][1].geometry.attributes.position.count,3);
});

test('independent review: invisible parent groups stay absent after flattening and roundtrip',async()=>{
  const root=new THREE.Group(),hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));root.add(hidden);
  assert.equal(sceneStats(root).triangles,0);assert.equal((await decodeChunk(encodeChunk(root))).children.length,0);
});

test('independent review: validators reject malformed semantics, false origins and null OSM elements',async()=>{
  const r=await compiled(),{raw,config}=continuityFixture();
  for(const origin of [null,0,''])assert.equal(validateProjectConfig({...config,origin}).valid,false);
  for(const change of [m=>m.generator={id:42,version:{}},m=>m.attribution={text:42},m=>delete m.featureIndex.w1.kind,m=>delete m.featureIndex.w1.provenance,m=>m.featureIndex.w1.sourceIds=[null],m=>m.featureIndex.w1.ownerChunk='missing',m=>m.featureIndex.w1.bounds=[1,1,1,0,0,0]]){const m=structuredClone(r.manifest);change(m);assert.equal(validateSceneManifest(m).valid,false);}
  await assert.rejects(compileScene({...raw,elements:[null]},config),{code:'INVALID_SOURCE_ELEMENT'});
});

test('independent review: successful replacement also removes legacy rooftop attachments of claimed features',async()=>{
  const {raw,config}=continuityFixture();const r=await compileScene(raw,config,{landmarkRegistry:{match:()=>[{recipeId:'moved',recipeVersion:'1',claimedFeatureIds:['w1']}],generate:()=>{
    const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshStandardMaterial());mesh.position.set(200,5,200);group.add(mesh);return {group,claimedFeatureIds:['w1']};
  }}});
  const d=r.manifest.chunks[0].lods.find(d=>d.id==='high'),group=await decodeChunk(r.assets[d.uri],d),equipment=group.children.find(m=>m.name==='Procedural roof equipment groups');
  assert.ok(!equipment||!Array.from(equipment.geometry.attributes.cityFeature.array).includes(r.manifest.featureIndex.w1.renderId));
});

test('independent review: malformed matches and non-finite generated geometry diagnose fallback',async()=>{
  const {raw,config}=continuityFixture();
  const badMatches=await compileScene(raw,config,{landmarkRegistry:{match:()=>[null]}});assert.ok(badMatches.report.diagnostics.some(d=>d.code==='INVALID_LANDMARK_CLAIM'));
  const badGeometry=await compileScene(raw,config,{landmarkRegistry:{match:()=>[{recipeId:'nan',recipeVersion:'1',claimedFeatureIds:['w1']}],generate:()=>{const group=new THREE.Group(),g=new THREE.BoxGeometry();g.attributes.position.setX(0,NaN);group.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial()));return {group,claimedFeatureIds:['w1']};}}});
  assert.ok(badGeometry.report.diagnostics.some(d=>d.code==='LANDMARK_GENERATION_FAILED'));assert.equal(badGeometry.manifest.featureIndex.w1.provenance.recipeId,undefined);
  await assert.rejects(compileScene({elements:[{type:'node',id:1,lat:NaN,lon:1}]},config),{code:'INVALID_SOURCE_COORDINATES'});
});

test('independent review: multipart generators retain each authored primary feature ID through merged and full levels',async()=>{
  const {raw,config}=continuityFixture(),r=await compileScene(raw,config,{landmarkRegistry:{match:()=>[{recipeId:'multipart',recipeVersion:'1',claimedFeatureIds:['w1','w2']}],generate:()=>{
    const group=new THREE.Group();for(const [i,id]of ['w1','w2'].entries()){const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,20,10),new THREE.MeshStandardMaterial());mesh.position.set(i*100,10,100);mesh.name=id;mesh.userData.city={featureId:id};group.add(mesh);}return {group,claimedFeatureIds:['w1','w2']};
  }}});
  for(const id of ['low','high']){const d=r.manifest.chunks[0].lods.find(d=>d.id===id),g=await decodeChunk(r.assets[d.uri],d),renderIds=new Set();g.traverse(m=>{if(m.isMesh&&m.userData.city.kind==='building')for(const v of m.geometry.attributes.cityFeature.array)renderIds.add(v);});for(const f of ['w1','w2'])assert.ok(renderIds.has(r.manifest.featureIndex[f].renderId));if(id==='high')for(const f of ['w1','w2'])assert.equal(g.children.find(m=>m.name===f).userData.city.featureId,f);}
});
