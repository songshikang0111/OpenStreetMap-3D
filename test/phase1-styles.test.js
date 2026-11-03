import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {parseOSM} from '../src/osm.js';
import {buildCity} from '../src/city.js';
import {landmarkKind} from '../src/building-rules.js';
import {getStyle,registerStyle,bindSceneStyle,createStylePipeline,createStyleShared,createFoliageMaterial} from '../src/styles/index.js';
import cel from '../packages/styles/cel.js';
import {InkRenderer} from '../src/ink-renderer.js';
const all=parseOSM(JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url))));
const data={...all,buildings:all.buildings.filter(landmarkKind),roads:all.roads.slice(0,2),water:[{id:'fixture-water',outer:[[0,0],[20,0],[20,20],[0,20]],holes:[]}],trees:[{id:1,point:[70,60],height:8,tags:{}}],greens:[],landscapes:[],landscapeContexts:[]};
function make(){return buildCity(data);}

test('official styles bind and dispose; decoded procedural panes/glass use the original uniforms and attributes',()=>{
  const city=make(),serialized=JSON.parse(JSON.stringify(city.group.toJSON()));
  const decoded=new THREE.ObjectLoader().parse(serialized),shared=createStyleShared();
  for(const id of ['comic','line','color','white']){
    const binding=bindSceneStyle(decoded,{style:{id},shared});
    assert.equal(binding.style.id,id);
    const mesh=decoded.getObjectByProperty('name',city.buildings[0].name);
    if(id!=='white'){
      const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.uGlassReflection,shared.glassReflection);assert.equal(shader.uniforms.uWindows,shared.windows);
      assert(shader.fragmentShader.includes('vFacade'));assert(mesh.geometry.attributes.aStyle);
      const leaves=decoded.getObjectByName('Distant tree crowns'),leafShader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      assert.equal(leaves.userData.city.shader,'foliage-v1');leaves.material.onBeforeCompile(leafShader);
      assert(leafShader.fragmentShader.includes('leafTexture(vLeafWorld'),'restore serialized foliage shader');
    }
    binding.dispose();binding.dispose();
  }
  assert.throws(()=>bindSceneStyle(decoded,{style:'unknown'}),/Unknown style/);
  assert.throws(()=>bindSceneStyle(decoded,{style:{id:'comic',parameters:{lineWidth:99}}}),/Invalid style parameter/);
});

test('independent external module covers road, water, tree, landmark and all ordinary semantic roles',()=>{
  registerStyle(cel);const city=make(),roles=new Set();
  city.group.traverse(o=>{if(o.isMesh)roles.add(o.userData.city.materialRole);});
  for(const role of ['road','water','foliage','glass'])assert(roles.has(role),role);
  const binding=bindSceneStyle(city.group,{style:{id:cel.id,parameters:{waterOpacity:.6}}});
  const created=new Set();city.group.traverse(o=>{if(o.isMesh)for(const material of Array.isArray(o.material)?o.material:[o.material]){assert(material.isMeshToonMaterial);created.add(material);}});
  let released=0,textures=0;
  for(const material of created){material.addEventListener('dispose',()=>released++);material.gradientMap.addEventListener('dispose',()=>textures++);}
  const scene=new THREE.Scene(),renderer={render(s,c){assert.equal(s,scene);assert(c.isCamera);}};
  const pipeline=createStylePipeline({renderer,scene,camera:new THREE.PerspectiveCamera(),style:cel});
  assert(scene.fog);pipeline.resize(640,480);pipeline.render();pipeline.dispose();assert.equal(scene.fog,null);
  binding.dispose();binding.dispose();assert.equal(released,created.size);assert.equal(textures,created.size);
});

test('style changes restore original materials and invalid protocols fail clearly',()=>{
  const city=make(),mesh=city.buildings[0],original=mesh.material;
  const first=bindSceneStyle(city.group,{style:'comic'});let disposed=0;
  (Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>m.addEventListener('dispose',()=>disposed++));
  const second=bindSceneStyle(city.group,{style:'color'});assert(disposed>0);first.dispose();
  assert.notEqual(mesh.material,original);second.dispose();assert.equal(mesh.material,original);
  mesh.userData.city.shader='unknown-v2';assert.throws(()=>bindSceneStyle(city.group),/Unsupported procedural shader/);
  mesh.userData.city.shader='facade-v6';mesh.geometry.deleteAttribute('aLayout');assert.throws(()=>bindSceneStyle(city.group),/Missing procedural attribute/);
  assert.throws(()=>registerStyle({...getStyle(),engineCompatibility:'>=2.0.0 <3.0.0'}),/incompatible/);
  assert.throws(()=>registerStyle({...getStyle(),createPipeline:null}),/requires/);
});

test('repeated ink pipelines isolate shared geometry classifications and release owned clones',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
  for(const kind of [2,4,1]){const mesh=new THREE.Mesh(geometry,material);mesh.userData.inkClass=kind;scene.add(mesh);}
  for(let n=0;n<6;n++){
    const ink=new InkRenderer({},scene,new THREE.PerspectiveCamera());
    const owned=[...ink._classificationClones.values()].map(c=>c.clone);
    assert.equal(owned.length,2);assert.equal(geometry.userData.inkClass,2);
    assert.deepEqual(scene.children.map(o=>o.geometry.attributes.inkClass.getX(0)),[2,4,1]);
    let released=0;owned.forEach(g=>g.addEventListener('dispose',()=>released++));ink.dispose();ink.dispose();
    assert.equal(released,2);assert(scene.children.every(o=>o.geometry===geometry));
  }
});

