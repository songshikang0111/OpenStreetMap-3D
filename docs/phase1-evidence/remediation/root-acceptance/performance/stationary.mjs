// Independent CPU scheduling audit using preserved pre-remediation CINK assets.
// No WebGLRenderer, GPU context, browser, or hardware timing is created.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {normalizeManifest} from '../../../../../src/runtime/manifest.js';
import {createBudget} from '../../../../../src/runtime/policy.js';
import {ChunkStreamer} from '../../../../../src/runtime/streamer.js';
import {NearDetails} from '../../../../../src/runtime/near-details.js';
import {decodeChunk} from '../../../../../src/core/scene-codec.js';
import {bindSceneStyle,createStyleShared} from '../../../../../src/styles/index.js';
import {InkRenderer} from '../../../../../src/ink-renderer.js';
import {costContext} from '../../../../../src/runtime/render-cost.js';
import {STATIONARY_VIEWS} from '../../../../../scripts/benchmark-integration/assessment.mjs';

const directory=new URL('../../../../../work/integration-scenes/beijing-cbd-grow-1/',import.meta.url);
const json=JSON.parse(await fs.readFile(new URL('manifest.json',directory)));
const build=JSON.parse(await fs.readFile(new URL('build-report.json',directory)));
const nearBudget=Number(process.argv[2]??18000),duration=process.argv[2]?5000:15000;
const output=[];
for(const {targetTime,view} of STATIONARY_VIEWS.filter(item=>!process.argv[2]||item.targetTime===13)){
 const manifest=normalizeManifest(json,new URL('manifest.json',directory).href),budget=createBudget({nearDetails:nearBudget}),camera=new THREE.PerspectiveCamera(view.fov,1280/720,.25,30000);
 camera.position.fromArray(view.position);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
 const scene=new THREE.Scene(),ink=new InkRenderer({},scene,camera),shared=createStyleShared(),bindGroup=g=>bindSceneStyle(g,{style:'comic',shared});
 const cache=new Map(),requests={};
 const streamer=new ChunkStreamer({manifest,budget,readAsset:async url=>{requests[url]=(requests[url]||0)+1;if(!cache.has(url))cache.set(url,await fs.readFile(new URL(url)));const bytes=cache.get(url);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},decodeChunk,bindGroup,prepareGroup:g=>ink.prepareGroup(g),releaseGroup:g=>ink.releaseGroup(g)});
 const near=new NearDetails({budget,bindGroup,releaseGroup:g=>ink.releaseGroup(g)});scene.add(streamer.group,near.group);
 const center=manifest.box.getCenter(new THREE.Vector3()),sun=new THREE.DirectionalLight();sun.castShadow=true;sun.target.position.copy(center);sun.position.copy(center).add(new THREE.Vector3(-400,800,350));Object.assign(sun.shadow.camera,{left:-700,right:700,top:700,bottom:-700,near:1,far:4000});sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
 const profile={scenePasses:4,colorPasses:1,shadowPasses:1,fixedCalls:3,fixedTriangles:6};
 const transitions=[];let previous='',maxPredictedTriangles=0,maxPredictedCalls=0,maxNearDetails=0;
 for(let time=0;time<duration;time+=40){
  streamer.update(camera,720,time,{renderContext:costContext(camera,profile,sun)});
  const main=streamer.frameCost(),mainResident=streamer.estimatedBytes()-(streamer.extraResidentBytes||0);
  near.update(streamer.current.values(),camera,time,budget.visibleTriangles-main.triangles,5,{residentBytes:budget.residentBytes-mainResident,drawCalls:budget.drawCalls-main.calls,nearDetails:Math.max(0,budget.nearDetails-main.nearDetails)});
  ink.prepareScene();near.refreshResources();streamer.refreshResources();const n=near.stats();
  streamer.extraResidentBytes=n.geometryArrayBytes;streamer.extraTriangles=n.triangles;streamer.extraCalls=n.drawCalls;streamer.extraDetails=n.nearDetails;
  maxNearDetails=Math.max(maxNearDetails,main.nearDetails+n.nearDetails);assert(main.nearDetails+n.nearDetails<=nearBudget);
  maxPredictedTriangles=Math.max(maxPredictedTriangles,main.triangles+n.triangles*5);maxPredictedCalls=Math.max(maxPredictedCalls,main.calls+n.drawCalls*5);
  const entry=[...streamer.current.values()][0],level=entry?.chunk.lods[entry.index].id;
  if(level!==previous){transitions.push({time,level,desired:[...streamer.desired.values()][0]?.index,mainCost:main,nearTriangles:n.triangles,nearDraws:n.drawCalls});previous=level;}
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 const stats=streamer.stats();
 assert(stats.cancelled<=1);assert(stats.swaps<=3);assert.equal(Math.max(...Object.values(requests)),1);assert.equal(previous,nearBudget>=410?'high':'medium');assert.equal(stats.standbyChunks,1);assert(stats.estimatedResidentBytes<=budget.residentBytes);assert(maxPredictedTriangles<=budget.visibleTriangles);assert(maxPredictedCalls<=budget.drawCalls);
 const attachmentStats=near.stats();
 near.dispose();await streamer.dispose();ink.dispose();assert.equal(streamer.registry.refs.size,0);assert.equal(streamer.estimatedBytes(),0);
 output.push({targetTime,view,nearBudget,duration,mode:'CPU scheduler only, original legacy CINK assets with missing near metadata; no hardware timing',sourceCompilerCommit:build.compilerCommit,stats,attachmentStats,maxNearDetails,maxPredictedTriangles,maxPredictedCalls,requests,transitions,disposedRefs:streamer.registry.refs.size});
}
const rerunDirectory=new URL('../../../../../work/root-remediation-performance-rerun/',import.meta.url);await fs.mkdir(rerunDirectory,{recursive:true});await fs.writeFile(new URL(process.argv[2]?`near-streamer-${nearBudget}.json`:'stationary.json',rerunDirectory),JSON.stringify(output,null,2));
console.log(JSON.stringify(output.map(({targetTime,nearBudget,stats,attachmentStats,maxNearDetails,maxPredictedTriangles,maxPredictedCalls,requests})=>({targetTime,nearBudget,loads:stats.loads,swaps:stats.swaps,cancelled:stats.cancelled,levels:stats.levels,bodyNearDetails:stats.nearDetails,nearAttachments:attachmentStats.nearDetails,maxNearDetails,resident:stats.estimatedResidentBytes,maxPredictedTriangles,maxPredictedCalls,requests}))));
