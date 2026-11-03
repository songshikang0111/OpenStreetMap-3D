import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {applyView} from '../src/runtime/camera.js';

test('saved upward street views survive real OrbitControls updates and previous damping',()=>{
  const camera=new PerspectiveCamera(45,16/9,.25,30000),controls=new OrbitControls(camera,null);
  controls.maxPolarAngle=Math.PI;controls.enableDamping=true;
  const views=[{position:[48.08398,2.1,329.36284],target:[46.58398,4,244.36284],fov:55},{position:[8,12,20],target:[0,18,0],fov:45}];
  for(const view of views){
    controls.autoRotate=true;controls.update(.1);controls.autoRotate=false;
    applyView(camera,controls,view);
    for(let i=0;i<30;i++)controls.update();
    for(let i=0;i<3;i++){assert.ok(Math.abs(camera.position.getComponent(i)-view.position[i])<1e-8);assert.ok(Math.abs(controls.target.getComponent(i)-view.target[i])<1e-8);}
    assert.equal(camera.fov,view.fov);assert.equal(controls.enableDamping,true);
  }
  const before=camera.position.toArray();
  assert.throws(()=>applyView(camera,controls,{position:[99,99,99],near:NaN}),TypeError);assert.deepEqual(camera.position.toArray(),before);
  // No DOM was connected, so there are no event listeners to disconnect.
});
