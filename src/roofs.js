import * as THREE from 'three';
import { area, metres } from './osm.js';

// A conservative, explicitly optional typology guess. It never changes OSM
// tags or building heights, and never overrides an explicit roof shape.
export function planRoof(building,{inferRoofs=false}={}) {
  const tags=building.tags||{},explicit=tags['roof:shape'];
  let shape=explicit,source='osm';
  let longest=[1,0],length=0;
  for(let i=0;i<building.outer.length;i++){
    const a=building.outer[i],b=building.outer[(i+1)%building.outer.length],d=[b[0]-a[0],b[1]-a[1]],n=Math.hypot(...d);
    if(n>length){length=n;longest=d.map(v=>v/n);}
  }
  let u=longest,v=[-u[1],u[0]];
  const direction=Number.parseFloat(tags['roof:direction']);
  if(Number.isFinite(direction)){v=[Math.sin(direction*Math.PI/180),-Math.cos(direction*Math.PI/180)];u=[-v[1],v[0]];}
  else if(tags['roof:orientation']==='across'){[u,v]=[v,u.map(n=>-n)];}
  const project=p=>[p[0]*u[0]+p[1]*u[1],p[0]*v[0]+p[1]*v[1]];
  const points=building.outer.map(project),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),w=x1-x0,d=z1-z0;
  if(!shape&&inferRoofs&&building.minHeight===0&&!building.part&&!(building.holes||[]).length
      &&/^(yes|house|detached|semidetached_house|terrace|bungalow|cabin)$/.test(tags.building||'')
      &&!tags.amenity&&!tags.office&&!tags.shop&&building.height<=12.5&&building.area>=20&&building.area<=350
      &&Math.min(w,d)>=3&&Math.max(w,d)<=35&&building.area/(w*d)>.78){shape='gabled';source='inferred';}
  if(!['gabled','hipped','pyramidal','skillion'].includes(shape)||Math.min(w,d)<.5)return {shape:explicit||'flat',source:explicit?'osm':'none',supported:false};
  let rise=metres(tags['roof:height']);
  if(!(rise>0)&&Number(tags['roof:levels'])>0)rise=Number(tags['roof:levels'])*3;
  if(!(rise>0)&&Number(tags['roof:angle'])>0)rise=Math.tan(Number(tags['roof:angle'])*Math.PI/180)*d/2;
  const dimensionsInferred=!(rise>0);
  if(dimensionsInferred)rise=Math.min(4.5,Math.max(1.2,d*.28));
  rise=Math.min(rise,Math.max(.2,(building.height-building.minHeight)*(dimensionsInferred ? .45 : 1)-.2));
  const top=.45+building.height,eave=top-rise;
  const mid=(z0+z1)/2;
  // Each roof is the lower envelope of planes, clipped to the real footprint.
  let planes=shape==='skillion'?[[0,1/d,-z0/d]]:[[0,2/d,-2*z0/d],[0,-2/d,2*z1/d]];
  if(shape==='hipped'||shape==='pyramidal'){
    const end=shape==='hipped'?Math.min(w,d)/2:w/2;
    planes.push([1/end,0,-x0/end],[-1/end,0,x1/end]);
  }
  const height=p=>eave+rise*Math.max(0,Math.min(...planes.map(([a,b,c])=>a*project(p)[0]+b*project(p)[1]+c)));
  return {shape,source,supported:true,dimensionsInferred,rise,eave,top,u,v,x0,x1,z0,z1,mid,planes,project,height};
}

export function writeRoof(writer,building,plan,color,id,wallColor) {
  const footprint=[building.outer,...(building.holes||[])];
  const {project,u,v}=plan;
  const world=p=>[u[0]*p[0]+v[0]*p[1],u[1]*p[0]+v[1]*p[1]];
  const vectors=footprint.map(r=>r.map(p=>new THREE.Vector2(...p)));
  const sourceTriangles=THREE.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1)),vertices=vectors.flat();
  function halfPlane(poly,A,B,C){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],a=A*p[0]+B*p[1]+C,b=A*q[0]+B*q[1]+C;
      if(a<=1e-8)out.push(p);
      if((a<0&&b>0)||(a>0&&b<0)){const t=a/(a-b);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    return out;
  }
  for(const plane of plan.planes){
    const normal=new THREE.Vector3(-plan.rise*(plane[0]*u[0]+plane[1]*v[0]),1,-plan.rise*(plane[0]*u[1]+plane[1]*v[1])).normalize().toArray();
    // Clip convex source triangles rather than boolean-sweeping coincident
    // footprint/ridge edges. This retains holes and avoids fragile ring joins.
    for(const triangle of sourceTriangles){
      let patch=triangle.map(k=>project(vertices[k].toArray()));
      for(const other of plan.planes)if(other!==plane)patch=halfPlane(patch,plane[0]-other[0],plane[1]-other[1],plane[2]-other[2]);
      if(patch.length<3||area(patch)<1e-7)continue;
      for(let k=1;k<patch.length-1;k++)writer.triangle(...[patch[0],patch[k],patch[k+1]].map(q=>{const p=world(q);return [p[0],plan.height(p),p[1]];}),normal,color,id);
    }
  }
  // Close gables and clipped side faces, including courtyard walls. Split at
  // every plane switch so the edge follows the ridge without cracks.
  for(const [ringIndex,rawRing]of footprint.entries()){
    const ring=[...rawRing];if(THREE.ShapeUtils.isClockWise(ring.map(p=>new THREE.Vector2(...p)))!==Boolean(ringIndex))ring.reverse();
    for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],pa=project(a),pb=project(b),cuts=[0,1];
    for(const first of plan.planes)for(const second of plan.planes){
      const A=first[0]-second[0],B=first[1]-second[1],C=first[2]-second[2],den=A*(pb[0]-pa[0])+B*(pb[1]-pa[1]);
      if(Math.abs(den)>1e-9){const t=-(A*pa[0]+B*pa[1]+C)/den;if(t>0&&t<1)cuts.push(t);}
    }
    cuts.sort((a,b)=>a-b);
    const n=[b[1]-a[1],0,a[0]-b[0]],len=Math.hypot(...n)||1;
    for(let j=1;j<cuts.length;j++){
      const p=world([pa[0]+(pb[0]-pa[0])*cuts[j-1],pa[1]+(pb[1]-pa[1])*cuts[j-1]]),q=world([pa[0]+(pb[0]-pa[0])*cuts[j],pa[1]+(pb[1]-pa[1])*cuts[j]]);
      if(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-7)continue;
      writer.quad([[p[0],plan.eave,p[1]],[q[0],plan.eave,q[1]],[q[0],plan.height(q),q[1]],[p[0],plan.height(p),p[1]]],n.map(x=>x/len),wallColor,id);
    }
    }
  }
}
