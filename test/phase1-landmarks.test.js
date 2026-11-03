import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {parseOSM} from '../src/osm.js';
import {buildCity} from '../src/city.js';
import {landmarkKind,buildingStyle} from '../src/building-rules.js';
import {createLandmarkRegistry,checkLandmarkPackage,validateLandmarkRecipe} from '../src/landmark-registry.js';
import pack from '../packages/landmarks/index.js';
import {cctvRing} from '../src/landmarks.js';
import {satisfies} from '../src/generators/compatibility.js';
const raw=JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url)));
const all=parseOSM(raw),features=all.buildings.filter(landmarkKind);
const data={...all,buildings:features,roads:[],greens:[],water:[],trees:[],streetNodes:[],treeRows:[],landscapes:[],landscapeContexts:[]};
const context={origin:raw.metadata.center,bounds:all.bounds,seed:1,project:all.project,features};
const digest=result=>{const h=createHash('sha256');result.group.traverse(o=>{if(o.isMesh)h.update(Buffer.from(o.geometry.attributes.position.array.buffer));});return h.digest('hex');};

test('exact OSM type/id plus location; names cannot replace unrelated buildings',()=>{
  const registry=createLandmarkRegistry();
  const matches=registry.match(features,context);
  assert.equal(matches.length,2);
  assert.equal(matches.find(m=>m.recipeId==='cctv-headquarters').claimedFeatureIds.length,4);
  assert.deepEqual(matches,registry.match([...features].reverse(),context));
  assert.equal(landmarkKind({osmId:4,tags:{name:'中国尊 CITIC Tower China Zun'}}),null);
  assert.deepEqual(registry.match(features.map(f=>({...f,osmType:'relation'})),context),[]);
  assert.deepEqual(registry.match(features,{...context,project:{inverse:()=>[0,0]}}),[]);
  assert.equal(registry.diagnostics[0].code,'LANDMARK_LOCATION_MISMATCH');
  assert.deepEqual(registry.match(features,{origin:{lat:0,lon:0},bounds:all.bounds}),[]);
});

test('independent groups retain source heights, geometry role batches and serialized match generation',()=>{
  const registry=createLandmarkRegistry();const matches=registry.match(features,context);
  const original=JSON.stringify(features);
  for(const match of matches){
    const a=registry.generate(match,context),b=registry.generate(JSON.parse(JSON.stringify(match)),context);
    assert(a.group.isGroup);assert.notEqual(a.group,b.group);assert.equal(digest(a),digest(b));
    assert.deepEqual(a.claimedFeatureIds,match.claimedFeatureIds);
    assert.equal(a.provenance.recipeVersion,'1.0.0');
    for(const mesh of a.group.children){
      const source=features.find(f=>f.id===mesh.userData.city.featureId);
      assert.equal(mesh.userData.city.height,source.height);assert.equal(mesh.userData.city.heightSource,source.source);
      assert(mesh.geometry.groups.length<=3);assert(mesh.geometry.userData.city.materialRoles.includes('glass'));
      for(const name of ['aFacade','aStyle','aLayout','aSurface','objectId'])assert(mesh.geometry.attributes[name]);
      assert(Math.abs(mesh.geometry.attributes.aStyle.getY(0)-buildingStyle(source,1).variant)<1e-6,'preserve original seeded glass variant');
    }
  }
  assert.equal(JSON.stringify(features),original);
});

test('disabled, missing-part, incompatible and failing recipes fall back without claiming generic buildings',()=>{
  assert.equal(buildCity(data).landmarkGroups.length,2);
  const disabled=buildCity(data,{landmarks:{enabled:false}});
  assert.equal(disabled.landmarks.length,0);assert.equal(disabled.buildings.length,5);
  const partial={...data,buildings:features.filter(f=>f.osmId!==547523487)};
  const city=buildCity(partial);
  assert.equal(city.landmarkGroups.length,1);assert.equal(city.buildings.length,4);
  assert(city.landmarkDiagnostics.some(d=>d.code==='LANDMARK_MISSING_PARTS'));
  for(const setup of [
    {recipes:pack.recipes.map(r=>({...r,engineCompatibility:'>=2.0.0 <3.0.0'}))},
    {recipes:pack.recipes.map(r=>({...r,generator:'missing'}))},
    {generators:{'city-ink/china-zun':()=>{throw new Error('fixture failure');},'city-ink/cctv':()=>{throw new Error('fixture failure');}}},
  ]){
    const result=buildCity(data,{registry:createLandmarkRegistry(setup)});
    assert.equal(result.landmarkGroups.length,0);assert.equal(result.buildings.length,5);assert(result.landmarkDiagnostics.length>=2);
  }
  const registry=createLandmarkRegistry({generators:{'city-ink/china-zun':()=>{throw new Error('strict fixture');}}});
  const match=registry.match(features,context).find(m=>m.recipeId==='china-zun');
  assert.throws(()=>registry.generate(match,{...context,policy:'strict'}),/strict fixture/);
});

