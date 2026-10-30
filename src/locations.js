// Region selection changes data and labels, never rendering rules or materials.
export const LOCATIONS = [
  {id:'beijing',name:'北京 · 国贸 CBD',subtitle:'国贸中心 · 央视总部 · 中国尊',label:'BEIJING / CHAOYANG',file:'beijing-cbd',overlays:['street-details','landscape-details'],profile:'landscape-profile'},
  {id:'shanghai',name:'上海 · 陆家嘴',subtitle:'高层密集区 · 黄浦江岸',label:'SHANGHAI / LUJIAZUI',file:'shanghai-lujiazui'},
  {id:'kyoto',name:'京都 · 祇园',subtitle:'低层街区 · 神社与绿地',label:'KYOTO / GION',file:'kyoto-gion'},
  {id:'amsterdam',name:'阿姆斯特丹 · 运河街区',subtitle:'连续街屋 · 运河与桥梁',label:'AMSTERDAM / CANAL DISTRICT',file:'amsterdam-canals'},
];

export function resolveLocation(search='') {
  const id=new URLSearchParams(search).get('site')||'beijing';
  const location=LOCATIONS.find(item=>item.id===id);
  if(!location)throw new Error(`未知地点：${id}`);
  return location;
}

export async function loadLocationData(location,readJSON,mergeOverlay) {
  const raw=await readJSON(location.file);
  for(const name of location.overlays||[]) {
    try { const overlay=await readJSON(name); mergeOverlay(raw,overlay,name); }
    catch(error) { console.warn(`Optional overlay ${name}: ${error.message}`); }
  }
  if(location.profile) {
    try { raw.metadata.landscapeProfile=await readJSON(location.profile); }
    catch(error) { console.warn(`Optional profile: ${error.message}`); }
  }
  return raw;
}

export const coordinateLabel=([lat,lon])=>`${Math.abs(lat).toFixed(5)}° ${lat<0?'S':'N'} · ${Math.abs(lon).toFixed(5)}° ${lon<0?'W':'E'}`;

// Camera choices depend only on the current dataset; no place names or OSM IDs.
export function genericViews(data) {
  const heights=data.buildings.map(b=>b.height).sort((a,b)=>a-b);
  const typical=heights[Math.floor(heights.length*.7)]||12;
  const scale=Math.max(data.bounds[2]-data.bounds[0],data.bounds[3]-data.bounds[1]);
  const focus=[0,Math.min(80,Math.max(8,typical*.4)),0];
  const building=[...data.buildings].sort((a,b)=>Math.hypot(...a.center)-Math.hypot(...b.center))[0];
  const [x,z]=building?.center||[0,0],height=building?.height||12;
  const radius=Math.max(35,Math.sqrt(building?.area||400)*1.8,height*.7);
  return {
    overview:{position:[scale*.78,scale*.72,scale*.85],target:focus},
    skyline:{position:[-scale*.08,Math.max(25,typical*.8),scale*.95],target:focus},
    roof:{position:[-scale*.22,Math.max(60,typical*1.5),scale*.25],target:focus},
    facade:{position:[x+radius,height*.45+5,z+radius],target:[x,height*.45,z]},
  };
}