test('official clones retain borrowed source textures without taking ownership',()=>{
  const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),material=new THREE.MeshStandardMaterial({map:texture});
  material.userData.cityOwnedTextures=['map'];
  const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
  mesh.userData.city={schemaVersion:1,featureId:'fixture',materialRole:'ground'};group.add(mesh);
  let released=0;texture.addEventListener('dispose',()=>released++);
  const binding=bindSceneStyle(group);assert.equal(mesh.material.map,texture);binding.dispose();
  assert.equal(released,0);assert.equal(mesh.material,material);
});

test('damaged role tables/groups cannot silently omit geometry',()=>{
  const geometry=new THREE.BoxGeometry(1,1,1),group=new THREE.Group(),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
  mesh.userData.city={schemaVersion:1,featureId:'fixture',materialRole:'wall'};group.add(mesh);
  geometry.userData.city={schemaVersion:1,materialRoles:['wall']};
  assert.throws(()=>bindSceneStyle(group),/Invalid material role group/);
  geometry.userData.city.materialRoles=Array(6).fill('wall');
  const binding=bindSceneStyle(group);assert.equal(mesh.material.length,6);binding.dispose();
  geometry.groups[0].count=5;assert.throws(()=>bindSceneStyle(group),/Invalid material role group/);
});

test('reused ink renderer releases classification clones when a city is removed',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
  const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry,material);a.userData.inkClass=2;b.userData.inkClass=4;scene.add(a,b);
  const ink=new InkRenderer({},scene,new THREE.PerspectiveCamera());const clone=b.geometry;let freed=0;clone.addEventListener('dispose',()=>freed++);
  scene.remove(b);ink.prepareScene();assert.equal(freed,1);assert.equal(b.geometry,geometry);assert.equal(ink._classificationClones.size,0);
  ink.dispose();assert.equal(freed,1);
});

test('classification follows replacement geometry and never restores an obsolete source',()=>{
  const scene=new THREE.Scene(),source=new THREE.BoxGeometry(1,1,1),mesh=new THREE.Mesh(source,new THREE.MeshStandardMaterial());mesh.userData.inkClass=2;scene.add(mesh);
  const ink=new InkRenderer({},scene,new THREE.PerspectiveCamera());
  const replacement=new THREE.BoxGeometry(2,2,2);mesh.geometry=replacement;ink.prepareScene();assert.equal(replacement.attributes.inkClass.getX(0),2);
  mesh.userData.inkClass=4;ink.prepareScene();const firstClone=mesh.geometry;assert.notEqual(firstClone,replacement);
  let freed=0;firstClone.addEventListener('dispose',()=>freed++);
  const finalSource=new THREE.BoxGeometry(3,3,3);finalSource.userData.inkClass=1;
  mesh.geometry=finalSource;mesh.userData.inkClass=3;ink.prepareScene();assert.equal(freed,1);assert.notEqual(mesh.geometry,finalSource);
  ink.dispose();assert.equal(mesh.geometry,finalSource);assert.notEqual(mesh.geometry,replacement);
});

test('foliage material service supports a generic material source safely',()=>{
  for(const source of [new THREE.MeshBasicMaterial({color:'green'}),new THREE.ShaderMaterial(),new THREE.Material()]){
    const material=createFoliageMaterial(source);assert(Number.isFinite(material.roughness));assert(Number.isFinite(material.metalness));assert(material.color.isColor);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);assert(shader.fragmentShader.includes('leafTexture(vLeafWorld'));material.dispose();
  }
});

test('ordinary building batches preserve wall, glass, roof and structure roles for external styles',()=>{
  const feature=(id,x,tags)=>({id,osmType:'way',osmId:id==='plain-office'?1:2,tags,outer:[[x,0],[x+30,0],[x+30,20],[x,20]],holes:[],height:60,minHeight:0,levels:15,area:600,center:[x+15,10],source:'height'});
  const buildings=[feature('plain-office',0,{building:'office'}),feature('plain-brick',60,{building:'apartments','building:material':'brick'})];
  const city=buildCity({...data,buildings,roads:[],water:[],trees:[],streetNodes:[],treeRows:[]}),seen=new Set();
  const external={...cel,id:'role-audit',createMaterial({role}){seen.add(role);return new THREE.MeshBasicMaterial({color:{wall:'white',glass:'blue',roof:'red',structure:'green'}[role]||'gray'});}};
  const decoded=new THREE.ObjectLoader().parse(JSON.parse(JSON.stringify(city.group.toJSON())));
  const binding=bindSceneStyle(decoded,{style:external});
  for(const role of ['wall','glass','roof','structure'])assert(seen.has(role),`Missing ordinary ${role}`);
  assert(city.buildings.every(mesh=>mesh.geometry.groups.length<=4));binding.dispose();
});
