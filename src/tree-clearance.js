import { inside } from './osm.js';
import { roadHeightAt } from './road-grade.js';
import { roadStructureDimensions } from './road-structures.js';
import { crownEnvelope, crownProfile } from './foliage.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const distanceToSegment=(p,a,b)=>{
  const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
};
const polygonDistance=(p,polygon)=>inside(p,polygon)?0:Math.min(...polygon.map((a,i)=>distanceToSegment(p,a,polygon[(i+1)%polygon.length])));
const bounds=polygon=>polygon.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const strip=s=>{
  const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],length=Math.hypot(dx,dz);if(!length)return [];
  const normal=[-dz/length*s.width/2,dx/length*s.width/2];
  return [[s.a[0]+normal[0],s.a[1]+normal[1]],[s.b[0]+normal[0],s.b[1]+normal[1]],[s.b[0]-normal[0],s.b[1]-normal[1]],[s.a[0]-normal[0],s.a[1]-normal[1]]];
};
function segmentsCross(a,b,c,d){
  const dx=b[0]-a[0],dz=b[1]-a[1],ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;
  if(Math.abs(den)<1e-10)return false;
  const qx=c[0]-a[0],qz=c[1]-a[1],t=(qx*ez-qz*ex)/den,u=(qx*dz-qz*dx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1;
}
function capsuleOverlapsPolygon(a,b,radius,polygon){
  if(inside(a,polygon)||inside(b,polygon))return true;
  return polygon.some((c,i)=>{
    const d=polygon[(i+1)%polygon.length];
    return segmentsCross(a,b,c,d)||Math.min(distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b))<=radius;
  });
}

function heightInterval(structure,point,radius){
  const s=structure.surface,dx=(s.b?.[0]??0)-(s.a?.[0]??0),dz=(s.b?.[1]??0)-(s.a?.[1]??0),length=Math.hypot(dx,dz)||1;
  const ys=[-1,1].map(side=>roadHeightAt(s,[point[0]+side*dx/length*radius,point[1]+side*dz/length*radius]));
  return {bottom:Math.max(.18,Math.min(...ys)-structure.thickness-structure.stairAllowance),top:Math.max(...ys)+structure.railTop+structure.stairAllowance};
}

/**
 * Build one spatial query for every generated raised carriageway/walkway.
 * Joined deck polygons own their real plan footprint. Height bounds include
 * slab soffits and the rendered guardrails; ramps are bounded per short piece.
 * This is conservative clearance geometry, not a surveyed arboriculture model.
 */
export function treeStructureClearance(roadPlan){
  const byRoad=new Map(),segments=roadPlan?.segments||[];
  for(const s of segments)if(!byRoad.has(s.road.id))byRoad.set(s.road.id,s);
  const raised=s=>s.stairFlight||s.bridge||s.road?.bridge||Math.max(s.yA??s.y,s.yB??s.y)>.65;
  // Pure grade fixtures may omit surfaces; the renderer's normal path always
  // supplies its clipped/mitered surface polygons, including junction joins.
  const surfaces=Array.isArray(roadPlan?.surfaces)?roadPlan.surfaces.filter(s=>s.kind!=='paving'&&raised(s)):
    segments.filter(raised).map(s=>({...s,roadId:s.road.id,polygon:strip(s)}));
  const cellSize=32,cells=new Map(),structures=[];
  for(const surface of surfaces){
    const segment=byRoad.get(surface.roadId)||surface,polygon=surface.polygon;
    if(!polygon?.length)continue;
    const walk=surface.walk??segment.walk??surface.kind==='walk',stairFlight=surface.stairFlight||segment.stairFlight;
    const dims=roadStructureDimensions({width:segment.width,walk,stairFlight});
    const heights=polygon.map(p=>roadHeightAt(surface,p)).filter(Number.isFinite);if(!heights.length)continue;
    // Stair treads can be one riser above their interpolated grade plane.
    const item={polygon,bounds:bounds(polygon),surface,thickness:dims.thickness,railTop:dims.railTop,stairAllowance:stairFlight?.17:0,kind:walk?'pedestrian':'vehicle',roadId:surface.roadId};
    structures.push(item);
    for(let x=Math.floor(item.bounds[0]/cellSize);x<=Math.floor(item.bounds[2]/cellSize);x++)for(let z=Math.floor(item.bounds[1]/cellSize);z<=Math.floor(item.bounds[3]/cellSize);z++){
      const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);
    }
  }
  return tree=>{
    if(!structures.length||!Number.isFinite(tree.h))return null;
    const point=[tree.x,tree.z],envelope=Number.isFinite(tree.crownBottom+tree.crownTop)?{bottom:tree.crownBottom,top:tree.crownTop,radius:tree.radius}:crownEnvelope(tree);
    const radius=Number.isFinite(tree.radius)?tree.radius:envelope.radius,margin=.18,nearby=new Set();
    for(let x=Math.floor((tree.x-radius-margin)/cellSize);x<=Math.floor((tree.x+radius+margin)/cellSize);x++)for(let z=Math.floor((tree.z-radius-margin)/cellSize);z<=Math.floor((tree.z+radius+margin)/cellSize);z++)for(const s of cells.get(`${x},${z}`)||[])nearby.add(s);
    let branches;
    for(const structure of nearby){
      const distance=polygonDistance(point,structure.polygon);
      if(distance>radius+margin)continue;
      const interval=heightInterval(structure,point,radius+margin);
      if(interval.top+margin>=envelope.bottom&&interval.bottom-margin<=envelope.top)return {...structure,part:'crown'};
      // A crown can clear a low bridge while its trunk still pierces the deck.
      // Conversely, a tree beside that bridge with crown above the parapet is
      // valid; do not delete it merely because the plan-view discs overlap.
      const trunkTop=tree.h*.56+.35,trunkRadius=tree.h*.016;
      const stemInterval=heightInterval(structure,point,trunkRadius+margin);
      if(distance<=trunkRadius+margin&&stemInterval.bottom<=trunkTop+margin&&stemInterval.top>=.35-margin)return {...structure,part:'trunk'};
      if(interval.top<tree.h*.39+.35-margin||interval.bottom>envelope.top+margin)continue;
      branches??=crownProfile({...tree,rotation:tree.rotation??0}).branches;
      for(const branch of branches){
        const pad=branch.radius+margin,dy=branch.b[1]-branch.a[1];
        let lo=0,hi=1;
        if(Math.abs(dy)<1e-8){if(branch.a[1]<interval.bottom-pad||branch.a[1]>interval.top+pad)continue;}
        else{const ts=[(interval.bottom-pad-branch.a[1])/dy,(interval.top+pad-branch.a[1])/dy].sort((a,b)=>a-b);lo=Math.max(0,ts[0]);hi=Math.min(1,ts[1]);if(hi<lo)continue;}
        const at=t=>[branch.a[0]+(branch.b[0]-branch.a[0])*t,branch.a[2]+(branch.b[2]-branch.a[2])*t];
        if(capsuleOverlapsPolygon(at(lo),at(hi),pad,structure.polygon))return {...structure,part:'branch'};
      }
    }
    return null;
  };
}
