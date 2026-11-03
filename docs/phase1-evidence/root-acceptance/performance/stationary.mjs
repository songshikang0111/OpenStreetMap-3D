// Read-only CPU scheduling reproduction. No renderer, WebGL context, or timing claim.
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {normalizeManifest} from '../../../../src/runtime/manifest.js';
import {createBudget} from '../../../../src/runtime/policy.js';
import {ChunkStreamer} from '../../../../src/runtime/streamer.js';
import {NearDetails} from '../../../../src/runtime/near-details.js';
import {decodeChunk} from '../../../../src/core/scene-codec.js';
import {bindSceneStyle,createStyleShared} from '../../../../src/styles/index.js';
import {InkRenderer} from '../../../../src/ink-renderer.js';

await fs.mkdir('work/root-acceptance-performance',{recursive:true});
const directory=new URL('../../../../work/integration-scenes/beijing-cbd-grow-1/',import.meta.url);
const raw=JSON.parse(await fs.readFile(new URL('../../../../docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json',import.meta.url)));
const json=JSON.parse(await fs.readFile(new URL('manifest.json',directory)));
const output=[];
function sceneCosts(scene,camera,shadows=false){
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 let triangles=0,calls=0;
 scene.traverseVisible(object=>{if(!object.isMesh||!object.geometry?.attributes.position||shadows&&!object.castShadow||object.frustumCulled&&!frustum.intersectsObject(object))return;
  const g=object.geometry,count=object.isInstancedMesh?object.count:1,vertices=g.index?.count||g.attributes.position.count;
  if(!count)return;triangles+=Math.max(0,Math.min(g.drawRange.count,vertices-g.drawRange.start))/3*count;calls+=Array.isArray(object.material)?g.groups.length:1;
 });return {triangles,calls};
}
for(const targetTime of [10,13,19,37]){
 const keys=raw.path.keys,i=keys.findIndex((k,i)=>i<keys.length-1&&targetTime>=k.t&&targetTime<=keys[i+1].t),a=keys[i],b=keys[i+1],u=(targetTime-a.t)/(b.t-a.t),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*u);
 const view={position:mix(a.position,b.position),target:mix(a.target,b.target),fov:a.fov+(b.fov-a.fov)*u};
 const manifest=normalizeManifest(json,new URL('manifest.json',directory).href),budget=createBudget(),camera=new THREE.PerspectiveCamera(view.fov,1280/720,.25,30000);
 camera.position.fromArray(view.position);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
 const scene=new THREE.Scene(),ink=new InkRenderer({},scene,camera),shared=createStyleShared(),bindGroup=g=>bindSceneStyle(g,{style:'comic',shared});
 const cache=new Map();
 const streamer=new ChunkStreamer({manifest,budget,readAsset:async url=>{if(!cache.has(url))cache.set(url,await fs.readFile(new URL(url)));const bytes=cache.get(url);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},decodeChunk,bindGroup,prepareGroup:g=>ink.prepareGroup(g),releaseGroup:g=>ink.releaseGroup(g)});
 const near=new NearDetails({budget,bindGroup,releaseGroup:g=>ink.releaseGroup(g)});scene.add(streamer.group,near.group);streamer.passMultiplier=5;
 const center=manifest.box.getCenter(new THREE.Vector3()),sun=new THREE.DirectionalLight();sun.castShadow=true;sun.target.position.copy(center);sun.position.copy(center).add(new THREE.Vector3(-400,800,350));Object.assign(sun.shadow.camera,{left:-700,right:700,top:700,bottom:-700,near:1,far:4000});sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
 const swaps=[];let previous='';
 for(let time=0;time<15000;time+=40){
  streamer.update(camera,720,time);const main=streamer.stats(),mainResident=streamer.estimatedBytes()-(streamer.extraResidentBytes||0),multiplier=streamer.passMultiplier;
  near.update(streamer.current.values(),camera,time,budget.visibleTriangles-main.visibleTriangles*multiplier,multiplier,{residentBytes:budget.residentBytes-mainResident,drawCalls:budget.drawCalls-main.sceneDrawCalls*multiplier-3});
  ink.prepareScene();near.refreshResources();streamer.refreshResources();const n=near.stats();
  streamer.extraResidentBytes=n.geometryArrayBytes;streamer.extraTriangles=n.triangles;streamer.extraCalls=n.drawCalls;streamer.extraDetails=n.nearDetails;
  scene.updateMatrixWorld(true);sun.shadow.updateMatrices(sun);const normal=sceneCosts(scene,camera),shadow=sceneCosts(scene,sun.shadow.camera,true);
  const triangles=normal.triangles*4+shadow.triangles+6,calls=normal.calls*4+shadow.calls+3;
  if(main.sceneDrawCalls>0)streamer.passMultiplier=Math.max(1,Math.min(16,Math.max((calls-3)/(main.sceneDrawCalls+n.drawCalls),triangles/Math.max(1,main.visibleTriangles+n.triangles))));
  const entry=[...streamer.current.values()][0],level=entry?.chunk.lods[entry.index].id;
  if(level!==previous){swaps.push({time,level,desired:[...streamer.desired.values()][0]?.index,mainTriangles:main.visibleTriangles,nearTriangles:n.triangles,multiplier:streamer.passMultiplier,triangles,calls});previous=level;}
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 output.push({targetTime,view,mode:'CPU scheduler, CPU frustum counts for 4 scene passes plus shadow and composite, stationary camera, default budget; no hardware performance claims',counters:{...streamer.counters},swaps});
 near.dispose();await streamer.dispose();ink.dispose();
}
await fs.writeFile(new URL('../../../../work/root-acceptance-performance/stationary.json',import.meta.url),JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
