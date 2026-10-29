import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {gradeStreetLife,buildStreetLife} from '../src/streetlife.js';

const near=(a,b,tolerance=1e-5)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const road={id:1,type:'primary',width:10,bridge:false,layer:0,tags:{},segments:[[[-100,0],[100,0]]]};
const ramp={a:[-100,0],b:[100,0],yA:.32,yB:8.32,y:4.32,length:200,direction:[1,0],width:10,walk:false,road};
const groundHeight=p=>.32+(p[0]+100)*.04;
const item=(p,extra={})=>({point:p,roadId:1,angle:Math.PI/2,...extra});
const fixture=()=>({trees:[],curbs:[item([0,5.12],{length:8})],crosswalks:[item([0,0],{width:9})],cars:[item([20,2])],people:[item([10,6])],lamps:[item([30,6])],signals:[item([40,6])],stats:{trees:0,streetTrees:0,generatedTrees:0}});

test('all furnishings sample the actual longitudinal plane and preserve input plans',()=>{
  const plan=fixture(),snapshot=JSON.stringify(plan),result=gradeStreetLife(plan,{segments:[ramp]});
  assert.equal(JSON.stringify(plan),snapshot);
  for(const name of ['curbs','crosswalks','cars','people','lamps','signals'])for(const p of result[name]){
    near(p.baseY,groundHeight(p.point)+(['people','lamps','signals'].includes(name)?.15:0));
    near(p.grade[0],.04);near(p.grade[1],0);
  }
  assert.equal(result.stats.gradeAdjustedFurnishings,6);
  assert.deepEqual(gradeStreetLife(plan,{segments:[ramp]}),result);
});

test('furnishings retain source-road association and ignore a bridge crossing overhead',()=>{
  const elevated={...ramp,road:{...road,id:2,bridge:true},yA:14,yB:14};
  const closer={...ramp,a:[-100,5],b:[100,5],road:{...road,id:3},yA:.32,yB:.32};
  const result=gradeStreetLife(fixture(),{segments:[elevated,closer,ramp]});
  near(result.curbs[0].baseY,4.32);
  near(result.lamps[0].baseY,5.67);
  assert.equal(result.curbs[0].roadId,1);
});

test('only speculative street planting on a raised approach is suppressed and counted',()=>{
  const plan=fixture();plan.stats={trees:4,streetTrees:2,generatedTrees:3};
  plan.trees=[{x:0,z:6,source:'inferred-street',key:'raised'},{x:-99,z:6,source:'inferred-street',key:'ground'},{x:0,z:6,source:'osm',key:'observed'},{x:0,z:6,source:'inferred-green',key:'park'}];
  const result=gradeStreetLife(plan,{segments:[ramp]});
  assert.deepEqual(result.trees.map(t=>t.key),['ground','observed','park']);
  assert.equal(result.stats.gradeSuppressedTrees,1);assert.equal(result.stats.generatedTrees,2);assert.equal(result.stats.streetTrees,1);assert.equal(result.stats.trees,3);
  assert.equal(plan.trees.length,4);
});

test('rendered kerbs and zebra paint follow the slope, and all four car wheels touch its plane',()=>{
  const data={bounds:[-160,-160,160,160],buildings:[],greens:[],trees:[],roads:[road],streetNodes:[{id:10,kind:'crossing',point:[45,0],tags:{}}]};
  const built=buildStreetLife(data,{roadPlan:{segments:[ramp]}}),matrix=new THREE.Matrix4();
  const curbs=built.streetGroup.getObjectByName('Raised road kerbs');
  assert(curbs.count>0);
  for(let i=0;i<curbs.count;i++){
    curbs.getMatrixAt(i,matrix);
    for(const z of [-.5,.5]){const p=new THREE.Vector3(0,0,z).applyMatrix4(matrix);near(p.y,groundHeight([p.x,p.z])+.08);}
  }
  const paint=built.streetGroup.getObjectByName('Inferred zebra crossings');assert(paint.count>0);
  for(let i=0;i<paint.count;i++){
    paint.getMatrixAt(i,matrix);
    for(const z of [-.5,.5]){const p=new THREE.Vector3(0,0,z).applyMatrix4(matrix);near(p.y,groundHeight([p.x,p.z])+.006);}
  }
  const wheels=built.streetGroup.getObjectByName('Vehicle wheels');assert(wheels.count>0);
  for(let i=0;i<wheels.count;i++){
    wheels.getMatrixAt(i,matrix);const p=new THREE.Vector3(0,-.5,0).applyMatrix4(matrix);near(p.y,groundHeight([p.x,p.z]));
  }
  built.streetGroup.traverse(mesh=>{if(mesh.isInstancedMesh)assert([...mesh.instanceMatrix.array].every(Number.isFinite));});
  built.dispose();
});
