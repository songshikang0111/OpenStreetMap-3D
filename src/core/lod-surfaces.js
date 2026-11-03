import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { roadHeightAt } from '../road-grade.js';
import { normaliseFlight, section, rampHeight } from '../road-stairs.js';
import { inside } from '../osm.js';
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
export function planarPatches(items, height=roadHeightAt, extraKey=()=> '') {
  const buckets=new Map();
  for(const item of items){
    const polygon=item.polygon;
    for(let i=1;i<polygon.length-1;i++){
      const p=[polygon[0],polygon[i],polygon[i+1]].map(q=>q.map(Math.fround)),y=p.map(q=>height(item,q));
      const dx=p[1][0]-p[0][0],dz=p[1][1]-p[0][1],ex=p[2][0]-p[0][0],ez=p[2][1]-p[0][1],det=dx*ez-dz*ex;
      if(Math.abs(det)<1e-9)continue;
      const a=((y[1]-y[0])*ez-(y[2]-y[0])*dz)/det,b=(dx*(y[2]-y[0])-ex*(y[1]-y[0]))/det,c=y[0]-a*p[0][0]-b*p[0][1];
      const key=`${Math.round(a/1e-7)},${Math.round(b/1e-7)},${Math.round(c/1e-4)}:${extraKey(item)}`;
      if(!buckets.has(key))buckets.set(key,{a,b,c,item,polygons:[]});
      const bucket=buckets.get(key);
      // A plane bucket may never move a source vertex by more than 1 mm.
      if(p.some((q,j)=>Math.abs(bucket.a*q[0]+bucket.b*q[1]+bucket.c-y[j])>.001)){
        buckets.set(`${key}:${buckets.size}`,{a,b,c,item,polygons:[[p]]});
      }else bucket.polygons.push([p]);
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
    for(const rings of polygons){const original=rings.map(openRing);patches.push({...bucket,rings:preservePolygonTopology(original,original.map(r=>simplifyClosedRing(r,.002))),polygons:undefined});}
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
  const writer=new Writer(),edges=new Map(),sides=[];let capTriangles=0;
  const key=v=>v.map(x=>Math.round(x*1e5)).join(',');
  for(const p of planarPatches(decks,roadHeightAt,d=>d.thickness)){
    const top=q=>p.a*q[0]+p.b*q[1]+p.c,bottom=q=>Math.max(.18,top(q)-p.item.thickness);
    const start=writer.positions.length;cap(writer,p.rings,bottom,'#969c97',false);capTriangles+=(writer.positions.length-start)/9;
    for(const [i,ring]of p.rings.entries()){
      const cw=THREE.ShapeUtils.isClockWise(ring.map(p=>new THREE.Vector2(...p))),r=cw!==!!i?[...ring].reverse():ring;
      for(let j=0;j<r.length;j++){
        const a=r[j],b=r[(j+1)%r.length],v=[[a[0],bottom(a),a[1]],[a[0],top(a),a[1]],[b[0],top(b),b[1]],[b[0],bottom(b),b[1]]];
        const ends=[`${key(v[0])}:${key(v[1])}`,`${key(v[3])}:${key(v[2])}`].sort(),edge=ends.join('|');edges.set(edge,(edges.get(edge)||0)+1);sides.push({edge,v});
      }
    }
  }
  for(const {edge,v}of sides)if(edges.get(edge)===1)writer.quad(...v,'#b8b8ac');
  const geometry=writer.geometry();geometry.userData.lodOptimization={capTriangles};return geometry;
}

/** Far slabs retain each source way's complete footprint and exact sampled
 * outer grade, rather than boxing every four-metre grade sample separately. */
export function farDeckGeometry(decks) {
  const writer=new Writer(),groups=new Map();
  // Height breaklines are constraints even when collinear in XZ. Earcut of a
  // whole-way footprint would discard them and interpolate through the road.
  for(const p of planarPatches(decks,(d,q)=>Math.max(.18,roadHeightAt(d,q)-d.thickness),d=>d.thickness))cap(writer,p.rings,q=>p.a*q[0]+p.b*q[1]+p.c,'#969c97',false);
  for(const d of decks){const key=`${d.roadId}:${d.level}:${d.thickness}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);}
  for(const items of groups.values()){
    let polygons;try{polygons=clipping.union(...items.map(d=>[d.polygon.map(p=>p.map(Math.fround))]));}catch{polygons=items.map(d=>[d.polygon]);}
    const height=q=>{
      let best=items[0],nearest=Infinity;
      for(const item of items){
        if(inside(q,item.polygon))return roadHeightAt(item,q);
        for(let i=0;i<item.polygon.length;i++){const a=item.polygon[i],b=item.polygon[(i+1)%item.polygon.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dz);if(d<nearest){nearest=d;best=item;}}
      }return roadHeightAt(best,q);
    };
    for(const polygon of polygons){
      const originalRings=polygon.map(openRing),rings=preservePolygonTopology(originalRings,originalRings.map(ring=>simplifyClosedRing(ring.map(p=>[p[0],height(p),p[1],Math.max(.18,height(p)-items[0].thickness)]),.009).map(([x,,z])=>[x,z])));
      const bottom=q=>Math.max(.18,height(q)-items[0].thickness);
      for(const [i,ring]of rings.entries()){
        const cw=THREE.ShapeUtils.isClockWise(ring.map(p=>new THREE.Vector2(...p))),r=cw!==!!i?[...ring].reverse():ring;
        for(let j=0;j<r.length;j++){const a=r[j],b=r[(j+1)%r.length];writer.quad([a[0],bottom(a),a[1]],[a[0],height(a),a[1]],[b[0],height(b),b[1]],[b[0],bottom(b),b[1]],'#b8b8ac');}
      }
    }
  }return writer.geometry();
}

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
  writer.quad(...v,color);
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
  const stairs=stairGeometries(plan.grades.stairs);
  return new Map([
    ['Continuous carriageways',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='drive'&&!s.stairFlight),'#777e7c')],
    ['OSM pedestrian paths and at-grade crossings',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='walk'&&!s.stairFlight),'#d0c9b9')],
    ['Inferred roadside margins clipped at buildings',surfaceGeometry(plan.surfaces.filter(s=>s.kind==='paving'&&!s.stairFlight),'#ddd7c8')],
    ['Bridge deck thickness and soffits',farDeckGeometry(structures.decks)],
    ['Bridge parapets and pedestrian guardrails',railGeometry(structures.rails)],
    ['Stair treads and endpoint landings',stairs[0]],['Stair risers, sides and soffits',stairs[1]],['Continuous stair handrails and posts',stairs[2]],
  ]);
}
