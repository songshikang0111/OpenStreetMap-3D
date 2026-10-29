import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOSM} from '../src/osm.js';
import {planRoadGrades,roadHeightAt} from '../src/road-grade.js';
import {buildRoadSurface} from '../src/road-surface.js';
const road=(id,points,nodes,extra={})=>({id,type:'primary',width:10,bridge:false,layer:0,tags:{},segments:points.slice(1).map((p,i)=>[points[i],p]),segmentNodes:nodes.slice(1).map((n,i)=>[nodes[i],n]),...extra});
const data=roads=>({roads,bounds:[-1000,-1000,1000,1000],buildings:[],water:[],streetNodes:[]});

test('clipped source segments retain true endpoint node identities without fabricating boundary junctions',()=>{
  const raw={metadata:{bbox:[-.001,-.001,.001,.001],center:[0,0]},elements:[{type:'way',id:1,nodes:[10,11,12],geometry:[{lat:0,lon:-.003},{lat:0,lon:0},{lat:0,lon:.003}],tags:{highway:'primary'}}]};
  const parsed=parseOSM(raw);assert.deepEqual(parsed.roads[0].segmentNodes,[[null,11],[11,null]]);
});

test('shared OSM nodes join across way/layer boundaries, while coincident independent nodes do not connect',()=>{
  const input=data([road(1,[[-200,0],[0,0]],[1,2]),road(2,[[0,0],[200,0]],[2,3],{bridge:true,layer:1})]);
  const plan=planRoadGrades(input),at=plan.segments.filter(s=>s.nodeA==='osm:2'||s.nodeB==='osm:2').map(s=>roadHeightAt(s,[0,0]));
  assert(at.length>=2);assert(Math.max(...at)-Math.min(...at)<1e-8);assert(at[0]>.32&&at[0]<7);
  const detached=planRoadGrades(data([road(1,[[-200,0],[0,0]],[1,2]),road(2,[[0,0],[200,0]],[20,3],{bridge:true,layer:1})]));
  assert.equal(detached.stats.gradeOriginalDiscontinuities,0);
  assert.equal(detached.nodes.find(n=>n.key==='osm:2').y,.32);assert.equal(detached.nodes.find(n=>n.key==='osm:20').y,7);
  assert.deepEqual(plan,planRoadGrades({...input,roads:[...input.roads].reverse()}));
});

test('a short connecting way cannot force a cliff at a nearby branch; all branches share solved height',()=>{
  const input=data([road(1,[[-250,0],[-10,0]],[1,2]),road(2,[[-10,0],[0,0]],[2,3]),road(3,[[0,0],[180,0]],[3,4],{bridge:true,layer:1}),road(4,[[-10,0],[-10,250]],[2,5])]);
  const plan=planRoadGrades(input);
  for(const s of plan.segments)assert(Math.abs(s.yB-s.yA)/Math.hypot(s.a[0]-s.b[0],s.a[1]-s.b[1])<=.100001);
  assert.equal(plan.stats.gradeConstraintConflicts,0);
});

test('three-node stair ways split at the elevated middle platform regardless of bridge tagging',()=>{
  for(const bridge of [true,false]){
    const input=data([road(1,[[-25,0],[0,0],[25,0]],[1,2,3],{type:'steps',width:2,bridge}),road(2,[[0,0],[0,60]],[2,4],{type:'footway',width:2,bridge:true,layer:1}),road(3,[[-50,0],[-25,0]],[5,1],{type:'footway',width:2}),road(4,[[25,0],[50,0]],[3,6],{type:'footway',width:2})]);
    const plan=planRoadGrades(input);assert.equal(plan.stairs.length,2);
    for(const flight of plan.stairs){assert.equal(Math.min(flight.y0,flight.y1),.47);assert.equal(Math.max(flight.y0,flight.y1),7);}
  }
});

test('ramp pavement, paint and rail geometry use the same longitudinal height and tilted normals',()=>{
  const input=data([road(1,[[-200,0],[0,0]],[1,2]),road(2,[[0,0],[200,0]],[2,3],{bridge:true,layer:1})]),built=buildRoadSurface(input);
  const ramps=built.plan.segments.filter(s=>Math.abs(s.yA-s.yB)>.01);assert(ramps.length>10);
  for(const paint of built.plan.markings){const s=built.plan.segments.find(s=>s.road.id===paint.roadId&&paint.a[0]>=s.a[0]-1e-6&&paint.b[0]<=s.b[0]+1e-6);assert(s);assert(Math.abs(roadHeightAt(paint,paint.a)-roadHeightAt(s,paint.a)-.018)<1e-6);}
  const pavement=built.group.children.find(m=>m.name==='Continuous carriageways');assert([...pavement.geometry.attributes.normal.array].some(n=>Math.abs(n)>.01&&Math.abs(n)<.99));
  for(const rail of built.structures.rails){const seg=built.plan.segments.find(s=>s.road.id===rail.roadId&&rail.a[0]>=s.a[0]-1e-6&&rail.b[0]<=s.b[0]+1e-6);assert(seg);assert(Math.abs(rail.yA-roadHeightAt(seg,rail.a))<1e-6);}
  built.dispose();
});
