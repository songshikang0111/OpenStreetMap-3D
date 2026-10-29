import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InkRenderer } from '../src/ink-renderer.js';

test('shared geometry keeps separate foliage, solid-building and procedural-window classifications', () => {
  const scene=new THREE.Scene(),prototype=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
  const foliage=new THREE.Mesh(prototype,material);foliage.userData.inkClass=2;
  const facade=new THREE.Mesh(prototype,material);facade.userData.inkClass=1;facade.userData.generatedFacade=true;
  const crown=new THREE.Mesh(prototype,material);crown.userData.inkClass=1;
  scene.add(foliage,facade,crown);
  const renderer=new InkRenderer({},scene,new THREE.PerspectiveCamera());
  assert.equal(foliage.geometry.attributes.inkClass.getX(0),2);
  assert.equal(facade.geometry.attributes.inkClass.getX(0),1.25);
  assert.equal(crown.geometry.attributes.inkClass.getX(0),1);
  assert.notEqual(foliage.geometry,facade.geometry);
  renderer.prepareScene();
  assert.equal(foliage.geometry.attributes.inkClass.getX(0),2);
  renderer.dispose();
});

test('AO resolution follows odd export sizes and renderer restores scene state on failure', () => {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.8,7000);
  const background=new THREE.Color('#ffffff'),override=new THREE.MeshBasicMaterial();
  scene.background=background;scene.overrideMaterial=override;
  const fake={
    shadowMap:{autoUpdate:true},clearColor:new THREE.Color('#abcdef'),alpha:.7,target:'prior',
    getClearColor(out){return out.copy(this.clearColor);},getClearAlpha(){return this.alpha;},
    setClearColor(c,a){this.clearColor.set(c);this.alpha=a;},setRenderTarget(target){this.target=target;},clear(){},
    render(){throw new Error('GPU unavailable');},
  };
  const renderer=new InkRenderer(fake,scene,camera);renderer.resize(2401,1295);
  assert.equal(renderer.color.width,2401);assert.equal(renderer.ao.width,1201);assert.equal(renderer.ao.height,648);
  assert.equal(renderer.light.width,2401);assert.equal(renderer.light.height,1295);
  assert.throws(()=>renderer.render(),/GPU unavailable/);
  assert.equal(scene.background,background);assert.equal(scene.overrideMaterial,override);
  assert.equal(fake.shadowMap.autoUpdate,true);assert.equal(fake.alpha,.7);
  assert.equal(fake.clearColor.getHexString(),'abcdef');assert.equal(fake.target,null);
  renderer.dispose();
});

test('comic pass isolates light, reuses shadows, and tracks a changed camera near plane', () => {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.4,7000),passes=[];
  const fake={shadowMap:{autoUpdate:true},getClearColor:c=>c.set('#fff'),getClearAlpha:()=>1,setClearColor(){},setRenderTarget(t){this.target=t;},clear(){},render(s){passes.push({target:this.target,material:s.overrideMaterial,shadows:this.shadowMap.autoUpdate});}};
  const ink=new InkRenderer(fake,scene,camera);ink.resize(800,450);
  camera.near=12;camera.updateProjectionMatrix();ink.render();
  const lightPass=passes.find(p=>p.target===ink.light);
  assert.equal(lightPass.material,ink.lightMaterial);assert.equal(lightPass.shadows,false);
  assert.equal(ink.aoMaterial.uniforms.nearPlane.value,12);
  assert.equal(ink.material.uniforms.nearPlane.value,12);
  passes.length=0;ink.material.uniforms.mode.value=2;ink.render();
  assert(!passes.some(p=>p.target===ink.light),'color view skips unnecessary illumination draw');
  const shader={fragmentShader:'#include <color_fragment>'};ink.lightMaterial.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader,'','instance tint cannot contaminate the neutral pass');
  const clayShader={fragmentShader:'#include <color_fragment>'};ink.clayMaterial.onBeforeCompile(clayShader);
  assert.equal(clayShader.fragmentShader,'','white model must also ignore per-instance green tint');
  ink.dispose();
});
