import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseOSM,inside} from '../src/osm.js';
import {planRoadSurface,buildRoadSurface} from '../src/road-surface.js';
import {planRoadStructures,buildRoadStructures,segmentDistance} from '../src/road-structures.js';

const road=(id,a,b,width=10,extra={})=>({id,type:'primary',width,bridge:false,layer:0,tags:{},segments:[[a,b]],...extra});
const data=roads=>({roads,bounds:[-160,-160,160,160],buildings:[],water:[],streetNodes:[]});

test('bridge decks have closed thickness, outward normals, guardrails and no mutation of road surfaces',()=>{
  const input=data([road(1,[-120,0],[120,0],10,{bridge:true,layer:1})]);
  const surface=planRoadSurface(input),snapshot=JSON.stringify(surface),built=buildRoadStructures(input,surface);
  assert.equal(JSON.stringify(surface),snapshot);
  assert.equal(built.stats.bridgeWays,1);assert(built.stats.bridgePiers>3);assert(built.stats.bridgeGuardrailSegments>20);
  const deck=built.group.children.find(m=>m.name.includes('soffits')),p=deck.geometry.attributes.position,n=deck.geometry.attributes.normal;
  assert(deck.geometry.boundingBox.min.y<6.4&&deck.geometry.boundingBox.max.y<7);
  let top=0,bottom=0,sides=0;
  for(let i=0;i<p.count;i++){
    assert(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));
    if(n.getY(i)>.9)top++;else if(n.getY(i)<-.9)bottom++;
    else{assert(p.getX(i)*n.getX(i)+p.getZ(i)*n.getZ(i)>0,'deck sides point away from the centre');sides++;}
  }
  assert(top&&bottom&&sides);assert(deck.castShadow);
  built.dispose();
});

test('piers avoid lower traffic, pedestrian paths, buildings, water and extraction edges',()=>{
  const input=data([
    road(1,[-150,0],[150,0],12,{bridge:true,layer:2}),
    road(2,[18,-80],[18,80],14),
    road(3,[-60,-80],[-60,80],4,{type:'footway'}),
  ]);
  input.buildings=[{outer:[[42,-8],[64,-8],[64,8],[42,8]],holes:[],minHeight:0,height:30}];
  input.water=[{outer:[[80,-8],[100,-8],[100,8],[80,8]],holes:[]}];
  const plan=planRoadStructures(input,planRoadSurface(input));
  assert(plan.piers.length>0);
  assert(plan.stats.bridgeRejectedSupports['traffic-clearance']>0);
  assert(plan.stats.bridgeRejectedSupports['pedestrian-clearance']>0);
  assert(plan.stats.bridgeRejectedSupports['building-clearance']>0);
  assert(plan.stats.bridgeRejectedSupports.water>0);
  for(const p of plan.piers){
    for(const r of input.roads.filter(r=>!r.bridge))for(const [a,b]of r.segments)assert(segmentDistance(p.point,a,b)>r.width/2+p.radius+.8);
    assert(!inside(p.point,input.buildings[0].outer));assert(!inside(p.point,input.water[0].outer));
  }
});

test('height changes are disclosed rather than inventing ramps, and no bridge-only meshes appear on ground roads',()=>{
  const ground=data([road(1,[-100,0],[0,0])]),g=buildRoadSurface(ground);
  assert.equal(g.stats.bridgeStructureTriangles,0);assert.equal(g.structures.piers.length,0);g.dispose();
  const input=data([road(1,[-100,0],[0,0]),road(2,[0,0],[100,0],10,{bridge:true,layer:1})]);
  const plan=planRoadStructures(input,planRoadSurface(input));
  assert.equal(plan.stats.bridgeGradeConnectionsUnresolved,1);
  assert.equal(plan.stats.bridgeHeightSource,'inferred-layer-times-7m');
  assert.deepEqual(plan,planRoadStructures(input,planRoadSurface(input)));
});

test('Guomao supports pass independent whole-extract clearance checks and structure budgets',()=>{
  const raw=JSON.parse(readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url)));
  const input=parseOSM(raw),surface=planRoadSurface(input),built=buildRoadStructures(input,surface);
  assert.equal(built.stats.bridgeWays,82);assert.equal(built.stats.bridgeSegments,212);
  assert(built.stats.bridgePiers>50);assert(built.stats.bridgeStructureTriangles<160000);
  for(const p of built.plan.piers)for(const s of surface.segments)if(s.y<p.top-.15){
    const d=segmentDistance(p.point,s.a,s.b);assert(d>=s.width/2+p.radius+.8-1e-7,`pier near lower way ${s.road.id}`);
  }
  for(const mesh of built.group.children){
    assert.equal(mesh.userData.inkClass,4);assert(mesh.castShadow);
    for(const a of Object.values(mesh.geometry.attributes))assert([...a.array].every(Number.isFinite));
  }
  console.log('Bridge structure validation:',built.stats);built.dispose();
});
