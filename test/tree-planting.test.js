import test from 'node:test';
import assert from 'node:assert/strict';
import { planStreetLife, segmentDistance } from '../src/streetlife.js';
import { inside } from '../src/osm.js';
import { crownEnvelope } from '../src/foliage.js';

const rect=(x,z,w,h=w)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h]];
const base=()=>({bounds:[-800,-800,800,800],buildings:[],roads:[],trees:[],greens:[],landscapes:[],water:[],treeRows:[],streetNodes:[]});
const road=(id,z=0)=>({id,width:12,type:'primary',bridge:false,layer:0,segments:[[[-700,z],[700,z]]]});
const edgeDistance=(p,ring)=>Math.min(...ring.map((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])));

test('mature avenues have continuous close spacing with controlled height variation',()=>{
  const data=base();data.roads=[road('avenue')];
  const a=planStreetLife(data),b=planStreetLife(data);
  assert.deepEqual(a,b);assert(a.trees.length>220);
  const row=a.trees.filter(t=>t.z>0).sort((a,b)=>a.x-b.x);
  const distances=row.slice(1).map((t,i)=>Math.hypot(t.x-row[i].x,t.z-row[i].z));
  assert(distances.every(d=>d>8&&d<11.2),'tree spacing must remain an avenue rhythm, not independent random positions');
  assert(a.trees.every(t=>t.h>9&&t.h<12.6));
  assert(a.trees.filter(t=>t.shape!=='columnar').length>a.trees.length*.8);
  assert.equal(a.stats.treeBudgetLimited,false);
  const smaller=planStreetLife(data,{plantingProfile:{maxTrees:20}});assert.equal(smaller.trees.length,20);
});

test('tight global budgets preserve all planting contexts and more than one site',()=>{
  const data=base();data.roads=[road('a',-550),road('b',-450)];
  data.greens=[{id:'park-a',outer:rect(-500,-200,250),holes:[],tags:{leisure:'park'}},{id:'park-b',outer:rect(-500,200,250),holes:[],tags:{leisure:'park'}}];
  const landscapeTrees=Array.from({length:80},(_,i)=>({point:[100+(i%10)*10,100+Math.floor(i/10)*10],height:9,key:`court:${i}`,siteKey:`court:${i%4}`,shape:'spreading'}));
  const plan=planStreetLife(data,{maxTrees:80,landscapeTrees});
  assert.equal(plan.trees.length,80);assert.equal(plan.stats.treeBudgetLimited,true);
  assert(plan.stats.streetTrees>=20&&plan.stats.greenTrees>=15&&plan.stats.landscapeTrees>=15,'roads cannot starve parks or courts');
  assert(plan.trees.some(t=>t.roadId==='a')&&plan.trees.some(t=>t.roadId==='b'));
  assert(plan.trees.some(t=>t.key.startsWith('green:park-a:'))&&plan.trees.some(t=>t.key.startsWith('green:park-b:')));
  assert.equal(new Set(plan.trees.filter(t=>t.source==='inferred-landscape').map(t=>t.siteKey)).size,4);
});

test('woodland is dense, park edges are connected belts, and grass keeps an open interior',()=>{
  const data=base();data.greens=[
    {id:'grass',outer:rect(-650,-100,180),holes:[],tags:{landuse:'grass'}},
    {id:'park',outer:rect(-250,-100,180),holes:[rect(-180,-70,30)],tags:{leisure:'park'}},
    {id:'wood',outer:rect(150,-100,180),holes:[],tags:{natural:'wood'}},
  ];
  const plan=planStreetLife(data),group=id=>plan.trees.filter(t=>t.key.startsWith(`green:${id}:`));
  const grass=group('grass'),park=group('park'),wood=group('wood');
  assert(wood.length>park.length*2&&park.length>grass.length*1.3);
  for(const [id,depth]of [['grass',6.5],['park',19]])for(const tree of group(id)) {
    const green=data.greens.find(g=>g.id===id),p=[tree.x,tree.z];
    assert(edgeDistance(p,green.outer)<=depth);assert(inside(p,green.outer));
    assert(!green.holes.some(h=>inside(p,h)));
  }
  for(const tree of park)assert(park.some(other=>other!==tree&&Math.hypot(tree.x-other.x,tree.z-other.z)<12),'park trees should form groups along edges');
  assert.deepEqual(plan,planStreetLife(data));
});

test('confined frontages choose narrower crowns instead of intersecting buildings',()=>{
  const data=base();data.roads=[road('avenue')];data.buildings=[{id:'frontage',outer:rect(-400,11,800,30),holes:[]}];
  const plan=planStreetLife(data),confined=plan.trees.filter(t=>t.x>-390&&t.x<390&&t.z>0);
  assert(confined.length>30&&confined.every(t=>t.shape==='columnar'));
  for(const tree of plan.trees){const p=[tree.x,tree.z];assert(!inside(p,data.buildings[0].outer));assert(edgeDistance(p,data.buildings[0].outer)>=crownEnvelope(tree).radius-.000001);}
});

test('trees remain clear of blocked ground uses and paths after densification',()=>{
  const data=base();data.greens=[{id:'park',outer:rect(-120,-120,240),holes:[],tags:{leisure:'park'}}];
  data.landscapes=['parking','construction','sport'].map((kind,i)=>({kind,outer:rect(-120+i*80,-120,60,70),holes:[]}));
  data.water=[{outer:rect(-120,80,80,40),holes:[]}];
  data.roads=[{id:'walk',width:4,type:'footway',layer:0,segments:[[[-130,95],[130,95]]]}];
  const plan=planStreetLife(data);assert(plan.trees.length>20);
  for(const t of plan.trees){const p=[t.x,t.z];for(const area of [...data.landscapes,...data.water])assert(!inside(p,area.outer));assert(segmentDistance(p,[-130,95],[130,95])>=3);}
});
