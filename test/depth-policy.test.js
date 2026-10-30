import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3,Group,Mesh,BoxGeometry} from 'three';
import {stableNearPlane,collectDepthBounds} from '../src/depth-policy.js';
test('near plane improves distant precision but never clips a nearby tall roof',()=>{
  const ground=new Box3(new Vector3(-1000,-14,-1000),new Vector3(1000,0,1000));
  const roof=new Box3(new Vector3(-30,0,-30),new Vector3(30,528,30));
  assert.equal(stableNearPlane(new Vector3(0,1500,0),[ground,roof]),194.4);
  assert.equal(stableNearPlane(new Vector3(0,530,0),[ground,roof]),.4);
  assert.equal(stableNearPlane(new Vector3(0,2,0),[ground]),.4);
  assert.equal(stableNearPlane(new Vector3(0,10,0),[ground,roof]),.2);
});
test('merged rooftop equipment bounds cannot masquerade as geometry in empty air',()=>{
  const group=new Group(),building=new Mesh(new BoxGeometry(20,200,20)),equipment=new Mesh(new BoxGeometry(1500,300,1500));
  building.position.set(300,100,0);equipment.userData.depthBoundsCoveredByBuildings=true;group.add(building,equipment);
  const bounds=collectDepthBounds(group);assert.equal(bounds.length,1);
  assert(stableNearPlane(new Vector3(0,100,0),bounds)>50);
});
