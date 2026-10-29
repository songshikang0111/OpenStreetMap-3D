import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { parseOSM } from './osm.js';
import { buildCity } from './city.js';
import { InkRenderer } from './ink-renderer.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport');
let renderer,scene,camera,controls,ink,city,data,sun,needsRender=true,mode=0,inspect=false,toastTimer;
let mapState=null;
const modeNames=['城市的另一种笔触。','让建筑，留下线条。','光与城市的色温。','先看空间，再看细节。'];
const sourceNames={height:'OSM 标注高度',levels:'由 OSM 层数换算',estimated:'程序估算'};

function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function invalidate(){needsRender=true;}
function setMode(next){
  mode=next;
  ink.material.uniforms.mode.value=inspect?4:mode;
  $('view-name').textContent=inspect?'看见数据的边界。':modeNames[mode];
  for(const button of document.querySelectorAll('[data-mode]')){const on=Number(button.dataset.mode)===mode;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));}
  invalidate();
}

function updateLight(){
  const angle=Number($('sun-angle').value)*Math.PI/180;
  sun.position.set(Math.sin(angle)*1100,1350,Math.cos(angle)*1100);
  sun.shadow.needsUpdate=true;invalidate();
}

function preset(name){
  document.querySelector('.stage').classList.toggle('street-view',name==='street');
  const [x0,z0,x1,z1]=data.bounds,width=x1-x0,depth=z1-z0;
  controls.autoRotate=false;$('rotate-toggle').checked=false;
  const positions={overview:[width*.78,Math.max(width,depth)*.72,depth*.94],skyline:[-width*.08,125,depth*.9],street:[-110,12,depth*.33],top:[0,Math.max(width,depth)*1.3,.01]};
  const targets={overview:[0,60,0],skyline:[70,110,-140],street:[200,80,-250],top:[0,0,0]};
  if(name==='street'){
    const candidates=data.roads.filter(r=>!r.bridge&&/primary|secondary|tertiary/.test(r.type)).flatMap(r=>r.segments.map(([a,b])=>({a,b,width:r.width,center:[(a[0]+b[0])/2,(a[1]+b[1])/2]})));
    candidates.sort((a,b)=>Math.hypot(...a.center)-Math.hypot(...b.center));
    const road=candidates[0];
    if(road){const dx=road.b[0]-road.a[0],dz=road.b[1]-road.a[1],length=Math.hypot(dx,dz)||1;
      positions.street=[road.center[0]-dz/length*road.width*.2,2.1,road.center[1]+dx/length*road.width*.2];
      targets.street=[positions.street[0]+dx/length*180,34,positions.street[2]+dz/length*180];
    }
  }
  camera.position.set(...positions[name]);controls.target.set(...targets[name]);
  camera.fov=name==='street'?65:name==='top'?43:42;camera.updateProjectionMatrix();
  controls.maxPolarAngle=name==='street'?Math.PI*.75:Math.PI*.495;
  controls.update();
  for(const button of document.querySelectorAll('[data-camera]'))button.classList.toggle('active',button.dataset.camera===name);
  invalidate();
}

function resize(){
  const w=viewport.clientWidth,h=viewport.clientHeight;
  renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
  const resolution=renderer.getDrawingBufferSize(new THREE.Vector2());ink.resize(resolution.x,resolution.y);invalidate();
}

