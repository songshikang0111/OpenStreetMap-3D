import * as THREE from 'three';
import { inside } from './osm.js';

// Structural illustrations inferred from OSM centre lines and relative layers.
// No measured deck elevations, engineering spans or ramp gradients are implied.
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const at=(s,t,offset=0)=>[s.a[0]+s.direction[0]*t-s.direction[1]*offset,s.a[1]+s.direction[1]*t+s.direction[0]*offset];
export function segmentDistance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);}
const inBounds=(p,b,padding=0)=>p[0]>=b[0]+padding&&p[1]>=b[1]+padding&&p[0]<=b[2]-padding&&p[1]<=b[3]-padding;
const thickness=s=>s.walk?.38:Math.max(.65,Math.min(1.1,s.width*.065));
const crosses=(a,b,c,d)=>{const dx=b[0]-a[0],dz=b[1]-a[1],ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-9)return false;const x=c[0]-a[0],z=c[1]-a[1],t=(x*ez-z*ex)/den,u=(x*dz-z*dx)/den;return t>=0&&t<=1&&u>=0&&u<=1;};
function entersDeck(a,b,deck){
  const box=deck.bounds;
  if(Math.max(a[0],b[0])<box[0]||Math.min(a[0],b[0])>box[2]||Math.max(a[1],b[1])<box[1]||Math.min(a[1],b[1])>box[3])return false;
  return inside(a,deck.polygon)||inside(b,deck.polygon)||deck.polygon.some((c,i)=>crosses(a,b,c,deck.polygon[(i+1)%deck.polygon.length]));
}

export function supportClearance(point,radius,top,data,segments){
  for(const s of segments){
    if(s.y>=top-.15)continue;
    if(segmentDistance(point,s.a,s.b)<s.width/2+radius+.8)return s.walk?'pedestrian-clearance':'traffic-clearance';
  }
  for(const b of data.buildings||[]){
    if(b.minHeight>=top||b.height<=.32)continue;
    const rings=[b.outer,...(b.holes||[])];
    if(inside(point,b.outer)&&!(b.holes||[]).some(h=>inside(point,h)))return 'building-clearance';
    if(rings.some(r=>r.some((a,i)=>segmentDistance(point,a,r[(i+1)%r.length])<radius+.45)))return 'building-clearance';
  }
  if((data.water||[]).some(w=>inside(point,w.outer)&&!(w.holes||[]).some(h=>inside(point,h))))return 'water';
  return null;
}

