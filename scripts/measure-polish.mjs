// Offline geometry budget check; these numbers are not measured GPU FPS.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseOSM} from '../src/osm.js';
import {buildStreetLife,TREE_LOD} from '../src/streetlife.js';
// Recreate the reviewed v0.2 baseline from this repository's own history.
fs.mkdirSync(new URL('../work/v02-source/',import.meta.url),{recursive:true});
for(const name of ['streetlife.js','osm.js'])fs.writeFileSync(new URL('../work/v02-source/'+name,import.meta.url),execFileSync('git',['show','e3efced:src/'+name]));
const {buildStreetLife:previous}=await import('../work/v02-source/streetlife.js');
const raw=JSON.parse(fs.readFileSync('public/data/beijing-cbd.json'));
raw.elements.push(...JSON.parse(fs.readFileSync('public/data/street-details.json')).elements);
const views=JSON.parse(fs.readFileSync('docs/evidence/views.json'));
const data=parseOSM(raw),old=previous(data),current=buildStreetLife(data);
const summary={scope:'Whole vegetation group before frustum culling; one scene pass; excludes shadows and screen passes; not GPU timing.',views:[]};
function triangles(group){let count=0;group.traverse(o=>{if(o.isMesh)count+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});return count;}
for(const [key,url]of Object.entries(views)){
  const v=JSON.parse(new URLSearchParams(new URL(url).hash.slice(1)).get('v'));
  const camera={position:Object.fromEntries(['x','y','z'].map((k,i)=>[k,v.position[i]]))};
  old.updateLOD(camera);current.updateLOD(camera);
  summary.views.push({key,before:{nearTrees:old.stats.nearTrees,treeTriangles:triangles(old.treeGroup)},after:{nearTrees:current.stats.nearTrees,treeTriangles:triangles(current.treeGroup)}});
}
summary.currentMaxNearTrees=TREE_LOD.maxTrees;summary.currentClustersPerNearTree=TREE_LOD.clusters;summary.currentClusterTriangles=500;
summary.currentMaxNearCrownTriangles=TREE_LOD.maxTrees*TREE_LOD.clusters*500;
fs.writeFileSync(process.argv[2]||'work/geometry-budget.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));old.dispose();current.dispose();
