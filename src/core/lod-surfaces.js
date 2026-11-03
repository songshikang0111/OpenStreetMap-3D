import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { roadHeightAt } from '../road-grade.js';
import { normaliseFlight, section, rampHeight } from '../road-stairs.js';
import { simplifyClosedRing, preservePolygonTopology } from './lod-simplify.js';

class Writer {
  positions=[]; colors=[];
  triangle(a,b,c,color) { const rgb=new THREE.Color(color);for(const p of [a,b,c]){this.positions.push(...p);this.colors.push(...rgb.toArray());} }
  quad(a,b,c,d,color){this.triangle(a,b,c,color);this.triangle(a,c,d,color);}
  geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,3));g.computeVertexNormals();return g;}
  beam(a,b,width,height,color) {
    const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz);if(len<1e-6)return;
    const nx=-dz/len*width/2,nz=dx/len*width/2;
    const p=(v,x,y)=>[v[0]+nx*x,v[1]+height*y/2,v[2]+nz*x];
    const v=[p(a,-1,-1),p(a,1,-1),p(a,1,1),p(a,-1,1),p(b,-1,-1),p(b,1,-1),p(b,1,1),p(b,-1,1)];
    for(const face of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]])this.quad(...face.map(i=>v[i]),color);
  }
}

const openRing=ring=>{
  const closed=ring.length>1&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1];
  return (closed?ring.slice(0,-1):ring).map(p=>p.slice());
};

/** Retrangulate the same union on the same height planes, before tiling.
 * The input fan matches the legacy road writer, including clamped ramp ends.
 * Paint is a near detail; its support is the complete un-inlaid carriageway. */
export function planarPatches(items, height=roadHeightAt, extraKey=()=> '', secondaryHeight) {
  const buckets=new Map(),families=new Map();
  for(const item of items){
    const polygon=item.polygon;
    for(let i=1;i<polygon.length-1;i++){
      const p=[polygon[0],polygon[i],polygon[i+1]].map(q=>q.map(Math.fround)),y=p.map(q=>height(item,q));
      const dx=p[1][0]-p[0][0],dz=p[1][1]-p[0][1],ex=p[2][0]-p[0][0],ez=p[2][1]-p[0][1],det=dx*ez-dz*ex;
      if(Math.abs(det)<1e-9)continue;
      const a=((y[1]-y[0])*ez-(y[2]-y[0])*dz)/det,b=(dx*(y[2]-y[0])-ex*(y[1]-y[0]))/det,c=y[0]-a*p[0][0]-b*p[0][1];
      let secondary;
      if(secondaryHeight){const h=p.map(q=>secondaryHeight(item,q)),sa=((h[1]-h[0])*ez-(h[2]-h[0])*dz)/det,sb=(dx*(h[2]-h[0])-ex*(h[1]-h[0]))/det;secondary={a:sa,b:sb,c:h[0]-sa*p[0][0]-sb*p[0][1]};}
      const gradient=1e-3,intercept=1,maximumError=.002;
      const key=`${Math.round(a/gradient)},${Math.round(b/gradient)},${Math.round(c/intercept)}:${secondary?[secondary.a,secondary.b,secondary.c].map((v,i)=>Math.round(v/(i===2?intercept:gradient))).join(','):''}:${extraKey(item)}`;
      if(!families.has(key))families.set(key,[]);
      const models=families.get(key),samples=p.map((q,j)=>[q[0],q[1],y[j],secondaryHeight?secondaryHeight(item,q):y[j]]);
      const fits=(model,s)=>Math.abs(model.a*s[0]+model.b*s[1]+model.c-s[2])<=maximumError&&(!secondaryHeight||Math.abs(model.secondary.a*s[0]+model.secondary.b*s[1]+model.secondary.c-s[3])<=maximumError);
      let bucket=models.find(model=>samples.every(s=>fits(model,s)));
      // Every merged triangle is checked at all original vertices; affine error
      // is bounded throughout the triangle, not just at its outer endpoints.
      if(!bucket){bucket={a,b,c,secondary,item,polygons:[]};models.push(bucket);buckets.set(`${key}:${models.length}`,bucket);}
      bucket.polygons.push([p]);
    }
  }
  const patches=[];
  for(const bucket of buckets.values()){
    if(!bucket.polygons.length)continue;
    let polygons;
    try {
      let batches=[];for(let i=0;i<bucket.polygons.length;i+=128)batches.push(clipping.union(...bucket.polygons.slice(i,i+128)));
      while(batches.length>1){const next=[];for(let i=0;i<batches.length;i+=32)next.push(clipping.union(...batches.slice(i,i+32)));batches=next;}
      polygons=batches[0];
    }catch{polygons=bucket.polygons;} // Preserve complete geometry on boolean failure.
    for(const rings of polygons){const original=rings.map(openRing);patches.push({...bucket,rings:preservePolygonTopology(original,original.map(r=>simplifyClosedRing(r,secondaryHeight ? .002 : .004))),polygons:undefined});}
  }
  return patches;
}