export function planRoadStructures(data,roadPlan){
  const b=data.bounds||[-1e8,-1e8,1e8,1e8],bridges=roadPlan.segments.filter(s=>s.road.bridge);
  const deckSurfaces=roadPlan.surfaces.filter(s=>s.bridge&&s.kind!=='paving');
  const segmentsByRoad=new Map();for(const s of bridges){if(!segmentsByRoad.has(s.road.id))segmentsByRoad.set(s.road.id,[]);segmentsByRoad.get(s.road.id).push(s);}
  const stats={bridgeWays:segmentsByRoad.size,bridgeSegments:bridges.length,bridgeDecks:deckSurfaces.length,bridgePiers:0,bridgeSupportCandidates:0,bridgeGuardrailSegments:0,bridgeRailInteriorSkipped:0,bridgeRejectedSupports:{},unsupportedBridgeWays:0,bridgeHeightSource:'inferred-layer-times-7m',bridgeGradeConnectionsUnresolved:0};
  const reject=reason=>stats.bridgeRejectedSupports[reason]=(stats.bridgeRejectedSupports[reason]||0)+1;
  const decks=deckSurfaces.map(s=>{const seg=segmentsByRoad.get(s.roadId)[0];return {...s,thickness:thickness(seg),source:'inferred-deck-depth'};});
  const rails=[],piers=[],pierRoads=new Set();
  for(const s of bridges){
    const step=s.walk?3:7,railWidth=s.walk?.10:.28;
    for(const side of [-1,1])for(let start=0;start<s.length-.1;start+=step){
      const end=Math.min(start+step,s.length),offset=side*(s.width/2-railWidth/2-.025);
      const a=at(s,start,offset),c=at(s,end,offset);
      if(!inBounds(a,b,.2)||!inBounds(c,b,.2))continue;
      // Suppress barriers inside same-level junctions/overlapping bridge decks.
      const probeA=at(s,start+.01,side*(s.width/2+.12)),probeB=at(s,end-.01,side*(s.width/2+.12));
      const interior=deckSurfaces.some(d=>d.level===s.level&&entersDeck(probeA,probeB,d));
      if(interior){stats.bridgeRailInteriorSkipped++;continue;}
      rails.push({a,b:c,y:s.y,width:railWidth,walk:s.walk,roadId:s.road.id,source:'inferred-bridge-edge'});
    }
    const spacing=s.walk?22:36,first=spacing/2+Math.ceil((s.run-spacing/2)/spacing)*spacing-s.run;
    for(let t=Math.max(1,first);t<s.length-1;t+=spacing){
      const point=at(s,t),radius=s.walk?.32:Math.min(.95,Math.max(.55,s.width*.055)),top=s.y-thickness(s)-.35;
      stats.bridgeSupportCandidates++;
      const capRadius=Math.hypot(radius*1.15,Math.max(radius*2,Math.min(s.width*.7,9))/2);
      if(!inBounds(point,b,capRadius+.2)){reject('extract-boundary');continue;}
      if(piers.some(p=>dist(p.point,point)<Math.max(4,p.radius+radius+1))){reject('near-existing-support');continue;}
      const blocked=supportClearance(point,radius,top,data,roadPlan.segments)||supportClearance(point,capRadius,s.y-thickness(s),{buildings:(data.buildings||[]).filter(b=>b.height>top),water:[]},roadPlan.segments.filter(lower=>lower.y+4.8>top));
      if(blocked){reject(blocked);continue;}
      if(!decks.some(d=>Math.abs(d.y-s.y)<.01&&inside(point,d.polygon))){reject('outside-deck');continue;}
      piers.push({point,radius,top,deckBottom:s.y-thickness(s),width:s.width,angle:Math.atan2(-s.direction[1],s.direction[0]),roadId:s.road.id,walk:s.walk,source:'inferred-clearance-checked-support'});
      pierRoads.add(s.road.id);
    }
  }
  // Record shared endpoints at differing nominal heights; do not silently turn
  // relative OSM layer tags into fabricated ramp engineering.
  const endpoints=new Map();
  for(const s of roadPlan.segments)for(const p of [s.a,s.b]){const key=p.map(v=>v.toFixed(3)).join(',');if(!endpoints.has(key))endpoints.set(key,new Set());endpoints.get(key).add(s.y);}
  stats.bridgeGradeConnectionsUnresolved=[...endpoints.values()].filter(v=>v.size>1).length;
  stats.bridgeGuardrailSegments=rails.length;stats.bridgePiers=piers.length;
  stats.unsupportedBridgeWays=[...segmentsByRoad.keys()].filter(id=>!pierRoads.has(id)).length;
  return {decks,rails,piers,stats};
}

