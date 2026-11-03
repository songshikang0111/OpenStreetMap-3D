import { projection } from '../src/osm.js';

// Explicitly synthetic continuity fixture. Known CCTV IDs exercise the existing
// official multipart rule; these rectangles are not surveyed CCTV footprints.
export function continuityFixture() {
  const origin={lat:39.9095,lon:116.4605},p=projection(origin.lat,origin.lon);
  const ll=([x,z])=>{const [lat,lon]=p.inverse([x,z]);return {lat,lon};};
  const ring=points=>[...points,points[0]].map(ll);
  const box=(id,x,z,w,d,tags)=>({type:'way',id,tags,geometry:ring([[x,z],[x+w,z],[x+w,z+d],[x,z+d]])});
  const sw=ll([-300,300]),ne=ll([300,-300]);
  const elements=[
    box(1,-35,-20,70,40,{building:'apartments',height:'42'}),
    box(2,-240,-225,40,55,{building:'commercial','building:levels':'7','roof:shape':'hipped','roof:height':'6'}),
    box(599547918,180,-230,55,55,{building:'office',height:'528',name:'中国尊'}),
    box(548126516,-85,100,30,35,{'building:part':'yes',height:'234'}),
    box(548126517,25,145,35,30,{'building:part':'yes',height:'234'}),
    box(547523487,-75,105,130,60,{'building:part':'yes',height:'234',min_height:'161'}),
    box(547523486,-95,90,165,95,{'building:part':'yes',height:'25'}),
    {type:'way',id:50,tags:{natural:'water'},geometry:ring([[-290,30],[290,30],[290,65],[-290,65]])},
    {type:'way',id:51,tags:{natural:'wood'},geometry:ring([[-270,190],[-140,190],[-140,280],[-270,280]])},
  ];
  let nodeId=1000;
  const road=(id,points,tags,refs)=>{
    const nodes=points.map((point,i)=>{const n=refs?.[i]??nodeId++;if(!elements.some(e=>e.type==='node'&&e.id===n))elements.push({type:'node',id:n,...ll(point)});return n;});
    elements.push({type:'way',id,nodes,tags:{highway:'secondary',width:'10',...tags}});return nodes;
  };
  const a=road(60,[[-290,-85],[0,-85],[290,-85]],{});
  road(61,[[0,-290],[0,-85]],{},[undefined,a[1]]);
  const bridge=road(62,[[110,-290],[110,0],[110,120],[110,290]],{bridge:'yes',layer:'1',highway:'primary',width:'12'});
  road(63,[[110,-300],[110,-290]],{},[undefined,bridge[0]]);
  road(64,[[110,290],[110,300]],{},[bridge.at(-1),undefined]);
  elements.push({type:'node',id:90,tags:{natural:'tree',height:'8'},...ll([-.5,-180])},{type:'node',id:91,tags:{natural:'tree',leaf_type:'needleleaved'},...ll([190,220])});
  const config={schemaVersion:1,name:'Synthetic continuity fixture',origin,area:{south:sw.lat,west:sw.lon,north:ne.lat,east:ne.lon},seed:71,source:{kind:'local',file:'synthetic-continuity.json'},tiling:{divisions:1}};
  return {raw:{metadata:{fixture:'synthetic',license:'CC0',bbox:[sw.lat,sw.lon,ne.lat,ne.lon]},elements},config};
}
