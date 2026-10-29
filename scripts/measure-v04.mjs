// Rebuild our own reviewed v0.3 revision; this is a geometry budget, not GPU FPS.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseOSM} from '../src/osm.js';
import {buildCity} from '../src/city.js';

const baseline='f3a483e';
const root=new URL('../work/v03-source/',import.meta.url);
fs.mkdirSync(root,{recursive:true});
for(const name of ['city.js','osm.js','building-rules.js','landmarks.js','streetlife.js','foliage.js','road-surface.js'])
  fs.writeFileSync(new URL(name,root),execFileSync('git',['show',`${baseline}:src/${name}`]));
const {buildCity:oldCity}=await import(new URL('city.js',root));
const raw=JSON.parse(fs.readFileSync('public/data/beijing-cbd.json'));
raw.elements.push(...JSON.parse(fs.readFileSync('public/data/street-details.json')).elements);
const previous=oldCity(parseOSM(raw)),current=buildCity(parseOSM(raw));
const views=JSON.parse(fs.readFileSync('docs/evidence/views.json'));
function triangles(group){let count=0;group.traverse(o=>{if(o.isMesh)count+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});return count;}
function geometryBytes(group){let bytes=0;const seen=new Set();group.traverse(o=>{if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);for(const a of Object.values(o.geometry.attributes))bytes+=a.array.byteLength;bytes+=o.geometry.index?.array.byteLength||0;}});return bytes;}
function measure(city){return {treeTriangles:triangles(city.treeGroup),detailTriangles:triangles(city.detailGroup),detailInstances:city.detailGroup.children.reduce((sum,m)=>sum+m.count,0),sceneTriangles:triangles(city.group)};}
const result={baseline,scope:'Whole scene groups before frustum culling, one scene pass. Excludes shadow/post passes and renderer classification attributes. Not GPU timing.',trees:{before:previous.treeCount,after:current.treeCount},sceneGeometryBytes:{before:geometryBytes(previous.group),after:geometryBytes(current.group)},grammars:current.grammarCounts,views:[]};
for(const [key,url]of Object.entries(views)){
  const view=JSON.parse(new URLSearchParams(new URL(url).hash.slice(1)).get('v'));
  const camera={position:Object.fromEntries(['x','y','z'].map((k,i)=>[k,view.position[i]]))};
  previous.updateLOD(camera);current.updateLOD(camera);
  result.views.push({key,before:measure(previous),after:measure(current)});
}
fs.writeFileSync(process.argv[2]||'work/v04-budget.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
