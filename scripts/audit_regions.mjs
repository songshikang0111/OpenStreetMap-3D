import fs from 'node:fs';
import * as THREE from 'three';
import { parseOSM,mergeOSMOverlay } from '../src/osm.js';
import { buildCity } from '../src/city.js';
import { LOCATIONS,loadLocationData,genericViews } from '../src/locations.js';
const output=new URL('../docs/evidence-generalization/',import.meta.url);fs.mkdirSync(output,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'));
const selected=process.argv.slice(2);const summary={};
for(const site of LOCATIONS.filter(s=>selected.includes(s.id))){
  const raw=await loadLocationData(site,read,mergeOSMOverlay),data=parseOSM(raw,1),start=performance.now();
  console.error(`Building ${site.id}: ${data.buildings.length} buildings, ${data.roads.length} roads`);
  const city=buildCity(data),buildMs=Math.round(performance.now()-start);
  const heights={height:0,levels:0,estimated:0};for(const b of data.buildings)heights[b.source]++;
  const tags={};for(const b of data.buildings)for(const k of ['roof:shape','roof:height','building:material','building:colour'])if(b.tags[k])tags[k]=(tags[k]||0)+1;
  const views=genericViews(data),camera=new THREE.PerspectiveCamera(42,1600/767,.4,7000);camera.position.fromArray(views.overview.position);camera.lookAt(...views.overview.target);city.updateLOD(camera,767);
  let triangles=0,meshes=0,nonFinite=0,outsidePlanarVertices=0;const [x0,z0,x1,z1]=data.bounds;
  city.group.traverse(o=>{
    if(!o.isMesh)return;meshes++;const p=o.geometry.attributes.position;
    triangles+=(o.geometry.index?.count||p.count)/3*(o.isInstancedMesh?o.count:1);
    for(const v of p.array)if(!Number.isFinite(v))nonFinite++;
    // A geometry sanity check, not collision or visual correctness certification.
    if(!o.isInstancedMesh)for(let i=0;i<p.count;i++)if(p.getX(i)<x0-20||p.getX(i)>x1+20||p.getZ(i)<z0-20||p.getZ(i)>z1+20)outsidePlanarVertices++;
  });
  const result={name:site.name,bbox:raw.metadata.bbox,retrievedAt:raw.metadata.retrievedAt,rawElements:raw.elements.length,
    buildings:data.buildings.length,roads:data.roads.length,heights,knownHeightFraction:(heights.height+heights.levels)/data.buildings.length,
    osmTrees:data.trees.length,treeCount:city.treeCount,waterPolygons:data.water.length,landscapePolygons:data.landscapes.length,
    inputTags:tags,parseStats:data.stats,buildMs,meshObjects:meshes,triangles,nonFinite,outsidePlanarVertices,
    roadStats:city.roadStats,landscapeStats:city.landscapeStats,facadeFamilies:city.familyCounts,landmarks:city.landmarks,
    tallest:data.buildings.slice().sort((a,b)=>b.height-a.height).slice(0,8).map(b=>({id:b.id,name:b.tags.name,height:b.height,source:b.source,part:b.part})),views};
  fs.writeFileSync(new URL(`${site.id}.json`,output),JSON.stringify(result,null,2));summary[site.id]={buildMs,buildings:result.buildings,triangles,nonFinite};
  const geometries=new Set(),materials=new Set();city.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}
console.log(JSON.stringify(summary,null,2));
