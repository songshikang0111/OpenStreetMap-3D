import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCity } from '../src/city.js';
import { planStreetLife } from '../src/streetlife.js';
import { inside } from '../src/osm.js';
import { decodeView,encodeView } from '../src/view-state.js';
import { planLandscapeMarkings } from '../src/landscape-markings.js';
import { buildLandscape } from '../src/landscape.js';
import clipping from 'polygon-clipping';
import { area } from '../src/osm.js';

const rectangle=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const base=()=>({bounds:[-20,-20,20,20],buildings:[],roads:[],greens:[],water:[],trees:[],streetNodes:[],treeRows:[],landscapes:[]});
test('clipped water with inner holes preserves area and stays inside the extract',()=>{
  const data=base();data.water=[{outer:rectangle(-30,-30,30,30),holes:[rectangle(-5,-5,5,5)]}];
  const city=buildCity(data,{landscapeEnabled:false}),mesh=city.group.children.find(o=>o.name==='Land cover');
  const p=mesh.geometry.attributes.position;
  let area=0;
  for(let i=0;i<p.count;i+=3){
    const a=[p.getX(i),p.getZ(i)],b=[p.getX(i+1),p.getZ(i+1)],c=[p.getX(i+2),p.getZ(i+2)];
    area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    for(const q of [a,b,c]) assert(q.every(v=>v>=-20&&v<=20));
    assert(!inside([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3],data.water[0].holes[0]));
  }
  assert.equal(area,1500);
});

test('inferred trees respect non-green ground uses, water and pedestrian paths',()=>{
  const data=base();data.bounds=[-100,-100,100,100];
  data.landscapes=[{kind:'parking',outer:rectangle(-50,-50,0,50),holes:[]}];
  data.water=[{outer:rectangle(30,-50,70,50),holes:[]}];
  data.roads=[{id:1,width:3,layer:0,type:'footway',segments:[[[10,-90],[10,90]]]}];
  const trees=[[-20,0],[50,0],[10,0],[80,0]].map((point,i)=>({point,key:i,height:6}));
  const plan=planStreetLife(data,{landscapeTrees:trees});
  assert.equal(plan.stats.landscapeTrees,1);assert.equal(plan.trees[0].x,80);
});

test('view links retain the landscape opt-out without breaking old links',()=>{
  assert.equal(decodeView(encodeView({version:2,toggles:{'landscape-toggle':false}})).toggles['landscape-toggle'],false);
  assert.equal(decodeView(encodeView({version:2,toggles:{}})).toggles['landscape-toggle'],undefined);
});

test('parking and pitch markings respect omitted holes and never decorate construction',()=>{
  const feature={id:'lot',osmId:4,kind:'parking',tags:{},outer:rectangle(0,0,50,25),holes:[rectangle(10,0,20,25)]};
  const plan={surfaces:[{...feature,id:'osm:lot'}]},data={landscapes:[feature]};
  const marks=planLandscapeMarkings(data,plan);assert(marks.length>10);
  for(const mark of marks)for(const [x,z]of mark.outer)assert(x<=10.00001||x>=19.99999);
  assert(planLandscapeMarkings(data,plan,{maxStrips:3}).length<=3);
  assert.equal(planLandscapeMarkings({landscapes:[{...feature,kind:'construction'}]},plan).length,0);
});

test('court paint is inlaid rather than depth-competing with the support surface',()=>{
  const data=base();data.bounds=[-50,-50,50,50];
  data.landscapes=[{id:'pitch',osmId:5,kind:'sport',tags:{},outer:rectangle(-20,-10,20,10),holes:[]}];
  const result=buildLandscape(data),surface=result.group.children.find(m=>m.name==='osm:sport'),paint=result.group.children.find(m=>m.name.includes('court lines'));
  assert.deepEqual([...surface.geometry.attributes.objectId.array.slice(0,3)],[...paint.geometry.attributes.objectId.array.slice(0,3)],'paint must not gain separate object outlines');
  const triangles=m=>{const p=m.geometry.attributes.position,out=[];for(let i=0;i<p.count;i+=3){out.push([Array.from({length:3},(_,j)=>[p.getX(i+j),p.getZ(i+j)])]);assert(Math.abs(p.getY(i)-.12)<1e-6);}return out;};
  const paintArea=clipping.union(...triangles(paint));let overlap=0;
  for(const t of triangles(surface)) for(const p of clipping.intersection(t,paintArea))overlap+=area(p[0])-p.slice(1).reduce((sum,h)=>sum+area(h),0);
  assert(overlap<.001,`inlaid support/paint overlap=${overlap}`);
});
