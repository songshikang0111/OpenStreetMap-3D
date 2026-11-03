import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {parseOSM} from '../src/osm.js';
import {buildCity} from '../src/city.js';
import {landmarkKind} from '../src/building-rules.js';
import {getStyle,registerStyle,bindSceneStyle,createStylePipeline,createStyleShared} from '../src/styles/index.js';
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
