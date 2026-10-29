import * as THREE from 'three';

// Stair paths come from OSM highway=steps. Only their vertical dimensions are
// inferred by the shared road grade graph; this module never invents a route.
const EPS = 1e-7;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const atHeight = (p, y) => [p[0], y, p[1]];

class Writer {
  constructor() { this.positions = []; this.normals = []; this.colors = []; }
  triangle(a, b, c, color) {
    const p = new THREE.Vector3(...a), n = new THREE.Vector3(...b).sub(p).cross(new THREE.Vector3(...c).sub(p));
    if (n.lengthSq() < 1e-14) return;
    n.normalize(); const rgb = new THREE.Color(color);
    for (const v of [a, b, c]) { this.positions.push(...v); this.normals.push(...n); this.colors.push(rgb.r, rgb.g, rgb.b); }
  }
  quad(a, b, c, d, color) { this.triangle(a, b, c, color); this.triangle(a, c, d, color); }
  beam(a, b, radius, color) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), axis = end.clone().sub(start);
    if (axis.lengthSq() < EPS) return;
    axis.normalize();
    const side = Math.hypot(axis.x, axis.z) > EPS ? new THREE.Vector3(-axis.z, 0, axis.x).normalize() : new THREE.Vector3(1, 0, 0);
    const vertical = side.clone().cross(axis).normalize();
    const corners = center => [[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,u]) => center.clone().addScaledVector(side, s*radius).addScaledVector(vertical, u*radius).toArray());
    const x = corners(start), y = corners(end);
    // side x vertical = -axis: start cap points outward.
    this.quad(...x, color); this.quad(y[3], y[2], y[1], y[0], color);
    for (let i=0; i<4; i++) { const j=(i+1)%4; this.quad(x[i], y[i], y[j], x[j], color); }
  }
  mesh(name, material, id, inkClass) {
    if (!this.positions.length) return null;
    const geometry = new THREE.BufferGeometry(), ids = [];
    for (let i=0; i<this.positions.length/3; i++) ids.push((id&255)/255, ((id>>8)&255)/255, ((id>>16)&255)/255);
    for (const [key, values] of [['position',this.positions],['normal',this.normals],['color',this.colors],['objectId',ids]]) geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,3));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name=name; mesh.castShadow=true; mesh.receiveShadow=true;
    Object.assign(mesh.userData,{inkClass,procedural:true,roadStructure:true,roadStairs:true});
    return mesh;
  }
}

function normaliseFlight(flight) {
  if (!Number.isFinite(flight.y0 + flight.y1 + flight.width) || flight.width <= 0 || Math.abs(flight.y1-flight.y0) < .04) return null;
  const points = (flight.points || []).filter((p,i,a) => p?.length===2 && p.every(Number.isFinite) && (!i || distance(p,a[i-1])>.001)).map(p=>[...p]);
  if (points.length<2) return null;
  let y0=flight.y0, y1=flight.y1;
  // Low-to-high canonical orientation makes descending ways identical to an
  // equivalent reversed OSM way, including tread placement and railing posts.
  if (y0>y1) { points.reverse(); [y0,y1]=[y1,y0]; }
  const distances=[0];
  for (let i=1;i<points.length;i++) distances.push(distances.at(-1)+distance(points[i-1],points[i]));
  const length=distances.at(-1);
  if (length<.2) return null;
  const landing=Math.min(.85,flight.width*.45,length*.12), count=Math.min(512,Math.max(1,Math.ceil((y1-y0)/.17)));
  return {key:flight.key,points,distances,length,y0,y1,width:flight.width,landing,count,rise:(y1-y0)/count,depth:(length-landing*2)/count,roadIds:flight.roadIds||[]};
}

function section(flight, t, width=flight.width) {
  const {points,distances,length}=flight; t=clamp(t,0,length);
  let index=0;
  while(index<points.length-2 && distances[index+1]<t-EPS) index++;
  const a=points[index],b=points[index+1],span=distances[index+1]-distances[index],f=(t-distances[index])/span;
  const point=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],direction=[(b[0]-a[0])/span,(b[1]-a[1])/span];
  let normal=[-direction[1],direction[0]],miter=1;
  // A shared bounded miter cross-section keeps neighbouring pieces connected
  // at a bend, instead of independent square-ended stair boxes.
  const corner=Math.abs(t-distances[index+1])<EPS?index+1:Math.abs(t-distances[index])<EPS?index:-1;
  if(corner>0 && corner<points.length-1) {
    const before=points[corner-1],p=points[corner],after=points[corner+1],la=distance(before,p),lb=distance(p,after);
    const n0=[-(p[1]-before[1])/la,(p[0]-before[0])/la],n1=[-(after[1]-p[1])/lb,(after[0]-p[0])/lb];
    const sum=[n0[0]+n1[0],n0[1]+n1[1]],norm=Math.hypot(...sum);
    if(norm>.01) { normal=sum.map(x=>x/norm); miter=Math.min(2,1/Math.max(.1,normal[0]*n0[0]+normal[1]*n0[1])); }
  }
  const offset=width*.5*miter;
  return {point,left:[point[0]+normal[0]*offset,point[1]+normal[1]*offset],right:[point[0]-normal[0]*offset,point[1]-normal[1]*offset]};
}

