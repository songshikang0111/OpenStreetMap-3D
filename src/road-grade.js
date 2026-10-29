// Illustrative longitudinal profiles, not surveyed engineering elevations.
// Only shared OSM nodes connect roads. Geometric crossings constrain deck
// clearance, but never introduce routing edges between separate roads.
export const ROAD_GRADE = { spacing: 4, vehicleTransition: 90, walkingTransition: 28, warningGrade: .12 };
const WALK = /^(footway|path|steps|pedestrian|cycleway)$/;
const clamp = (x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const distance = (a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const pointAt = (a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const coordKey = p=>p.map(x=>x.toFixed(5)).join(',');
export const nominalRoadHeight = r=>r.bridge?7*Math.max(1,r.layer||1):WALK.test(r.type)&&r.tags?.footway!=='crossing'?.47:.32;

/** Sample the actual linear surface plane, including across its width. */
export function roadHeightAt(s,p){
  if(!s.a || !Number.isFinite(s.yA))return s.y;
  const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1];
  const t=clamp(((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dz)/(dx*dx+dz*dz||1));
  return s.yA+(s.yB-s.yA)*t+(s.heightOffset||0);
}

function crossing(a,b){
  const dx=a.b[0]-a.a[0],dz=a.b[1]-a.a[1],ex=b.b[0]-b.a[0],ez=b.b[1]-b.a[1],den=dx*ez-dz*ex;
  if(Math.abs(den)<1e-8)return null;
  const qx=b.a[0]-a.a[0],qz=b.a[1]-a.a[1],t=(qx*ez-qz*ex)/den,u=(qx*dz-qz*dx)/den;
  if(t<0||t>1||u<0||u>1)return null;
  return {t,u,sine:Math.abs(den)/(a.length*b.length)};
}

export function planRoadGrades(data, options={}){
  const settings={...ROAD_GRADE,...options},nodes=new Map(),sources=[],edges=[],byRoad=new Map();
  const stats={gradeSource:'OSM connectivity + inferred layer heights',gradeOriginalDiscontinuities:0,gradeResolvedConnections:0,gradeChangedWays:0,gradeMaxVehicleSlope:0,gradeSteepVehicleRuns:0,gradeCrossingConstraints:0,gradeRemainingDiscontinuities:0};
  const getNode=(key,p)=>{if(!nodes.has(key))nodes.set(key,{key,point:p,edges:[],nominals:[],fixed:true,y:0});return nodes.get(key);};
  for(const road of [...data.roads].sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
    if(!(road.width>0)||road.layer<0||road.tags?.tunnel==='yes')continue;
    const list=[];byRoad.set(road.id,list);
    for(let i=0;i<road.segments.length;i++){
      const [a,b]=road.segments[i],length=distance(a,b);
      if(![...a,...b].every(Number.isFinite)||length<.01)continue;
      const endpointKey=(p,j)=>road.segmentNodes
        ? road.segmentNodes[i]?.[j]!=null?`osm:${road.segmentNodes[i][j]}`:`clip:${road.id}:${coordKey(p)}`
        : `synthetic:${WALK.test(road.type)?'walk':'drive'}:${coordKey(p)}`;
      const keys=[endpointKey(a,0),endpointKey(b,1)],nominal=nominalRoadHeight(road),count=Math.ceil(length/settings.spacing),sample=[];
      const source={a,b,length,road,nominal,keys,sample};sources.push(source);
      for(let j=0;j<=count;j++){
        const p=pointAt(a,b,j/count),key=j===0?keys[0]:j===count?keys[1]:`sample:${road.id}:${i}:${j}`;
        const n=getNode(key,p);sample.push(n);
        if(j){const prev=sample[j-1],edge={a:prev,b:n,length:length/count,road,nominal,source};edges.push(edge);list.push(edge);prev.edges.push(edge);n.edges.push(edge);}
      }
    }
  }
  const other=(e,n)=>e.a===n?e.b:e.a;
  const baseFor=n=>{
    const drive=n.edges.filter(e=>!WALK.test(e.road.type)),nonSteps=n.edges.filter(e=>e.road.type!=='steps'),chosen=drive.length?drive:nonSteps.length?nonSteps:n.edges;
    return Math.max(...chosen.map(e=>e.nominal));
  };
  const transitions=[];
  for(const n of nodes.values()){
    const values=[...new Set(n.edges.map(e=>e.nominal))];n.nominals=values;n.y=baseFor(n);
    if(values.length>1&&Math.max(...values)-Math.min(...values)>1){transitions.push(n);stats.gradeOriginalDiscontinuities++;}
    // Stair free ends land on existing ground. OSM bridge=yes describes the
    // structure, not a constant elevation for the whole stair flight.
    if(n.edges.every(e=>e.road.type==='steps')){n.fixed=n.edges.length!==2;n.y=.47;}
  }
  // Free a bounded neighbourhood on both sides, including nearby branches.
  // A short service spur or clipped map edge is not a measured ground anchor.
  for(const start of transitions){
    const allowed=start.edges.filter(e=>e.road.type!=='steps');
    if(allowed.length<2)continue;
    const pedestrian=!allowed.some(e=>e.road.bridge&&!WALK.test(e.road.type));
    const radius=pedestrian?settings.walkingTransition:Math.max(settings.vehicleTransition,(Math.max(...start.nominals)-Math.min(...start.nominals))*1.5/.10);
    const best=new Map([[start.key,0]]),queue=[[start,0]];
    while(queue.length){
      queue.sort((a,b)=>b[1]-a[1]);const [n,d]=queue.pop();if(d>best.get(n.key)+1e-8)continue;
      const usable=n.edges.filter(e=>e.road.type!=='steps');
      // A pedestrian bridge cannot hoist a connected residential carriageway.
      // Its existing footpath/steps must absorb the rise instead.
      if(pedestrian&&usable.some(e=>!WALK.test(e.road.type))){n.fixed=true;n.y=baseFor(n);continue;}
      if(d>=radius)continue;
      n.fixed=false;
      for(const e of usable){const next=other(e,n),nd=d+e.length;if(nd<radius+settings.spacing&&nd<(best.get(next.key)??Infinity)){best.set(next.key,nd);queue.push([next,nd]);}}
    }
  }
  // Crossing footprints constrain clearance, not exact deck elevations. An
  // ascending slip road may be higher than its nominal layer at an underpass.
  const crossingConstraints=[];
  for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++){
    const a=sources[i],b=sources[j];
    if(a.road.type==='steps'||b.road.type==='steps'||Math.abs(a.nominal-b.nominal)<1||a.keys.some(k=>b.keys.includes(k)))continue;
    if(Math.max(a.a[0],a.b[0])<Math.min(b.a[0],b.b[0])||Math.max(b.a[0],b.b[0])<Math.min(a.a[0],a.b[0])||Math.max(a.a[1],a.b[1])<Math.min(b.a[1],b.b[1])||Math.max(b.a[1],b.b[1])<Math.min(a.a[1],a.b[1]))continue;
    const c=crossing(a,b);if(!c)continue;
    const samples=[];
    for(const [s,lower,t]of [[a,b,c.t],[b,a,c.u]]){
      const reach=(lower.road.width/2+s.road.width/2+2)/Math.max(.08,c.sine)+settings.spacing;
      samples.push(s.sample.filter((n,k)=>Math.abs(k/(s.sample.length-1)-t)*s.length<=reach));
      s.sample.forEach((n,k)=>{if(Math.abs(k/(s.sample.length-1)-t)*s.length<=reach){
        if(s.nominal>lower.nominal)n.lowerBound=Math.max(n.lowerBound??0,s.nominal);
        else n.upperBound=Math.min(n.upperBound??Infinity,lower.nominal-5.8);
      }});
    }
    crossingConstraints.push({aRoad:a.road.id,bRoad:b.road.id,point:pointAt(a.a,a.b,c.t),aY:a.nominal,bY:b.nominal,samples});
  }
  stats.gradeCrossingConstraints=crossingConstraints.length;
  // Preserve a core in each connected same-height bridge component, including
  // spans over missing waterways. Smoothing must not collapse a short bridge.
  const visited=new Set();
  for(const seed of nodes.values()){
    const bridgeEdges=seed.edges.filter(e=>e.road.bridge&&e.road.type!=='steps');
    for(const first of bridgeEdges){
      const componentKey=`${first.nominal}:${seed.key}`;if(visited.has(componentKey))continue;
      const component=[],queue=[seed],distances=new Map();
      while(queue.length){const n=queue.pop(),key=`${first.nominal}:${n.key}`;if(visited.has(key))continue;visited.add(key);component.push(n);for(const e of n.edges)if(e.road.bridge&&e.road.type!=='steps'&&e.nominal===first.nominal)queue.push(other(e,n));}
      const boundary=component.filter(n=>n.edges.some(e=>!e.road.bridge||e.nominal!==first.nominal||e.road.type==='steps'));
      const work=boundary.map(n=>{distances.set(n.key,0);return [n,0];});
      while(work.length){work.sort((a,b)=>b[1]-a[1]);const [n,d]=work.pop();if(d>distances.get(n.key))continue;for(const e of n.edges){if(!e.road.bridge||e.road.type==='steps'||e.nominal!==first.nominal)continue;const next=other(e,n),nd=d+e.length;if(nd<(distances.get(next.key)??Infinity)){distances.set(next.key,nd);work.push([next,nd]);}}}
      if(boundary.length){component.sort((a,b)=>(distances.get(b.key)||0)-(distances.get(a.key)||0)||a.key.localeCompare(b.key));component[0].fixed=true;component[0].y=first.nominal;}
    }
  }
  // Non-step routes anchor stair junctions. This also catches the middle node
  // of a three-node, two-wing stair way whose ends both touch the sidewalk.
  for(const n of nodes.values())if(n.edges.some(e=>e.road.type==='steps')&&n.edges.some(e=>e.road.type!=='steps')){n.fixed=true;n.y=baseFor(n);}
  const ordered=[...nodes.values()].sort((a,b)=>a.key.localeCompare(b.key));
  for(let pass=0;pass<5000;pass++){
    let delta=0;
    for(const n of ordered){if(n.fixed)continue;let sum=0,weight=0;for(const e of n.edges){const w=1/e.length;sum+=other(e,n).y*w;weight+=w;}const y=clamp(sum/weight,n.lowerBound??0,n.upperBound??Infinity);delta=Math.max(delta,Math.abs(y-n.y));n.y=y;}
    if(delta<1e-8)break;
  }
  // Replace linear graph solutions by monotone C1 transitions between fixed
  // constraints. Stair flights keep a straight pitch and get actual treads.
  const chains=[],seenEdges=new Set(),anchor=n=>n.fixed||n.edges.length!==2||Math.abs(n.y-(n.lowerBound??-1))<1e-6||Math.abs(n.y-(n.upperBound??-1))<1e-6;
  for(const n of ordered){if(!anchor(n))continue;for(const edge of n.edges){if(seenEdges.has(edge))continue;
    const path=[n],chainEdges=[];let cur=n,e=edge;
    while(e&&!seenEdges.has(e)){seenEdges.add(e);chainEdges.push(e);cur=other(e,cur);path.push(cur);if(anchor(cur))break;e=cur.edges.find(x=>x!==e);}
    const length=chainEdges.reduce((s,e)=>s+e.length,0),stairs=chainEdges.every(e=>e.road.type==='steps'),y0=n.y,y1=cur.y;
    let run=0;
    if(path.some(p=>!p.fixed))for(let i=1;i<path.length-1;i++){run+=chainEdges[i-1].length;const t=run/length;path[i].y=y0+(y1-y0)*(stairs?t:t*t*(3-2*t));}
    chains.push({path,edges:chainEdges,length,stairs,y0,y1});
  }}
  // Final relative constraints use actual elevations. Absolute layer-based
  // ceilings are insufficient when the underpassing approach itself rises.
  // The least upward closure of these difference constraints simultaneously
  // bounds driving slopes and keeps decks above the complete crossing width.
  const constraints=[];
  for(const e of edges)if(!WALK.test(e.road.type)||e.road.bridge&&e.road.type!=='steps'){
    const fall=e.length*.10;constraints.push([e.a,e.b,-fall],[e.b,e.a,-fall]);
  }
  let ambiguous=0;
  for(const c of crossingConstraints){
    const [upper,lower]=c.aY>c.bY?c.samples:[c.samples[1],c.samples[0]];
    if(upper.some(n=>lower.includes(n))){ambiguous++;continue;}
    const proxy={y:Math.max(...lower.map(n=>n.y))};
    for(const n of lower)constraints.push([n,proxy,0]);
    for(const n of upper)constraints.push([proxy,n,5.95]);
  }
  let iterations=0,delta=0;
  for(;iterations<600;iterations++){
    delta=0;
    for(const [a,b,rise]of constraints){const y=a.y+rise;if(y>b.y+1e-8){delta=Math.max(delta,y-b.y);b.y=y;}}
    if(delta<1e-7)break;
    if(Math.max(...ordered.map(n=>n.y))>120)throw new Error('Road grade constraints conflict: check connected crossings before rendering.');
  }
  stats.gradeConstraintIterations=iterations;stats.gradeConstraintConflicts=delta>=1e-7?1:0;stats.gradeAmbiguousCrossings=ambiguous;
  // Stair pitches use the final platform heights after clearance adjustment.
  for(const c of chains)if(c.stairs){c.y0=c.path[0].y;c.y1=c.path.at(-1).y;let run=0;for(let i=1;i<c.path.length-1;i++){run+=c.edges[i-1].length;c.path[i].y=c.y0+(c.y1-c.y0)*run/c.length;}}
  const stairs=[];
  for(const c of chains)if(c.stairs&&Math.abs(c.y1-c.y0)>.1){
    let run=0;const distances=c.path.map((_,i)=>i?(run+=c.edges[i-1].length):0);
    const flight={key:`stair:${stairs.length}`,points:c.path.map(n=>n.point),distances,length:c.length,y0:c.y0,y1:c.y1,width:Math.min(...c.edges.map(e=>e.road.width)),roadIds:[...new Set(c.edges.map(e=>e.road.id))],source:'osm-steps-inferred-elevation'};
    stairs.push(flight);for(const e of c.edges)e.stairFlight=flight.key;
  }
  const changed=new Set(),segments=[];
  for(const edge of edges){
    const {a,b,road,nominal}=edge,changedHeight=Math.abs(a.y-nominal)>.001||Math.abs(b.y-nominal)>.001;
    if(changedHeight)changed.add(road.id);
    const slope=Math.abs(b.y-a.y)/edge.length;if(!WALK.test(road.type)){stats.gradeMaxVehicleSlope=Math.max(stats.gradeMaxVehicleSlope,slope);}
    const prior=segments.at(-1),gradient=(b.y-a.y)/edge.length;
    if(prior&&prior.sourceSegment===edge.source&&prior.stairFlight===edge.stairFlight&&Math.abs(prior.gradient-gradient)<1e-7){prior.b=b.point;prior.yB=b.y;prior.y=(prior.yA+b.y)/2;prior.nodeB=b.key;prior.ramp||=changedHeight;}
    else segments.push({a:a.point,b:b.point,yA:a.y,yB:b.y,y:(a.y+b.y)/2,road,nodeA:a.key,nodeB:b.key,nominal,stairFlight:edge.stairFlight,ramp:changedHeight,gradient,sourceSegment:edge.source,source:'inferred-connected-grade'});
  }
  stats.gradeSteepVehicleRuns=chains.filter(c=>!c.stairs&&c.edges.some(e=>!WALK.test(e.road.type))&&c.edges.some(e=>Math.abs(e.b.y-e.a.y)/e.length>settings.warningGrade)).length;
  stats.gradeChangedWays=changed.size;stats.gradeResolvedConnections=transitions.length;stats.stairFlights=stairs.length;
  for(const s of segments)delete s.sourceSegment;
  return {segments,stairs,stats,crossingConstraints:crossingConstraints.map(({samples,...c})=>c),nodes:ordered.map(n=>({key:n.key,point:n.point,y:n.y,fixed:n.fixed,nominals:n.nominals})),settings};
}
