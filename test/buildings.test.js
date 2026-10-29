import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOSM,inside } from '../src/osm.js';
import { buildingStyle,landmarkKind,roofEquipment,chinaZunScale } from '../src/building-rules.js';
import { cctvOffset } from '../src/landmarks.js';
import { buildCity } from '../src/city.js';

const raw=JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url),'utf8'));
const data=parseOSM(raw);
test('facade families respond to semantics and remain deterministic',()=>{
  const b={id:'sample',tags:{building:'apartments'},height:45,minHeight:0,area:700,levels:15};
  assert.equal(buildingStyle(b).family,'residential');
  assert.deepEqual(buildingStyle(b),buildingStyle({...b}));
  assert.equal(buildingStyle({...b,tags:{building:'office'},height:150}).family,'curtain');
  assert.equal(buildingStyle({...b,tags:{building:'retail'},height:18}).family,'ribbon');
  assert.equal(buildingStyle({...b,tags:{building:'house'},height:7}).family,'lowrise');
});
test('roof equipment uses footprint and courtyard clearance instead of bounding-box filling',()=>{
  for(const b of data.buildings)for(const e of roofEquipment(b))for(const x of [e.x-e.w/2-1,e.x+e.w/2+1])for(const z of [e.z-e.d/2-1,e.z+e.d/2+1]){
    assert(inside([x,z],b.outer));assert(!b.holes.some(h=>inside([x,z],h)));
  }
  const z=data.buildings.find(b=>landmarkKind(b)==='china-zun');assert.deepEqual(roofEquipment(z),[]);
});
test('landmark rules select exact landmarks and preserve separate CCTV height records',()=>{
  assert.equal(data.buildings.filter(b=>landmarkKind(b)==='china-zun').length,1);
  assert.equal(data.buildings.filter(b=>landmarkKind(b)==='cctv').length,4);
  assert.equal(landmarkKind({osmId:1,tags:{name:'中央电视台服务楼'}}),null);
  assert(chinaZunScale(.55)<chinaZunScale(0)*.75);assert(chinaZunScale(1)>chinaZunScale(.55)*1.3);
  const tower=data.buildings.find(b=>b.osmId===548126516);
  assert.deepEqual(cctvOffset(tower,0),[0,0]);assert.deepEqual(cctvOffset(tower,tower.height),[13,23]);
  assert.equal(data.buildings.find(b=>b.osmId===547523487).minHeight,161);
});
test('landmark mesh heights are finite, outward-facing and retain queryable OSM identity',()=>{
  const subset={...data,buildings:data.buildings.filter(b=>landmarkKind(b)),roads:[],greens:[],water:[],trees:[],streetNodes:[],treeRows:[]};
  const city=buildCity(subset);assert.equal(city.buildings.length,5);assert.equal(city.landmarks.length,5);
  const zun=city.buildings.find(m=>m.userData.feature.osmId===599547918),p=zun.geometry.attributes.position;
  assert(zun.userData.generatedFacade);assert.equal(zun.userData.inkClass,1);assert.equal(zun.userData.feature.height,528);
  for(const mesh of city.buildings){for(const attr of ['position','normal','aFacade','aStyle','color'])for(const n of mesh.geometry.attributes[attr].array)assert(Number.isFinite(n));}
  // Most lower facade triangles should face away from the building centre.
  const normals=zun.geometry.attributes.normal,facades=zun.geometry.attributes.aFacade,c=zun.userData.feature.center;let outward=0,total=0;
  for(let i=0;i<p.count;i+=3){if(facades.getZ(i)>0&&p.getY(i)<100&&Math.abs(normals.getY(i))<.2){const dot=(p.getX(i)-c[0])*normals.getX(i)+(p.getZ(i)-c[1])*normals.getZ(i);if(dot>0)outward++;total++;}}
  assert(total>10);assert(outward/total>.95);assert(zun.geometry.boundingBox.max.y<529);assert(zun.geometry.boundingBox.max.y>528);
  assert(city.buildings.find(m=>m.userData.feature.osmId===547523487).geometry.boundingBox.min.y>=161);
});
