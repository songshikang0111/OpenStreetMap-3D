import * as THREE from 'three';
import {parseOSM,mergeOSMOverlay} from '../src/osm.js';
import {loadLocationData,resolveLocation,genericViews} from '../src/locations.js';
import {collectDepthBounds,stableNearPlane} from '../src/depth-policy.js';
const query=new URLSearchParams(location.search),before=query.get('before')==='1',fixture=query.get('fixture')||'tower';
const prefix=before?'/work/flicker-before/src/':'/src/';
const {buildCity}=await import(/* @vite-ignore */`${prefix}city.js`),{InkRenderer}=await import(/* @vite-ignore */`${prefix}ink-renderer.js`);
const site=resolveLocation(location.search),raw=await loadLocationData(site,async name=>(await fetch(`/data/${name}.json`)).json(),mergeOSMOverlay);
const data=parseOSM(raw);if(fixture==='tower'){
  data.buildings=data.buildings.filter(b=>['w660651176','w916885302'].includes(b.id));
  for(const key of ['roads','greens','water','trees','streetNodes','treeRows','landscapes','landscapeContexts'])data[key]=[];
}
const city=buildCity(data,{landscapeEnabled:fixture!=='tower'}),scene=new THREE.Scene();scene.background=new THREE.Color('#fff');scene.add(city.group);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;document.querySelector('#stage').append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#f4f3e8','#a8b4a2',1.7));
const sun=new THREE.DirectionalLight('#fff8e8',2.3);sun.position.set(778,1100,-778);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-1400,right:1400,top:1400,bottom:-1400,near:10,far:3600});sun.shadow.bias=-.00025;sun.shadow.normalBias=.5;scene.add(sun,sun.target);city.shared.sunDirection.value.copy(sun.position).normalize();
const view=fixture==='tower'?{position:[-235,95,-120],target:[-506,65,-224]}:fixture==='roads'?{position:[-150,110,500],target:[-435,5,220]}:fixture==='roof'?{position:[-230,160,220],target:[-30,10,-80]}:genericViews(data).overview;
const target=new THREE.Vector3(...view.target),offset=new THREE.Vector3(...view.position).sub(target),camera=new THREE.PerspectiveCamera(42,1280/720,.8,7000),boxes=collectDepthBounds(city.group);
const ink=new InkRenderer(renderer,scene,camera,city.shared);ink.resize(1280,720);let angle=0;
const $=id=>document.getElementById(id);
function render(){camera.position.copy(offset).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(target);camera.lookAt(target);camera.near=before?Math.max(.4,Math.min(12,camera.position.y*.012)):stableNearPlane(camera.position,boxes);camera.updateProjectionMatrix();city.updateLOD(camera,720);ink.render();$('status').textContent=`${site.id} / ${fixture} · ${angle.toFixed(4)} rad · near ${camera.near.toFixed(2)}`;}
$('version').textContent=before?'修复前 v0.8.0':'修复后';$('ink').onclick=()=>{ink.material.uniforms.mode.value=0;render();};$('color').onclick=()=>{ink.material.uniforms.mode.value=2;render();};
$('left').onclick=()=>{angle-=Math.PI/360;render();};$('right').onclick=()=>{angle+=Math.PI/360;render();};
// Probe real, fixed world points on the shared facade, then compare their
// surface reflectance across slight rotations. This is not a global FPS test.
$('sweep').onclick=async()=>{
  $('sweep').disabled=true;const series=[],start=angle,buf=new Uint16Array(1280*720*4),stats=[];
  const podium=data.buildings.find(b=>b.id==='w660651176');
  if(!podium){$('result').textContent='此机位供人工转动检查；数值测量使用 tower。';$('sweep').disabled=false;return;}
  const a=podium.outer[5],b=podium.outer[6],points=[];
  for(let u=0;u<12;u++)for(let y=0;y<7;y++){const t=.12+u/11*.76;points.push(new THREE.Vector3(a[0]+(b[0]-a[0])*t+.001,3.5+y*3.6,a[1]+(b[1]-a[1])*t));}
  for(let i=0;i<21;i++){
    angle=start+(i-10)*Math.PI/1800;render();renderer.readRenderTargetPixels(ink.color,0,0,1280,720,buf);
    series.push(points.map(p=>{const q=p.clone().project(camera),x=Math.round((q.x*.5+.5)*1280),y=Math.round((q.y*.5+.5)*720);let lum=0;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const n=((y+dy)*1280+x+dx)*4;lum+=(THREE.DataUtils.fromHalfFloat(buf[n])*.2126+THREE.DataUtils.fromHalfFloat(buf[n+1])*.7152+THREE.DataUtils.fromHalfFloat(buf[n+2])*.0722)/9;}return lum;}));
    await new Promise(requestAnimationFrame);
  }
  for(let j=0;j<points.length;j++){const v=series.map(frame=>frame[j]),mean=v.reduce((s,x)=>s+x,0)/v.length;stats.push({std:Math.sqrt(v.reduce((s,x)=>s+(x-mean)**2,0)/v.length),range:Math.max(...v)-Math.min(...v)});}
  const sorted=stats.map(s=>s.std).sort((a,b)=>a-b);$('result').textContent=JSON.stringify({before,fixture,frames:21,probes:points.length,rotationDegrees:[-1,1],medianStd:sorted[Math.floor(sorted.length/2)],p95Std:sorted[Math.floor(sorted.length*.95)],rangeOverPoint1:stats.filter(s=>s.range>.1).length,stats},null,2);
  angle=start;render();$('sweep').disabled=false;
};render();
