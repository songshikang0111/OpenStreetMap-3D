// Root's CPU reproduction, with only paths/view import adapted to this worktree.
// The old NearDetails call deliberately does not pass new explicit headroom.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {normalizeManifest} from '../../../../../src/runtime/manifest.js';
import {createBudget,projectChunks,budgetPlan} from '../../../../../src/runtime/policy.js';
import {NearDetails} from '../../../../../src/runtime/near-details.js';
import {measureGroup} from '../../../../../src/runtime/resources.js';
import {decodeChunk} from '../../../../../src/core/scene-codec.js';
import {bindSceneStyle,createStyleShared} from '../../../../../src/styles/index.js';
import {InkRenderer} from '../../../../../src/ink-renderer.js';
import {costContext,collectDrawUnits,drawUnitCost} from '../../../../../src/runtime/render-cost.js';
const directory=new URL('../../../../../work/integration-scenes/beijing-cbd-grow-1/',import.meta.url),json=JSON.parse(await fs.readFile(new URL('manifest.json',directory))),manifest=normalizeManifest(json,new URL('manifest.json',directory).href),chunk=manifest.chunks[0],lod=chunk.lods[0];
const view={position:[-54.465855332583416,26.25,-52.10670670317487],target:[.5427259487235006,19.5,-6.486136335879564],fov:55};
const budget=createBudget({nearDetails:420}),camera=new THREE.PerspectiveCamera(view.fov,1280/720,.25,30000);camera.position.fromArray(view.position);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
const scene=new THREE.Scene(),ink=new InkRenderer({},scene,camera),shared=createStyleShared(),bindGroup=g=>bindSceneStyle(g,{style:'comic',shared});
const center=manifest.box.getCenter(new THREE.Vector3()),sun=new THREE.DirectionalLight();sun.castShadow=true;sun.target.position.copy(center);sun.position.copy(center).add(new THREE.Vector3(-400,800,350));Object.assign(sun.shadow.camera,{left:-700,right:700,top:700,bottom:-700,near:1,far:4000});sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
const group=await decodeChunk(await fs.readFile(new URL(lod.uri,directory)),lod);group.matrix.copy(chunk.matrix);group.matrixAutoUpdate=false;const binding=bindGroup(group);ink.prepareGroup(group);scene.add(group);
const context=costContext(camera,{scenePasses:4,colorPasses:1,shadowPasses:1,fixedCalls:3,fixedTriangles:6},sun),units=collectDrawUnits(group),cache=new Map([[`${chunk.id}:${lod.url}`,units]]),projected=projectChunks(manifest.chunks,camera,720,budget.prefetchMargin,context,cache),plan=budgetPlan(projected,new Map(),budget,1000,context),bodyCost=drawUnitCost(units,context),body=measureGroup(group);
const near=new NearDetails({budget,bindGroup,releaseGroup:g=>ink.releaseGroup(g)});near.update([{group}],camera,1000,budget.visibleTriangles-bodyCost.frameTriangles-context.fixedTriangles,5,{residentBytes:budget.residentBytes-13400000,drawCalls:budget.drawCalls-bodyCost.frameCalls-context.fixedCalls});
const attachments=near.stats(),result={case:'original Beijing grow1, t13 fixed camera, configured nearDetails=420; CPU only',selectedLod:plan.requests[0].chunk.lods[plan.requests[0].index].id,budget:budget.nearDetails,persistedDetails:body.nearDetails,runtimeAttachments:attachments.nearDetails,total:body.nearDetails+attachments.nearDetails,passes:body.nearDetails+attachments.nearDetails<=budget.nearDetails,mainFrameCost:bodyCost};
await fs.writeFile(new URL('./minimal-after.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));near.dispose();binding.dispose();ink.releaseGroup(group);ink.dispose();group.traverse(o=>o.geometry?.dispose());assert(result.passes);