const rampHeight=(f,t)=>f.y0+(f.y1-f.y0)*clamp((t-f.landing)/(f.length-2*f.landing),0,1);
function treadHeight(f,t) {
  if(t<f.landing-EPS)return f.y0;
  if(t>=f.length-f.landing-EPS)return f.y1;
  return f.y0+Math.min(f.count,Math.floor((t-f.landing)/f.depth)+1)*f.rise;
}

/** Build bounded, merged tread/riser and handrail geometry on known stair paths. */
export function buildRoadStairs(flights=[]) {
  const group=new THREE.Group();group.name='OSM stair access with inferred connected elevations';
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94});
  const treads=new Writer(),shell=new Writer(),rails=new Writer();
  const stats={stairFlights:0,stairTreads:0,stairPosts:0,stairTriangles:0,stairSkippedFlights:0,stairSteepFlights:0,stairHeightSource:'shared-road-grade-inference'};
  const metadata=[];
  for(const original of [...flights].sort((a,b)=>String(a.key).localeCompare(String(b.key)))) {
    const f=normaliseFlight(original);
    if(!f){stats.stairSkippedFlights++;continue;}
    stats.stairFlights++; stats.stairTreads+=f.count;
    if(f.depth<.22 || f.rise>.19) stats.stairSteepFlights++;
    const cuts=[0,f.landing,f.length-f.landing,f.length,...f.distances];
    for(let i=1;i<f.count;i++)cuts.push(f.landing+i*f.depth);
    cuts.sort((a,b)=>a-b);
    const sorted=cuts.filter((x,i)=>!i||x-cuts[i-1]>EPS);
    for(let i=0;i<sorted.length-1;i++) {
      const start=sorted[i],end=sorted[i+1],a=section(f,start),b=section(f,end),top=treadHeight(f,(start+end)/2);
      const bottomA=rampHeight(f,start)-.24,bottomB=rampHeight(f,end)-.24;
      const al=atHeight(a.left,top),ar=atHeight(a.right,top),bl=atHeight(b.left,top),br=atHeight(b.right,top);
      // left is the +z side for a +x flight: left→right→forward points up.
      treads.quad(al,bl,br,ar,'#d0ccbc');
      shell.quad(atHeight(a.left,bottomA),atHeight(a.right,bottomA),atHeight(b.right,bottomB),atHeight(b.left,bottomB),'#969c97');
      shell.quad(atHeight(a.left,bottomA),atHeight(b.left,bottomB),bl,al,'#b8b8ac');
      shell.quad(atHeight(a.right,bottomA),ar,br,atHeight(b.right,bottomB),'#b8b8ac');
      const previous=i?treadHeight(f,(sorted[i-1]+start)/2):bottomA;
      if(top>previous+EPS) shell.quad(atHeight(a.left,previous),al,ar,atHeight(a.right,previous),'#b8b8ac');
      if(i===sorted.length-2) shell.quad(atHeight(b.left,bottomB),atHeight(b.right,bottomB),br,bl,'#b8b8ac');
    }
    const postCuts=[0,f.landing,f.length-f.landing,f.length,...f.distances];
    const postSpacing=Math.max(1.5,f.length/512);
    for(let t=postSpacing;t<f.length;t+=postSpacing)postCuts.push(t);
    postCuts.sort((a,b)=>a-b);
    const posts=postCuts.filter((x,i)=>!i||x-postCuts[i-1]>.05);
    for(const side of ['left','right']) {
      for(let i=0;i<posts.length;i++) {
        const t=posts[i],p=section(f,t,Math.max(.15,f.width-.14))[side],base=rampHeight(f,t);
        rails.beam(atHeight(p,treadHeight(f,t)+.015),atHeight(p,base+1.08),.0325,'#82908a'); stats.stairPosts++;
        if(i){const q=section(f,posts[i-1],Math.max(.15,f.width-.14))[side],y=rampHeight(f,posts[i-1]);
          for(const height of [.55,1.08]) rails.beam(atHeight(q,y+height),atHeight(p,base+height),.0325,'#7d8986');
        }
      }
    }
    metadata.push({key:f.key,start:[...f.points[0]],end:[...f.points.at(-1)],y0:f.y0,y1:f.y1,length:f.length,landing:f.landing,count:f.count,rise:f.rise,depth:f.depth,roadIds:f.roadIds});
  }
  for(const [writer,name,id,inkClass]of [[treads,'Stair treads and endpoint landings',61101,3.2],[shell,'Stair risers, sides and soffits',61102,4],[rails,'Continuous stair handrails and posts',61103,4]]) {
    const mesh=writer.mesh(name,material,id,inkClass);if(mesh)group.add(mesh);
  }
  stats.stairTriangles=group.children.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0);
  group.userData.stairFlights=metadata;
  return {group,stats,dispose(){group.traverse(m=>m.geometry?.dispose());material.dispose();}};
}