function cap(writer,rings,y,color,up=true) {
  const vectors=rings.map(r=>r.map(p=>new THREE.Vector2(...p))),triangles=THREE.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1)),all=vectors.flat();
  for(const t of triangles){const v=t.map(i=>[all[i].x,y([all[i].x,all[i].y]),all[i].y]);
    const signed=(v[1][2]-v[0][2])*(v[2][0]-v[0][0])-(v[1][0]-v[0][0])*(v[2][2]-v[0][2]);if((signed>0)!==up)[v[1],v[2]]=[v[2],v[1]];writer.triangle(...v,color);}
}

export function surfaceGeometry(items,color){
  const writer=new Writer();for(const p of planarPatches(items))cap(writer,p.rings,q=>p.a*q[0]+p.b*q[1]+p.c,color);return writer.geometry();
}

export function deckGeometry(decks){
  const writer=new Writer(),sides=[],vertices=[],grid=new Map(),cellSize=12;
  const key=v=>v.slice(0,2).map(x=>Math.round(x*1e5)).join(',');
  const patches=planarPatches(decks,(d,q)=>Math.max(.18,roadHeightAt(d,q)-d.thickness),()=>'',roadHeightAt);
  for(const p of patches){
    const top=q=>p.secondary.a*q[0]+p.secondary.b*q[1]+p.secondary.c,bottom=q=>p.a*q[0]+p.b*q[1]+p.c;
    cap(writer,p.rings,bottom,'#969c97',false);
    for(const [i,ring]of p.rings.entries()){
      const cw=THREE.ShapeUtils.isClockWise(ring.map(p=>new THREE.Vector2(...p))),r=cw!==!!i?[...ring].reverse():ring;
      for(let j=0;j<r.length;j++){
        const a=r[j],b=r[(j+1)%r.length],from=[a[0],a[1],top(a),bottom(a)],to=[b[0],b[1],top(b),bottom(b)];sides.push({from,to});vertices.push(from);
      }
    }
  }
  for(const v of vertices){const k=`${Math.floor(v[0]/cellSize)},${Math.floor(v[1]/cellSize)}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(v);}
  // Two fitted source planes may differ by at most 2mm each at their shared
  // edge. Their duplicate interior skins are not exposed bridge boundaries.
  // Match only common XZ edges within that combined error, retaining true steps.
  const pieces=[],edgeFamilies=new Map();
  for(const {from:a,to:b}of sides){
    const dx=b[0]-a[0],dz=b[1]-a[1],lengthSq=dx*dx+dz*dz,ts=[0,1];if(lengthSq<1e-16)continue;
    for(let x=Math.floor(Math.min(a[0],b[0])/cellSize);x<=Math.floor(Math.max(a[0],b[0])/cellSize);x++)for(let z=Math.floor(Math.min(a[1],b[1])/cellSize);z<=Math.floor(Math.max(a[1],b[1])/cellSize);z++)for(const v of grid.get(`${x},${z}`)||[]){
      const t=((v[0]-a[0])*dx+(v[1]-a[1])*dz)/lengthSq;if(t<=1e-7||t>=1-1e-7)continue;
      if(Math.hypot(v[0]-a[0]-t*dx,v[1]-a[1]-t*dz)<1e-5&&Math.abs(v[2]-a[2]-(b[2]-a[2])*t)<.00401&&Math.abs(v[3]-a[3]-(b[3]-a[3])*t)<.00401)ts.push(t);
    }
    const sorted=[...new Set(ts)].sort((a,b)=>a-b);
    for(let i=1;i<sorted.length;i++){
      const u=a.map((v,k)=>v+(b[k]-v)*sorted[i-1]),v=a.map((w,k)=>w+(b[k]-w)*sorted[i]),ends=key(u)<key(v)?[u,v]:[v,u],family=ends.map(key).join('|');
      if(!edgeFamilies.has(family))edgeFamilies.set(family,[]);const models=edgeFamilies.get(family);let model=models.find(model=>ends.every((end,j)=>[2,3].every(k=>Math.abs(end[k]-model.reference[j][k])<=.00401)));
      if(!model){model={reference:ends,ends:ends.map(p=>p.slice()),directions:new Set()};models.push(model);pieces.push(model);}
      model.directions.add(key(u)<key(v));for(let j=0;j<2;j++){model.ends[j][2]=Math.max(model.ends[j][2],ends[j][2]);model.ends[j][3]=Math.min(model.ends[j][3],ends[j][3]);}
    }
  }
  for(const model of pieces)if(model.directions.size===1){const [u,v]=model.directions.has(true)?model.ends:[...model.ends].reverse();writer.quad([u[0],u[3],u[1]],[u[0],u[2],u[1]],[v[0],v[2],v[1]],[v[0],v[3],v[1]],'#b8b8ac');}
  return writer.geometry();
}

/** Shared structural shell; every LOD uses identical surfaces and ownership. */
export function farDeckGeometry(decks){return deckGeometry(decks);}

/** Only join touching segments of the same source/width, with a 2.5 cm
 * three-dimensional simplification bound. Real gaps and larger bends remain. */
export function mergeRailSegments(rails) {
  const key=p=>p.map(x=>x.toFixed(5)).join(','),chains=[],pending=new Map();
  for(const r of rails){
    const a=[r.a[0],r.yA,r.a[1]],b=[r.b[0],r.yB,r.b[1]],family=`${r.roadId}:${r.walk}:${r.width}`;
    const previous=pending.get(`${family}:${key(a)}`);
    if(previous){pending.delete(`${family}:${key(a)}`);previous.points.push(b);pending.set(`${family}:${key(b)}`,previous);}
    else {const chain={...r,points:[a,b]};chains.push(chain);pending.set(`${family}:${key(b)}`,chain);}
  }
  const out=[];
  for(const chain of chains){
    const points=chain.points,keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const [lo,hi]=stack.pop(),a=new THREE.Vector3(...points[lo]),b=new THREE.Vector3(...points[hi]),line=new THREE.Line3(a,b);let distance=.025,index=-1;
      for(let i=lo+1;i<hi;i++){const point=new THREE.Vector3(...points[i]),nearest=line.closestPointToPoint(point,true,new THREE.Vector3()),d=nearest.distanceTo(point);if(d>distance){distance=d;index=i;}}
      if(index>=0){keep.add(index);stack.push([lo,index],[index,hi]);}
    }
    const indices=[...keep].sort((a,b)=>a-b);for(let i=1;i<indices.length;i++)out.push({...chain,a:points[indices[i-1]],b:points[indices[i]],points:undefined});
  }return out;
}

function ribbon(writer,a,b,height,color){
  const v=[a.map((x,i)=>x-(i===1?height/2:0)),b.map((x,i)=>x-(i===1?height/2:0)),b.map((x,i)=>x+(i===1?height/2:0)),a.map((x,i)=>x+(i===1?height/2:0))];
  if(height<.1){const bottom=a.map((x,i)=>(x+b[i])/2-(i===1?height/2:0));writer.triangle(v[3],v[2],bottom,color);}else writer.quad(...v,color);
}

export function railGeometry(rails,medium=false) {
  const writer=new Writer();
  for(const r of mergeRailSegments(rails)){
    const at=offset=>[r.a.map((v,i)=>v+(i===1?offset:0)),r.b.map((v,i)=>v+(i===1?offset:0))];
    if(r.walk){
      if(medium)writer.beam(...at(1.08),.065,.065,'#7d8986');else ribbon(writer,...at(1.08),.065,'#7d8986');
      if(medium){writer.beam(...at(.55),.065,.065,'#7d8986');const length=Math.hypot(...r.b.map((v,i)=>v-r.a[i])),count=Math.max(1,Math.ceil(length/12));for(let i=0;i<=count;i++){const p=r.a.map((v,k)=>v+(r.b[k]-v)*i/count);writer.beam([p[0]-.0325,p[1]+.55,p[2]],[p[0]+.0325,p[1]+.55,p[2]],.065,1.1,'#82908a');}}
    }else if(medium)writer.beam(...at(.38),r.width,.76,'#c4c5b8');else ribbon(writer,...at(.38),.76,'#c4c5b8');
  }const geometry=writer.geometry();geometry.userData.lodDoubleSided=!medium;return geometry;
}

export function stairGeometries(flights){
  const top=new Writer(),shell=new Writer(),rails=new Writer();
  for(const original of flights){const f=normaliseFlight(original);if(!f)continue;
    const cuts=[0,f.landing,f.length-f.landing,f.length,...f.distances].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>1e-7);
    const point=(p,y)=>[p[0],y,p[1]];
    for(let i=1;i<cuts.length;i++){
      const a=section(f,cuts[i-1]),b=section(f,cuts[i]),ya=rampHeight(f,cuts[i-1]),yb=rampHeight(f,cuts[i]);
      top.quad(point(a.left,ya),point(b.left,yb),point(b.right,yb),point(a.right,ya),'#d0ccbc');
      shell.quad(point(a.left,ya-.24),point(a.right,ya-.24),point(b.right,yb-.24),point(b.left,yb-.24),'#969c97');
      shell.quad(point(a.left,ya-.24),point(b.left,yb-.24),point(b.left,yb),point(a.left,ya),'#b8b8ac');
      shell.quad(point(a.right,ya-.24),point(a.right,ya),point(b.right,yb),point(b.right,yb-.24),'#b8b8ac');
      if(i===1)shell.quad(point(a.left,ya-.24),point(a.left,ya),point(a.right,ya),point(a.right,ya-.24),'#b8b8ac');
      if(i===cuts.length-1)shell.quad(point(b.left,yb-.24),point(b.right,yb-.24),point(b.right,yb),point(b.left,yb),'#b8b8ac');
      for(const side of ['left','right'])ribbon(rails,point(a[side],ya+1.08),point(b[side],yb+1.08),.065,'#7d8986');
    }
  }const rail=rails.geometry();rail.userData.lodDoubleSided=true;return [top.geometry(),shell.geometry(),rail];
}

export function coarseRoadGeometries(plan) {
  const structures=plan.structures;
  const stairs=stairGeometries(plan.grades.stairs);stairs[0].dispose();stairs[1].dispose();
  return new Map([
    ['Continuous carriageways',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='drive'&&!s.stairFlight),'#777e7c')],
    ['OSM pedestrian paths and at-grade crossings',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='walk'&&!s.stairFlight),'#d0c9b9')],
    ['Inferred roadside margins clipped at buildings',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='paving'&&!s.stairFlight),'#ddd7c8')],
    ['Bridge deck thickness and soffits',farDeckGeometry(structures.decks)],
    ['Bridge parapets and pedestrian guardrails',railGeometry(structures.rails)],
    ['Continuous stair handrails and posts',stairs[2]],
  ]);
}