function drawMap(){
  const canvas=$('map'),ctx=canvas.getContext('2d');
  const [x0,z0,x1,z1]=data.bounds,pad=15;
  const scale=Math.min((canvas.width-pad*2)/(x1-x0),(canvas.height-pad*2)/(z1-z0));
  const offsetX=(canvas.width-(x1-x0)*scale)/2,offsetY=(canvas.height-(z1-z0)*scale)/2;
  const point=p=>[(p[0]-x0)*scale+offsetX,(p[1]-z0)*scale+offsetY];
  mapState={scale,offsetX,offsetY,x0,z0};
  ctx.fillStyle='#eceee4';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const b of data.greens){ctx.fillStyle='#d3dfc8';ctx.beginPath();b.outer.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...point(p)));ctx.closePath();ctx.fill();}
  for(const road of data.roads){ctx.strokeStyle='#faf9f1';ctx.lineWidth=Math.max(1.5,road.width*scale);ctx.lineCap='round';for(const [a,b]of road.segments){ctx.beginPath();ctx.moveTo(...point(a));ctx.lineTo(...point(b));ctx.stroke();}}
  for(const b of data.buildings){ctx.fillStyle=inspect?city.sourceColors[b.source]:b.height>130?'#899b91':'#b4beb0';ctx.beginPath();for(const ring of [b.outer,...b.holes]){ring.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...point(p)));ctx.closePath();}ctx.fill('evenodd');}
  const p=point([camera.position.x,camera.position.z]),target=point([controls.target.x,controls.target.z]);
  const angle=Math.atan2(target[1]-p[1],target[0]-p[0]);
  const px=Math.max(9,Math.min(canvas.width-9,p[0])),py=Math.max(9,Math.min(canvas.height-9,p[1]));
  ctx.fillStyle='#b98251';ctx.beginPath();ctx.moveTo(px+Math.cos(angle)*10,py+Math.sin(angle)*10);ctx.lineTo(px+Math.cos(angle+2.4)*6,py+Math.sin(angle+2.4)*6);ctx.lineTo(px+Math.cos(angle-2.4)*6,py+Math.sin(angle-2.4)*6);ctx.closePath();ctx.fill();
}

function showBuilding(b){
  $('building-name').textContent=b.tags.name||b.tags['name:en']||'未命名建筑';
  const details=$('building-details');details.replaceChildren();
  const list=document.createElement('dl');
  for(const [key,value] of [['高度',`${b.height.toFixed(1)} m`],['高度来源',sourceNames[b.source]],['底部离地',`${b.minHeight.toFixed(1)} m`],['占地面积',`${Math.round(b.area).toLocaleString()} m²`],['地图编号',`${b.osmType} ${b.osmId}`]]){
    const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=key;description.textContent=value;list.append(term,description);
  }
  details.append(list);
  if(b.source!=='height'){const p=document.createElement('p');p.className='notice';p.textContent=b.source==='estimated'?'地图缺少高度和层数，当前高度由用途与面积估算。':'高度由楼层数与假定层高换算，非实测高度。';details.append(p);}
  $('osm-link').href=`https://www.openstreetmap.org/${b.osmType}/${b.osmId}`;$('building-info').hidden=false;
}

function download(blob,name){const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}

async function exportPNG(){
  const button=$('export-png');button.disabled=true;toast('正在生成高分辨率画面…');
  const size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();
  try{
    const scale=2400/Math.max(size.x,size.y),w=Math.round(size.x*scale),h=Math.round(size.y*scale);
    renderer.setPixelRatio(1);renderer.setSize(w,h,false);ink.resize(w,h);ink.render();
    const output=document.createElement('canvas');output.width=w;output.height=h;const context=output.getContext('2d');context.drawImage(renderer.domElement,0,0);
    const font=Math.max(13,Math.round(w/140));context.font=`${font}px sans-serif`;const credit='© OpenStreetMap contributors · openstreetmap.org/copyright | Beijing City Ink';
    const textWidth=context.measureText(credit).width;context.fillStyle='rgba(247,245,237,.92)';context.fillRect(w-textWidth-28,h-font-24,textWidth+24,font+17);context.fillStyle='#52614d';context.fillText(credit,w-textWidth-16,h-13);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('浏览器无法编码 PNG');download(blob,'beijing-city-ink.png');toast(`已导出 ${w} × ${h} PNG，含地图来源标注。`);
  }catch(error){toast(`导出失败：${error.message}`);console.error(error);}
  finally{renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);const buffer=renderer.getDrawingBufferSize(new THREE.Vector2());ink.resize(buffer.x,buffer.y);button.disabled=false;invalidate();}
}