class StructureWriter{
  constructor(){this.positions=[];this.normals=[];this.colors=[];}
  triangle(a,b,c,color){
    const ab=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)),ac=new THREE.Vector3().subVectors(new THREE.Vector3(...c),new THREE.Vector3(...a)),n=ab.cross(ac);
    if(n.lengthSq()<1e-12)return;n.normalize();const rgb=new THREE.Color(color);
    for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(n.x,n.y,n.z);this.colors.push(rgb.r,rgb.g,rgb.b);}
  }
  quad(a,b,c,d,color){this.triangle(a,b,c,color);this.triangle(a,c,d,color);}
  box(center,size,angle,color){
    const c=Math.cos(angle),s=Math.sin(angle),p=([x,y,z])=>[center[0]+x*size[0]*c/2+z*size[2]*s/2,center[1]+y*size[1]/2,center[2]-x*size[0]*s/2+z*size[2]*c/2];
    const v=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p);
    for(const face of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]])this.quad(...face.map(i=>v[i]),color);
  }
  mesh(name,material,id){
    const geometry=new THREE.BufferGeometry(),ids=[];for(let i=0;i<this.positions.length/3;i++)ids.push((id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255);
    for(const [key,array]of [['position',this.positions],['normal',this.normals],['color',this.colors],['objectId',ids]])geometry.setAttribute(key,new THREE.Float32BufferAttribute(array,3));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.inkClass=4;mesh.userData.roadStructure=true;mesh.userData.procedural=true;return mesh;
  }
}

export function buildRoadStructures(data,roadPlan){
  const plan=planRoadStructures(data,roadPlan),group=new THREE.Group();group.name='Inferred bridge decks, guards and clearance-checked supports';
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94});
  const deckWriter=new StructureWriter(),railWriter=new StructureWriter(),pierWriter=new StructureWriter();
  for(const d of plan.decks){
    const top=d.y-.018,bottom=d.y-d.thickness,p=d.polygon;
    for(let i=1;i<p.length-1;i++){
      deckWriter.triangle([p[0][0],top,p[0][1]],[p[i+1][0],top,p[i+1][1]],[p[i][0],top,p[i][1]],'#a9aaa3');
      deckWriter.triangle([p[0][0],bottom,p[0][1]],[p[i][0],bottom,p[i][1]],[p[i+1][0],bottom,p[i+1][1]],'#969c97');
    }
    for(let i=0;i<p.length;i++){const a=p[i],c=p[(i+1)%p.length];deckWriter.quad([a[0],bottom,a[1]],[a[0],top,a[1]],[c[0],top,c[1]],[c[0],bottom,c[1]],'#b8b8ac');}
  }
  for(const r of plan.rails){
    const length=dist(r.a,r.b),angle=Math.atan2(-(r.b[1]-r.a[1]),r.b[0]-r.a[0]),center=[(r.a[0]+r.b[0])/2,0,(r.a[1]+r.b[1])/2];
    if(r.walk){
      for(const y of [.55,1.08])railWriter.box([center[0],r.y+y,center[2]],[length,.065,.065],angle,'#7d8986');
      railWriter.box([r.a[0],r.y+.55,r.a[1]],[.065,1.1,.065],angle,'#82908a');
      railWriter.box([center[0],r.y+.08,center[2]],[length,.16,.14],angle,'#c9c8b9');
    }else{
      railWriter.box([center[0],r.y+.38,center[2]],[length,.76,r.width],angle,'#c4c5b8');
      railWriter.box([center[0],r.y+.79,center[2]],[length,.07,r.width+.05],angle,'#d7d8ce');
    }
  }
  for(const p of plan.piers){
    const ground=.32,height=p.top-ground;
    pierWriter.box([p.point[0],ground+height/2,p.point[1]],[p.radius*1.4,height,p.radius*1.4],p.angle,'#b9b9aa');
    pierWriter.box([p.point[0],(p.top+p.deckBottom)/2,p.point[1]],[p.radius*2.3,p.deckBottom-p.top,Math.max(p.radius*2,Math.min(p.width*.7,9))],p.angle,'#bfc0b4');
  }
  for(const [writer,name,id]of [[deckWriter,'Bridge deck thickness and soffits',61001],[railWriter,'Bridge parapets and pedestrian guardrails',61002],[pierWriter,'Inferred bridge piers outside lower routes',61003]])if(writer.positions.length)group.add(writer.mesh(name,material,id));
  plan.stats.bridgeStructureTriangles=group.children.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0);
  return {group,plan,stats:plan.stats,dispose(){group.traverse(m=>m.geometry?.dispose());material.dispose();}};
}
