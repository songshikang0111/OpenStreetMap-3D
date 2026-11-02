import fs from 'node:fs';
import { parseOSM,area } from '../src/osm.js';
import { buildCity } from '../src/city.js';
import { planRoof } from '../src/roofs.js';
const output=new URL('../docs/evidence-generalization/ground-roofs/',import.meta.url);fs.mkdirSync(output,{recursive:true});
const results=[];
for(const [site,file]of [['shuhe','lijiang-shuhe'],['bibury','bibury-village'],['sydney','sydney-harbour']]){
  const raw=JSON.parse(fs.readFileSync(new URL(`../public/data/${file}.json`,import.meta.url))),data=parseOSM(raw),start=performance.now();
  const city=buildCity(data,{inferRoofs:true}),waterArea=data.water.reduce((s,w)=>s+area(w.outer)-w.holes.reduce((n,h)=>n+area(h),0),0);
  let nonFinite=0;city.group.traverse(o=>{if(o.geometry)for(const x of o.geometry.attributes.position.array)if(!Number.isFinite(x))nonFinite++;});
  const result={site,buildings:data.buildings.length,roofShapeTags:data.buildings.filter(b=>b.tags['roof:shape']).length,roofStats:city.roofStats,
    inferredRoofCandidates:data.buildings.filter(b=>planRoof(b,{inferRoofs:true}).source==='inferred').length,
    waterArea,waterFraction:waterArea/((data.bounds[2]-data.bounds[0])*(data.bounds[3]-data.bounds[1])),waterPolygons:data.water.length,
    completedAreas:raw.metadata.completedAreas,parseStats:data.stats,landscapeStats:city.landscapeStats,treeCount:city.treeCount,nonFinite,buildMs:Math.round(performance.now()-start)};
  fs.writeFileSync(new URL(`${site}.json`,output),JSON.stringify(result,null,2));results.push(result);
  const geometries=new Set(),materials=new Set();city.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}
console.log(JSON.stringify(results.map(r=>({site:r.site,roofs:r.roofStats,inferredLandscape:r.landscapeStats.inferredSites,waterFraction:r.waterFraction,nonFinite:r.nonFinite,buildMs:r.buildMs})),null,2));