async function exportGLB(){
  const button=$('export-glb');button.disabled=true;toast('正在打包建筑、道路与树木几何…');
  const wasInspect=inspect;
  try{
    if(wasInspect)city.setProvenance(false);
    const clone=city.group.clone(true);
    clone.userData={attribution:'© OpenStreetMap contributors',license:'ODbL-1.0',licenseUrl:'https://www.openstreetmap.org/copyright',center:data.metadata.center,description:'OSM geometry plus inferred procedural details. Screen-space ink and shader windows are not included.'};
    // GLTFExporter supports ordinary meshes; expand instances for portable geometry.
    const instances=[];clone.traverse(o=>{if(o.isInstancedMesh)instances.push(o);});
    for(const inst of instances){
      const replacement=new THREE.Group();replacement.name=inst.name;replacement.matrix.copy(inst.matrix);replacement.matrixAutoUpdate=false;
      for(let i=0;i<inst.count;i++){const mesh=new THREE.Mesh(inst.geometry,inst.material);inst.getMatrixAt(i,mesh.matrix);mesh.matrixAutoUpdate=false;replacement.add(mesh);}
      inst.parent.add(replacement);inst.removeFromParent();
    }
    const result=await new GLTFExporter().parseAsync(clone,{binary:true,onlyVisible:true});
    download(new Blob([result],{type:'model/gltf-binary'}),'beijing-city-ink.glb');
    toast('GLB 已导出；漫画网点和着色器窗格属于屏幕效果。');
  }catch(error){toast(`导出失败：${error.message}`);console.error(error);}
  finally{if(wasInspect)city.setProvenance(true);button.disabled=false;invalidate();}
}

