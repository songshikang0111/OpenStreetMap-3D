import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseOSM} from '../src/osm.js';
import {planRoadGrades} from '../src/road-grade.js';

const load=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url)));
const fixture=load('./fixtures/sydney-short-footbridge.json');
const walk=r=>/^(footway|path|steps|pedestrian|cycleway)$/.test(r.type);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
// Independent geometric acceptance: intersect actual finite-width strips and
// interpolate the returned road planes; do not reuse clearance sample/reach.
const strip=s=>{const l=dist(s.a,s.b),n=[(s.a[1]-s.b[1])*s.road.width/2/l,(s.b[0]-s.a[0])*s.road.width/2/l];return [[s.a[0]+n[0],s.a[1]+n[1]],[s.a[0]-n[0],s.a[1]-n[1]],[s.b[0]-n[0],s.b[1]-n[1]],[s.b[0]+n[0],s.b[1]+n[1]]];};
function intersect(subject,clip){
  let result=subject;
  for(let i=0;i<clip.length&&result.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length],next=[];
    for(let j=0;j<result.length;j++){
      const p=result[j],q=result[(j+1)%result.length],dp=cross(a,b,p),dq=cross(a,b,q);
      if(dp>=-1e-8)next.push(p);
      if((dp<0)!==(dq<0)){const t=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    result=next;
  }
  return result;
}
function elevation(s,p){
  const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dz)/(dx*dx+dz*dz)));
  return s.yA+(s.yB-s.yA)*t;
}
const onSource=(s,p)=>Math.abs(cross(s.a,s.b,p))<1e-5*dist(s.a,s.b)&&p[0]>=Math.min(s.a[0],s.b[0])-1e-5&&p[0]<=Math.max(s.a[0],s.b[0])+1e-5&&p[1]>=Math.min(s.a[1],s.b[1])-1e-5&&p[1]<=Math.max(s.a[1],s.b[1])+1e-5;
function checkGrades(plan){
  const nodeHeights=new Map();
  for(const s of plan.segments){
    assert([s.yA,s.yB,...s.a,...s.b].every(Number.isFinite));
    if(s.road.type!=='steps')assert(Math.abs(s.yB-s.yA)/dist(s.a,s.b)<=(s.road.type==='cycleway'?.12:walk(s.road)?.35:.10)+1e-6);
    for(const [key,y]of [[s.nodeA,s.yA],[s.nodeB,s.yB]]){if(nodeHeights.has(key))assert(Math.abs(nodeHeights.get(key)-y)<1e-7,key);nodeHeights.set(key,y);}
  }
}
function checkCrossings(data,plan){
  const byRoad=new Map(),sourceByRoad=new Map();
  for(const s of plan.segments){if(!byRoad.has(s.road.id))byRoad.set(s.road.id,[]);byRoad.get(s.road.id).push(s);}
  for(const r of data.roads)sourceByRoad.set(r.id,r.segments.map(([a,b])=>({a,b,road:r})));
  let vertices=0,minimum=Infinity;
  for(const c of plan.crossingConstraints){
    const a=sourceByRoad.get(c.aRoad).find(s=>onSource(s,c.point)),b=sourceByRoad.get(c.bRoad).find(s=>onSource(s,c.point));
    assert(a&&b);
    const footprint=intersect(strip(a),strip(b));assert(footprint.length>=3);
    const [upper,lower]=c.aY>c.bY?[a,b]:[b,a];let checked=0;
    for(const u of byRoad.get(upper.road.id))for(const l of byRoad.get(lower.road.id)){
      if(Math.max(u.a[0],u.b[0])+u.road.width/2<Math.min(l.a[0],l.b[0])-l.road.width/2||Math.min(u.a[0],u.b[0])-u.road.width/2>Math.max(l.a[0],l.b[0])+l.road.width/2||Math.max(u.a[1],u.b[1])+u.road.width/2<Math.min(l.a[1],l.b[1])-l.road.width/2||Math.min(u.a[1],u.b[1])-u.road.width/2>Math.max(l.a[1],l.b[1])+l.road.width/2)continue;
      const shared=intersect(intersect(strip(u),strip(l)),footprint);
      // Allow 1 mm at adjoining source-strip seams; this is much smaller than
      // the deck-thickness/headroom margin already included in c.gap.
      for(const p of shared){const gap=elevation(u,p)-elevation(l,p);assert(gap>=c.gap-.001,`${c.aRoad}/${c.bRoad}: ${gap}`);minimum=Math.min(minimum,gap);checked++;}
    }
    assert(checked,`crossing ${c.aRoad}/${c.bRoad} was lost`);vertices+=checked;
  }
  return {crossings:plan.crossingConstraints.length,vertices,minimum};
}

test('real short connected Sydney footbridge retains its crossing clearance without lifting the network indefinitely',()=>{
  const plan=planRoadGrades(fixture);checkGrades(plan);
  assert.equal(plan.stats.gradeCrossingConstraints,1);assert.equal(plan.stats.gradeAmbiguousCrossings,0);
  assert(Math.max(...plan.nodes.map(n=>n.y))<=14.000001);
  assert.equal(checkCrossings(fixture,plan).crossings,1);
  assert.deepEqual(plan,planRoadGrades({...fixture,roads:[...fixture.roads].reverse()}));
});

test('original wide Sydney extract loads all roads and preserves every full-width crossing and shared node',()=>{
  const raw=load('../public/data/sydney-circular-quay.json'),data=parseOSM(raw),plan=planRoadGrades(data);
  assert.deepEqual(raw.metadata.bbox,[-33.864,151.205,-33.8545,151.218]);
  assert.equal(data.roads.length,1656);assert.equal(plan.stats.gradeCrossingConstraints,160);assert.equal(plan.stats.gradeAmbiguousCrossings,0);
  assert.equal(new Set(plan.segments.map(s=>s.road.id)).size,data.roads.length);
  checkGrades(plan);assert(Math.max(...plan.nodes.map(n=>n.y))<=14.000001);
  const audit=checkCrossings(data,plan);assert(audit.vertices>500);console.log('Sydney full-width clearance audit',audit);
});
