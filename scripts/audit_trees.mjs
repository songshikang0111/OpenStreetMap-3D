// CPU audit of planting and rendered distant-canopy geometry. Not GPU FPS.
// An optional --root allows the exact same audit to run against a frozen source checkout.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const module=async name=>import(pathToFileURL(path.join(root,'src',name+'.js')).href);
const [{parseOSM,mergeOSMOverlay,inside},{planRoadSurface},{planLandscape},{planStreetLife,segmentDistance},foliage,{roadHeightAt}]=await Promise.all(['osm','road-surface','landscape-plan','streetlife','foliage','road-grade'].map(module));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'public/data',name+'.json'),'utf8'));
const raw=read('beijing-cbd');for(const name of ['street-details','landscape-details'])mergeOSMOverlay(raw,read(name),name);
const profile=read('landscape-profile'),data=parseOSM(raw),start=performance.now(),roads=planRoadSurface(data),landscape=planLandscape(data,{roadPlan:roads,profile}),plan=planStreetLife(data,{roadPlan:roads,landscapeTrees:landscape.trees});
const generationMs=Math.round(performance.now()-start),trees=plan.trees;
const at=(point,poly)=>inside(point,poly.outer)&&!(poly.holes||[]).some(h=>inside(point,h));
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
const hull=points=>{
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const lower=[],upper=[];
  for(const p of points){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of [...points].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
};
const geometry=foliage.crownGeometry(),positions=geometry.attributes.position;
const silhouettes=trees.map(tree=>{
  const base=foliage.crownBase(tree),c=Math.cos(base.angle),s=Math.sin(base.angle),points=[];
  for(let i=0;i<positions.count;i++){const x=positions.getX(i)*base.scale[0],z=positions.getZ(i)*base.scale[2];points.push([base.position[0]+x*c+z*s,base.position[2]-x*s+z*c]);}
  return hull(points);
});
geometry.dispose();
const overlap=(a,b)=>{
  for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],axis=[p[1]-q[1],q[0]-p[0]];
    const first=a.map(v=>v[0]*axis[0]+v[1]*axis[1]),second=b.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    if(Math.max(...first)<Math.min(...second)-1e-7||Math.max(...second)<Math.min(...first)-1e-7)return false;
  }
  return true;
};
const cells=new Map(),cellKey=(x,z)=>`${x},${z}`,cell=24;
trees.forEach((t,i)=>{const key=cellKey(Math.floor(t.x/cell),Math.floor(t.z/cell));if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);});
const touching=new Set(),parents=trees.map((_,i)=>i),nearest=trees.map(()=>Infinity),find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));let pairs=0;
for(let i=0;i<trees.length;i++){
  const t=trees[i],cx=Math.floor(t.x/cell),cz=Math.floor(t.z/cell);
  for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const j of cells.get(cellKey(x,z))||[]){
    if(j<=i)continue;const u=trees[j],d=Math.hypot(t.x-u.x,t.z-u.z);nearest[i]=Math.min(nearest[i],d);nearest[j]=Math.min(nearest[j],d);
    if(d>22||!overlap(silhouettes[i],silhouettes[j]))continue;
    pairs++;touching.add(i);touching.add(j);parents[find(j)]=find(i);
  }
}
const components=new Map();trees.forEach((_,i)=>components.set(find(i),(components.get(find(i))||0)+1));
const counts={};trees.forEach((t,i)=>{counts[t.source]??={trees:0,withTouchingCrown:0};counts[t.source].trees++;if(touching.has(i))counts[t.source].withTouchingCrown++;});
for(const value of Object.values(counts))value.touchFraction=value.withTouchingCrown/value.trees;
const blocked=[...(data.water||[]),...(data.landscapes||[]).filter(p=>['parking','sport','construction','plaza','soil'].includes(p.kind))];
const footpaths=data.roads.filter(r=>!r.bridge&&/footway|path|steps|pedestrian|cycleway/.test(r.type));
const drive=data.roads.filter(r=>!r.bridge&&!r.tunnel&&r.layer>=0&&!/footway|path|steps|pedestrian|cycleway|corridor/.test(r.type));
const elevated=roads.segments.filter(s=>s.road.bridge||s.stairFlight||Math.max(s.yA??s.y,s.yB??s.y)>.65);
const conflicts={blockedGroundRoots:0,footpathRoots:0,carriagewayRoots:0,buildingCanopyEnvelope:0,farCrownVehicleDeckCrossings:0,farCrownPedestrianDeckCrossings:0};
for(const t of trees.filter(t=>t.source!=='osm')){
  const p=[t.x,t.z];
  if(blocked.some(poly=>at(p,poly)))conflicts.blockedGroundRoots++;
  if(footpaths.some(r=>r.segments.some(([a,b])=>segmentDistance(p,a,b)<r.width/2+1-1e-6)))conflicts.footpathRoots++;
  if(drive.some(r=>r.segments.some(([a,b])=>segmentDistance(p,a,b)<r.width/2+.65-1e-6)))conflicts.carriagewayRoots++;
  if(data.buildings.some(poly=>at(p,poly)||[poly.outer,...(poly.holes||[])].some(ring=>ring.some((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])<t.radius-1e-6))))conflicts.buildingCanopyEnvelope++;
  // Independent geometry check: intersect actual far-crown triangle edges
  // with raised deck top/soffit planes, then require the hit to fall within
  // that segment's length and full width. This deliberately does not call
  // the engine's conservative tree-clearance helper.
  const candidates=elevated.filter(s=>segmentDistance(p,s.a,s.b)<s.width/2+t.radius+.3);
  if(candidates.length){
    const base=foliage.crownBase(t),c=Math.cos(base.angle),sine=Math.sin(base.angle),vertices=[];
    for(let i=0;i<positions.count;i++){const x=positions.getX(i)*base.scale[0],z=positions.getZ(i)*base.scale[2];vertices.push([base.position[0]+x*c+z*sine,base.position[1]+positions.getY(i)*base.scale[1],base.position[2]-x*sine+z*c]);}
    const lower=Math.min(...vertices.map(p=>p[1])),upper=Math.max(...vertices.map(p=>p[1])),found=new Set();
    for(const segment of candidates){
      const kind=segment.walk?'farCrownPedestrianDeckCrossings':'farCrownVehicleDeckCrossings';if(found.has(kind))continue;
      const depth=segment.stairFlight?.24:segment.walk?.38:Math.max(.65,Math.min(1.1,segment.width*.065));
      if(Math.max(segment.yA,segment.yB)<lower||Math.min(segment.yA,segment.yB)-depth>upper)continue;
      const dx=segment.b[0]-segment.a[0],dz=segment.b[1]-segment.a[1],length=Math.hypot(dx,dz),direction=[dx/length,dz/length];
      let hit=false;
      for(let i=0;i<vertices.length&&!hit;i+=3)for(const [a,b]of [[vertices[i],vertices[i+1]],[vertices[i+1],vertices[i+2]],[vertices[i+2],vertices[i]]])for(const offset of [0,-depth]){
        const height=p=>Math.max(offset<0?.18:-Infinity,roadHeightAt(segment,[p[0],p[2]])+offset),qa=a[1]-height(a),qb=b[1]-height(b);
        if(qa*qb>0||Math.abs(qa-qb)<1e-9)continue;
        const f=qa/(qa-qb),x=a[0]+(b[0]-a[0])*f-segment.a[0],z=a[2]+(b[2]-a[2])*f-segment.a[1];
        const along=x*direction[0]+z*direction[1],across=-x*direction[1]+z*direction[0];
        if(along>=-1e-6&&along<=length+1e-6&&Math.abs(across)<=segment.width/2+1e-6){hit=true;break;}
      }
      if(hit){found.add(kind);conflicts[kind]++;}
    }
  }
}
const shapes={};for(const t of trees)shapes[t.shape]=(shapes[t.shape]||0)+1;
console.log(JSON.stringify({generatedAt:new Date().toISOString(),sourceRoot:root,scope:'CPU planning and opaque full-size far-crown convex footprints projected onto the ground; contact is a geometry proxy, not leaf coverage, observed vegetation or GPU FPS.',generationMs,trees:trees.length,stats:plan.stats,shapes,landscapeCandidates:landscape.trees.length,connectivity:{touchingTrees:touching.size,touchFraction:touching.size/trees.length,overlappingPairs:pairs,largestGroup:Math.max(...components.values()),groupsOfAtLeastThree:[...components.values()].filter(n=>n>=3).length,minimumRootSpacing:Math.min(...nearest),bySource:counts},conflicts},null,2));