function connectUI(){
  for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>setMode(Number(button.dataset.mode)));
  for(const button of document.querySelectorAll('[data-camera]'))button.addEventListener('click',()=>preset(button.dataset.camera));
  $('reset-view').onclick=()=>preset('overview');
  const ranges=[['line-width','line-output','lineWidth',v=>v,v=>v.toFixed(1)],['tone-size','tone-output','toneSize',v=>v,v=>v.toFixed(1)],['density','density-output','inkDensity',v=>v/100,v=>`${v}%`]];
  for(const [id,output,uniform,transform,format]of ranges)$(id).addEventListener('input',()=>{const value=Number($(id).value);$(output).value=format(value);ink.material.uniforms[uniform].value=transform(value);invalidate();});
  $('sun-angle').oninput=()=>{$('sun-output').value=`${$('sun-angle').value}°`;updateLight();};
  $('windows-toggle').onchange=()=>{city.shared.windows.value=$('windows-toggle').checked?1:0;city.detailGroup.visible=$('windows-toggle').checked;invalidate();};
  $('trees-toggle').onchange=()=>{city.treeGroup.visible=$('trees-toggle').checked;sun.shadow.needsUpdate=true;invalidate();};
  $('shadows-toggle').onchange=()=>{sun.castShadow=$('shadows-toggle').checked;sun.shadow.needsUpdate=true;invalidate();};
  $('rotate-toggle').onchange=()=>{controls.autoRotate=$('rotate-toggle').checked;invalidate();};
  $('provenance').onclick=()=>{inspect=!inspect;document.body.classList.toggle('inspect',inspect);$('provenance').setAttribute('aria-pressed',String(inspect));city.setProvenance(inspect);setMode(mode);drawMap();$('view-subtitle').textContent=inspect?'绿：标注高度 · 蓝：楼层换算 · 橙：规则估算':'真实街区，程序构建。';};
  $('close-info').onclick=()=>{$('building-info').hidden=true;};
  $('export-png').onclick=exportPNG;$('export-glb').onclick=exportGLB;
  $('map').addEventListener('click',event=>{
    const rect=$('map').getBoundingClientRect(),px=(event.clientX-rect.left)*$('map').width/rect.width,py=(event.clientY-rect.top)*$('map').height/rect.height;
    const x=(px-mapState.offsetX)/mapState.scale+mapState.x0,z=(py-mapState.offsetY)/mapState.scale+mapState.z0;
    const offset=camera.position.clone().sub(controls.target);controls.target.set(x,15,z);camera.position.copy(controls.target).add(offset.multiplyScalar(.6));controls.update();invalidate();
  });
  let pointer=null;
  const raycaster=new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown',event=>{pointer=[event.clientX,event.clientY,event.button];});
  renderer.domElement.addEventListener('pointerup',event=>{
    if(!pointer||pointer[2]!==0||Math.hypot(event.clientX-pointer[0],event.clientY-pointer[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
    const hit=raycaster.intersectObjects(city.buildings,false)[0];if(hit)showBuilding(hit.object.userData.feature);
  });
  window.addEventListener('keydown',event=>{if(event.key==='Escape')$('building-info').hidden=true;});
}

async function initialize(){
  try{
    const response=await fetch(`${import.meta.env.BASE_URL}data/beijing-cbd.json`);
    if(!response.ok)throw new Error(`地图数据读取失败 (${response.status})，请先运行 npm run data:fetch。`);
    const raw=await response.json();data=parseOSM(raw);city=buildCity(data);
    scene=new THREE.Scene();scene.background=new THREE.Color('#f7f5ed');scene.add(city.group);
    renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    viewport.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','北京国贸三维城市视图');
    camera=new THREE.PerspectiveCamera(42,1,.8,7000);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=6;controls.maxDistance=4800;controls.autoRotateSpeed=.35;controls.screenSpacePanning=true;controls.addEventListener('change',invalidate);
    scene.add(new THREE.HemisphereLight('#f4f3e8','#a8b4a2',1.7));
    sun=new THREE.DirectionalLight('#fff8e8',2.3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
    Object.assign(sun.shadow.camera,{left:-1400,right:1400,top:1400,bottom:-1400,near:10,far:3600});sun.shadow.bias=-.00025;sun.shadow.normalBias=.5;sun.shadow.radius=2;scene.add(sun);scene.add(sun.target);updateLight();
    ink=new InkRenderer(renderer,scene,camera);preset('overview');resize();
    const counts={height:0,levels:0,estimated:0};for(const b of data.buildings)counts[b.source]++;
    $('stat-buildings').textContent=data.buildings.length;$('stat-roads').textContent=data.roads.length;$('stat-known').textContent=`${Math.round((counts.height+counts.levels)/data.buildings.length*100)}%`;
    const center=data.metadata.center;$('coordinate').textContent=`${center[0].toFixed(5)}° N · ${center[1].toFixed(5)}° E`;
    for(const [source,count]of Object.entries(counts))$(`count-${source}`).textContent=count;
    $('render-status').textContent=`${data.buildings.length} 个体块 · ${city.treeCount} 棵树 · 数据已缓存于项目`;
    $('scale-label').textContent=`${((data.bounds[2]-data.bounds[0])/1000).toFixed(1)} × ${((data.bounds[3]-data.bounds[1])/1000).toFixed(1)} km`;
    connectUI();drawMap();$('loading').hidden=true;
    new ResizeObserver(resize).observe(viewport);
    let previous=performance.now();
    function animate(now){
      requestAnimationFrame(animate);const delta=Math.min(.05,(now-previous)/1000);previous=now;controls.update(delta);
      if(needsRender||controls.autoRotate){city.updateLOD(camera);ink.render();drawMap();
        const d=camera.position.clone().sub(controls.target);$('compass-arrow').setAttribute('transform',`rotate(${-Math.atan2(d.x,d.z)*180/Math.PI} 25 25)`);needsRender=false;
      }
    }
    requestAnimationFrame(animate);
    console.info('City ready', {buildings:data.buildings.length,roads:data.roads.length,heights:counts,osmTrees:data.trees.length,generatedTrees:city.generatedTrees,...data.stats});
  }catch(error){console.error(error);$('loading').replaceChildren();const message=document.createElement('strong');message.textContent=error.message;$('loading').append(message);const detail=document.createElement('small');detail.textContent='请使用支持 WebGL 2 的浏览器，并通过本地服务器打开。';$('loading').append(detail);}
}
initialize();