test('local package upgrade locks explicit versions, changes geometry and restores exactly on rollback',()=>{
  const v2=structuredClone(pack);v2.version='1.1.0';v2.recipes=v2.recipes.map(r=>({...r,version:'1.1.0',parameters:{...r.parameters,...(r.id==='china-zun'?{ribWidth:.8}:{beamWidth:1.2})}}));
  const oldLock=checkLandmarkPackage(pack),newLock=checkLandmarkPackage(v2);
  assert(oldLock.valid);assert(newLock.valid);assert.notDeepEqual(oldLock.lock,newLock.lock);
  const generate=p=>{const registry=createLandmarkRegistry({recipes:p.recipes});return registry.match(features,context).map(m=>digest(registry.generate(m,context)));};
  const old=generate(pack);assert.notDeepEqual(generate(v2),old);assert.deepEqual(generate(pack),old);
  assert(!checkLandmarkPackage({...v2,engineCompatibility:'>=2.0.0 <3.0.0'}).valid);
  assert(!validateLandmarkRecipe({...pack.recipes[0],anchor:{kind:'arbitrary'}}).valid);
  assert(!checkLandmarkPackage({...pack,recipes:[pack.recipes[0],pack.recipes[0]]}).valid);
});

test('explicit overrides win, duplicate claims diagnose, failed external generation leaves source intact',()=>{
  const copy={...pack.recipes[0],id:'override',priority:10};
  const registry=createLandmarkRegistry({recipes:[...pack.recipes,copy]});
  const matches=registry.match(features,context);
  assert(matches.some(m=>m.recipeId==='override'));assert(registry.diagnostics.some(d=>d.code==='LANDMARK_CLAIM_CONFLICT'));
  assert.equal(createLandmarkRegistry({overrides:{'china-zun':false}}).match(features,context).length,1);
  const custom=createLandmarkRegistry({recipes:[{...pack.recipes[1],generator:'external'}],generators:{external:(match)=>{
    const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
    mesh.userData.city={schemaVersion:1,featureId:'whole-cctv',materialRole:'structure'};group.add(mesh);
    return {group,claimedFeatureIds:match.claimedFeatureIds,provenance:{kind:'fixture'},diagnostics:[]};
  }}});
  const result=buildCity(data,{registry:custom});
  assert.equal(result.landmarkGroups.length,1);assert.equal(result.buildings.length,2,'one China Zun generic plus one external group mesh');
  const invalid=createLandmarkRegistry({recipes:[{...pack.recipes[0],parameters:{steps:0}}]});
  const fallback=buildCity(data,{registry:invalid});assert.equal(fallback.buildings.length,5);assert.equal(fallback.landmarkGroups.length,0);
});

test('external generator may use an uncoloured mesh with the claimed feature ID',()=>{
  const registry=createLandmarkRegistry({recipes:[{...pack.recipes[0],generator:'uncoloured'}],generators:{uncoloured:match=>{
    const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(10,100,10),new THREE.MeshStandardMaterial({color:'red'}));
    mesh.userData.city={schemaVersion:1,featureId:match.claimedFeatureIds[0],materialRole:'structure'};group.add(mesh);
    return {group,claimedFeatureIds:match.claimedFeatureIds,provenance:{kind:'fixture'},diagnostics:[]};
  }}});
  const city=buildCity(data,{registry});assert.equal(city.buildings.length,5);assert.equal(city.landmarkGroups.length,1);
  city.setProvenance(true);city.setProvenance(false);
});

test('editable CCTV lean shifts also update the connecting cantilever',()=>{
  const connector=features.find(f=>f.osmId===547523487);
  assert.deepEqual(cctvRing(connector,234,{'548126516':[0,0],'548126517':[0,0]}),connector.outer);
  const moved=cctvRing(connector,234,{'548126516':[7,9],'548126517':[7,9]});
  assert.deepEqual(moved,connector.outer.map(p=>[p[0]+7,p[1]+9]));
});

test('compatibility parses every branch and runtime validation agrees with metadata field shapes',()=>{
  for(const range of ['>=1.0.0 || latest','<0.1.0 latest','>=1.0.0 ||','>=1.0.0 <2.0.0 nonsense'])assert.throws(()=>satisfies('1.0.0',range),/Unsupported/);
  assert(!checkLandmarkPackage({...pack,engineCompatibility:'>=1.0.0 || latest'}).valid);
  assert(!validateLandmarkRecipe({...pack.recipes[0],parameters:42,source:'wrong',provenance:'wrong',materialRoles:[1]}).valid);
  for(const change of [{parameters:[]},{source:[]},{provenance:null},{materialRoles:['glass',4]}])assert(!validateLandmarkRecipe({...pack.recipes[0],...change}).valid);
});
