import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildingStyle, FACADE_SURFACES } from '../src/building-rules.js';
import { facadeGrammar, facadeLayout, nearbyFacadeFrames } from '../src/facade-layout.js';
import { buildCity } from '../src/city.js';
import { InkRenderer } from '../src/ink-renderer.js';

const feature=(id,tags={building:'apartments'})=>({id,osmId:1,osmType:'way',tags,outer:[[0,0],[30,0],[30,24],[0,24]],holes:[],height:72,minHeight:0,levels:20,area:720,center:[15,12],source:'height'});

test('explicit facade material wins over height or office guesses; illustrative finishes remain seeded',()=>{
  for(const material of ['brick','stone','concrete','plaster','wood','metal','tiles']){
    const building={...feature('opaque',{building:'office','building:material':material}),height:180};
    const style=buildingStyle(building);
    assert.notEqual(style.family,'curtain',`${material} cannot become an all-glass tower`);
    assert(style.surface>0);
  }
  assert.equal(buildingStyle(feature('glass',{building:'apartments','building:material':'glass'})).family,'curtain');
  assert.equal(buildingStyle(feature('brick',{building:'yes','building:material':'brick'})).surfaceName,'warm-brick');
  const styles=Array.from({length:100},(_,i)=>buildingStyle(feature(`case-${i}`),1));
  assert.deepEqual(new Set(styles.map(s=>s.surfaceName)),new Set(FACADE_SURFACES));
  assert.deepEqual(styles,Array.from({length:100},(_,i)=>buildingStyle(feature(`case-${i}`),1)));
  assert.notDeepEqual(styles,Array.from({length:100},(_,i)=>buildingStyle(feature(`case-${i}`),9)));
  // Translation and unrelated buildings cannot alter a facade's chosen finish.
  const shifted={...feature('stable'),outer:[[800,90],[830,90],[830,114],[800,114]],center:[815,102]};
  assert.deepEqual(buildingStyle(feature('stable')),buildingStyle(shifted));
});

test('curtain grammars are floor-to-ceiling and ordinary walls have contrasting aperture proportions',()=>{
  const glass=Array.from({length:4},(_,i)=>facadeGrammar('curtain',(i+.5)/4));
  assert.equal(new Set(glass.map(g=>g.name)).size,4);
  for(const grammar of glass){assert(grammar.width>=.95);assert(grammar.height>=.9);}
  for(const family of ['residential','ribbon','lowrise']){
    const ordinary=Array.from({length:6},(_,i)=>facadeGrammar(family,(i+.5)/6));
    assert.equal(new Set(ordinary.map(g=>g.name)).size,6);
    assert(Math.max(...ordinary.map(g=>g.width))-Math.min(...ordinary.map(g=>g.width))>.2);
    assert(ordinary.every(g=>g.width*g.height<.75),'opaque walls retain substantial area around openings');
  }
});

test('curtain frames use fine mullions while masonry retains sills and the same allocation cap',()=>{
  const make=family=>{const style={family,variant:.3,floor:3.6};return {key:family,a:[0,0],dx:30,dz:0,len:30,normal:[0,0,-1],angle:0,layout:facadeLayout(30,40,style),baseY:.45,style};};
  const glass=nearbyFacadeFrames([make('curtain')],new THREE.Vector3(12,8,-15));
  const masonry=nearbyFacadeFrames([make('residential')],new THREE.Vector3(12,8,-15));
  assert(glass.length>0&&masonry.length>0);
  assert(glass.every(frame=>frame.d<=.12));assert(masonry.some(frame=>frame.d>=.35));
  assert(nearbyFacadeFrames([make('curtain')],new THREE.Vector3(12,8,-15),30).length<=30);
});

test('material metadata reaches real mesh attributes and neutral render defaults without extra geometry',()=>{
  const buildings=[feature('explicit-brick',{building:'office','building:material':'brick'})];
  const data={seed:1,bounds:[-20,-20,50,50],buildings,roads:[],greens:[],water:[],trees:[],streetNodes:[],treeRows:[]};
  const city=buildCity(data,{landscapeEnabled:false}),mesh=city.buildings[0],attributes=mesh.geometry.attributes;
  assert.equal(mesh.userData.facadeSurface,'warm-brick');assert.equal(city.surfaceCounts['warm-brick'],1);
  assert.equal(attributes.aSurface.count,attributes.position.count);
  for(let i=0;i<attributes.aFacade.count;i++)if(attributes.aFacade.getZ(i)>.5)assert.equal(attributes.aSurface.getX(i),3);
  const scene=new THREE.Scene();scene.add(city.group);const ink=new InkRenderer({},scene,new THREE.PerspectiveCamera(),city.shared);
  assert.deepEqual(ink.lightMaterial.defaultAttributeValues.aSurface,[0,1]);
  ink.dispose();
});
