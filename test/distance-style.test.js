import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roofDetailWeight, updateRoofDetails } from '../src/distance-style.js';
import { InkRenderer } from '../src/ink-renderer.js';
import { installFacadeShader } from '../src/facade-shader.js';

test('roof detail follows projected pixel size continuously, including zoom and resolution changes',()=>{
  assert.equal(roofDetailWeight(4,2000,1000),0);
  assert.equal(roofDetailWeight(4,100,1000),1);
  const middle=roofDetailWeight(4,600,1000);assert(middle>0&&middle<1);
  assert(roofDetailWeight(4,600,2000)>middle,'zoom/resolution restores detail');
  for(const pixels of [4,7,10])assert(Math.abs(roofDetailWeight(pixels-.0001,1000,1000)-roofDetailWeight(pixels+.0001,1000,1000))<.0001);
});

test('roof geometry collapses to its roof anchor in every render pass and restores exactly near the camera',()=>{
  const geometry=new THREE.BoxGeometry(4,2,4).toNonIndexed();geometry.translate(20,101,0);
  const original=geometry.attributes.position.array.slice(),detail={anchor:[20,100,0],size:4,start:0,end:original.length,weight:1};
  const camera=new THREE.PerspectiveCamera(42,1,.1,10000);
  camera.position.set(20,100,2500);camera.lookAt(20,100,0);
  const far=updateRoofDetails(geometry,[detail],original,camera,889);assert.equal(far.visible,0);
  for(let i=0;i<original.length;i++)assert.equal(geometry.attributes.position.array[i],detail.anchor[i%3]);
  camera.position.z=30;camera.lookAt(20,100,0);updateRoofDetails(geometry,[detail],original,camera,889);
  assert.deepEqual(geometry.attributes.position.array,original);
  assert.equal(updateRoofDetails(geometry,[detail],original,camera,889).changed,false);
  geometry.dispose();
});

test('facade reflection and neutral ink bind the actual sun and projection uniforms',()=>{
  const shared={windows:{value:1},provenance:{value:0},facadeDetail:{value:.5},glassReflection:{value:.65},sunDirection:{value:new THREE.Vector3(1,1,0).normalize()},projectionScale:{value:900}};
  for(const lightOnly of [false,true]){
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    installFacadeShader(shader,shared,lightOnly);
    assert.equal(shader.uniforms.uFacadeSunDirection,shared.sunDirection);
    assert.equal(shader.uniforms.uFacadeProjection,shared.projectionScale);
    shared.sunDirection.value.set(-1,.5,0).normalize();
    assert(shader.uniforms.uFacadeSunDirection.value.x<0,'sun controls must remain live');
  }
});

test('HiDPI uses displayed pixels and the neutral facade receives the new sun after regeneration',()=>{
  const renderer={getPixelRatio:()=>2,shadowMap:{autoUpdate:true},getClearColor:c=>c.set('#fff'),getClearAlpha:()=>1,setClearColor(){},setRenderTarget(){},clear(){},render(){}};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,7000);
  const make=x=>({windows:{value:1},provenance:{value:0},facadeDetail:{value:.5},glassReflection:{value:.65},sunDirection:{value:new THREE.Vector3(x,1,0).normalize()},projectionScale:{value:1}});
  const first=make(1),ink=new InkRenderer(renderer,scene,camera,first);ink.resize(1920,1200);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};ink.lightMaterial.onBeforeCompile(shader);
  ink.render();assert.equal(shader.uniforms.uFacadeProjection.value,300*camera.projectionMatrix.elements[5]);
  assert.equal(ink.material.uniforms.projectionScale.value,shader.uniforms.uFacadeProjection.value);
  const next=make(-1);ink.setFacadeShared(next);ink.render();assert(shader.uniforms.uFacadeSunDirection.value.x<0);
  assert.equal(shader.uniforms.uFacadeSunDirection.value,next.sunDirection.value);
  ink.dispose();
});
