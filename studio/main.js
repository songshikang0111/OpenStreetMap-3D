import './style.css';
import {createStudioApi, areaAround, validateArea, isTerminal, viewsForBounds, cameraPresetForView, summarizeFeatures} from './api.js';
import {createCityViewer} from '../src/sdk/index.js';

const $ = id => document.getElementById(id), api = createStudioApi();
const state = {project:null, config:null, viewer:null, manifest:null, job:null, polling:0, disconnected:false, searchEpoch:0, location:{lat:39.9095, lon:116.4605}, lastKind:'build'};
const json = value => JSON.stringify(value, null, 2);
const unwrap = (value, key) => value[key] ?? value.data?.[key] ?? value.data ?? value;
function diagnostic(error) { $('diagnostics').textContent = error.diagnostics?.length ? json(error.diagnostics) : String(error.message || error); $('diagnostics').classList.add('error'); }
function action(handler) { return async event => {event?.preventDefault(); try {await handler(event);} catch(error) {diagnostic(error);} }; }
function setArea(area) {for (const key of ['south','west','north','east']) $(key).value = area[key];}
function getArea() {return validateArea(Object.fromEntries(['south','west','north','east'].map(key => [key,$(key).value])));}
function remember() {localStorage.setItem('city-ink-studio', json({projectId:state.project?.id,jobId:state.job?.id,lastKind:state.lastKind}));}
function enabled() {
  const busy = state.job && !isTerminal(state.job);
  for(const id of ['fetch','build','save','web']) $(id).disabled = !state.project || busy;
  $('cancel').disabled = !busy; $('retry').disabled = !state.project || (busy && !state.disconnected);
  for(const id of ['png','glb']) $(id).disabled = !state.viewer || busy;
  for(const id of ['sample','create','projects','relative-path']) $(id).disabled=!!busy;
  for(const id of ['seed','tile-size','infer-roofs','landscape','landmarks']) $(id).disabled=!state.project||!!busy;
  $('open-form').querySelector('button').disabled=!!busy;
}
async function listProjects() {
  const projects = unwrap(await api.projects(), 'projects');
  $('projects').replaceChildren(new Option('选择项目', ''), ...projects.map(project => new Option(project.name || project.config?.name || project.id, project.id)));
  if(state.project) $('projects').value=state.project.id;
  $('connection').textContent='本地服务已连接';
}
async function openProject(project,{pendingJob}={}) {
  project = unwrap(project, 'project');
  if (!project.id) throw new Error('本地服务未返回项目 ID。');
  const detail = unwrap(await api.get(project.id), 'project');
  if(state.project?.id!==project.id) {clearTimeout(state.polling);state.job=pendingJob||null;await state.viewer?.dispose();state.viewer=null;$('empty').hidden=false;}
  state.project = {...project,...detail}; state.config = detail.config || detail;
  const config=state.config;
  $('project-name').value=config.name; setArea(config.area);
  state.location=config.origin || {lat:(config.area.south+config.area.north)/2,lon:(config.area.west+config.area.east)/2};
  $('style').value=config.style?.id || 'comic'; $('quality').value=config.quality==='draft'?'low':config.quality || 'balanced';
  $('seed').value=config.seed ?? 1;$('tile-size').value=config.tiling?.sizeMeters || 500;$('infer-roofs').checked=config.generation?.inferRoofs || false;$('landscape').checked=config.generation?.landscapeEnabled || false;$('landmarks').checked=config.landmarks?.enabled!==false;
  $('project-info').textContent=`${config.name} · ${state.project.relativePath || state.project.path || state.project.id} · 保存时固化范围、风格和相机`;
  remember(); enabled(); await listProjects();
  const existing=await fetch(`/projects/${encodeURIComponent(state.project.id)}/dist/manifest.json`);
  if(existing.ok&&!pendingJob) await preview();
}
async function save() {
  if(!state.project) throw new Error('请先打开项目。');
  const patch={name:$('project-name').value,area:getArea(),style:{id:$('style').value,parameters:state.config.style?.parameters || {}},quality:$('quality').value};
  patch.seed=$('seed').valueAsNumber;patch.tiling={...state.config.tiling,sizeMeters:$('tile-size').valueAsNumber};
  patch.generation={...state.config.generation,inferRoofs:$('infer-roofs').checked,landscapeEnabled:$('landscape').checked};patch.landmarks={...state.config.landmarks,enabled:$('landmarks').checked};
  if(state.viewer) patch.camera=state.viewer.getView();
  const result=unwrap(await api.save(state.project.id,patch),'project');
  state.config={...state.config,...patch,...result.config};
  $('project-info').textContent=`${state.config.name} · 配置已保存（包括当前相机）`;
}
async function preview() {
  await state.viewer?.dispose(); state.viewer=null;$('empty').hidden=false;enabled();
  const manifestUrl=state.project.manifestUrl || `/projects/${encodeURIComponent(state.project.id)}/dist/manifest.json`;
  state.manifest=await fetch(manifestUrl).then(async response=>{if(!response.ok)throw new Error('场景清单不可用；请先构建项目。');return response.json();});
  const viewer=await createCityViewer({container:$('viewport'),manifestUrl,style:{id:$('style').value,parameters:state.config.style?.parameters || {}},quality:$('quality').value,onProgress:progress=>{if(state.job&&!isTerminal(state.job))return;$('job-status').textContent=progress.complete?'场景已加载；拖动旋转，滚轮缩放，右键平移。':`加载场景：${progress.stage || json(progress)}`;},onDiagnostic:diagnostic,onSelect:value=>{$('selection').textContent=json(value);}});
  state.viewer=viewer; $('empty').hidden=true;
  viewer.setView(state.config.camera || viewsForBounds(state.manifest.bounds).overview);
  $('fov').value=viewer.getView().fov;
  $('camera').value=cameraPresetForView(viewer.getView(),state.manifest.bounds);
  enabled();
  const report=await fetch(`/projects/${encodeURIComponent(state.project.id)}/dist/city.build-lock.json`);
  const lock=report.ok?await report.json():null;
  $('report').textContent=json({summary:summarizeFeatures(state.manifest.featureIndex),report:lock?.build?.report,sources:state.manifest.sources,attribution:state.manifest.attribution,limitations:'平地近似；未标注高度与部分道路高程为规则推断；地标为参数化近似。'});
  await viewer.whenIdle();
  $('job-status').textContent='场景已加载；拖动旋转，滚轮缩放，右键平移。';
}
async function pollJob() {
  clearTimeout(state.polling);
  if(!state.job) return;
  try {
    state.job=unwrap(await api.job(state.job.id),'job'); state.disconnected=false;
  }catch(error){state.disconnected=true;diagnostic(error);$('job-status').textContent='服务连接中断；恢复后点击“恢复 / 重试任务”。';enabled();return;}
    const job=state.job;
    const progress=typeof job.progress==='number' ? job.progress : job.progress?.fraction || 0;
    $('progress').value=Math.min(1,progress>1 ? progress/100 : progress);
    $('job-status').textContent=`${job.kind || state.lastKind} · ${job.status} · ${job.stage || job.progress?.stage || ''}`;
    $('diagnostics').textContent=json({diagnostics:job.diagnostics || [],artifacts:job.artifacts || [],result:job.result});
    $('diagnostics').classList.toggle('error',job.status==='failed');
    remember(); enabled();
    if(!isTerminal(job)) state.polling=setTimeout(pollJob,500);
    else if(job.status==='succeeded' && (job.kind || state.lastKind)==='build') {
      try{await preview();}catch(error){diagnostic(error);$('job-status').textContent=`构建已完成，预览失败：${error.message}`;enabled();}
    }else if(!state.viewer){
      try{
        const existing=await fetch(`/projects/${encodeURIComponent(state.project.id)}/dist/manifest.json`);
        if(existing.ok){await preview();$('job-status').textContent=`${job.kind || state.lastKind} · ${job.status} · 预览已有构建；输入变化后请重新构建。`;}
      }catch(error){diagnostic(error);$('job-status').textContent=`${job.status} · 已有构建预览失败：${error.message}`;enabled();}
    }
}
async function start(kind,parameters={},resume) {
  await save(); state.lastKind=kind;
  state.job=unwrap(await api.start(state.project.id,kind,parameters,resume),'job');
  if(!state.job.id) throw new Error('服务未返回任务 ID；未宣告任务成功。');
  remember(); enabled(); await pollJob();
}
$('search-form').addEventListener('submit',action(async()=>{
  const epoch=++state.searchEpoch;
  $('candidates').textContent='正在定位…';
  let results;
  try{results=unwrap(await api.search($('query').value),'candidates');}
  catch(error){if(epoch===state.searchEpoch)$('candidates').textContent='定位失败；请查看诊断或使用明确坐标。';throw error;}
  if(epoch!==state.searchEpoch)return;
  $('candidates').replaceChildren();
  if(!results.length) {$('candidates').textContent='没有找到候选。请尝试明确坐标、OSM 链接或离线样例。';return;}
  for(const candidate of results) {
    const button=document.createElement('button'); button.className='candidate';
    button.textContent=`${candidate.displayName} · ${Number(candidate.lat).toFixed(5)}, ${Number(candidate.lon).toFixed(5)} · ${candidate.source || ''}`;
    button.addEventListener('click',action(async()=>{state.location=candidate;setArea(areaAround(candidate,$('radius').value));$('project-name').value=candidate.displayName.slice(0,80);$('job-status').textContent='已定位；检查明确范围后创建项目。';}));
    $('candidates').append(button);
  }
}));
$('apply-radius').addEventListener('click',action(async()=>setArea(areaAround(state.location,$('radius').value))));
$('create').addEventListener('click',action(async()=>openProject(await api.create({name:$('project-name').value,area:getArea(),source:{kind:'overpass',file:'data/source.json'}}))));
$('sample').addEventListener('click',action(async()=>{
  await openProject(await api.create({name:`offline-sample-${Date.now()}`,sample:true}));
  $('report').textContent='内置样例为小型合成街区，用于离线试用；不代表真实地图下载或实测还原。';
  await start('build');
}));
$('projects').addEventListener('change',action(async()=>{if($('projects').value) await openProject({id:$('projects').value});}));
$('open-form').addEventListener('submit',action(async()=>openProject(await api.open($('relative-path').value))));
$('save').addEventListener('click',action(save));
$('fetch').addEventListener('click',action(()=>start('fetch',{refresh:$('refresh').checked})));
$('build').addEventListener('click',action(()=>start('build')));
$('web').addEventListener('click',action(()=>start('export-web')));
$('cancel').addEventListener('click',action(async()=>{await api.cancel(state.job.id);await pollJob();}));
$('retry').addEventListener('click',action(async()=>{
  if(state.job && !isTerminal(state.job)) return pollJob();
  await start(state.lastKind,{},state.job?.id);
}));
$('style').addEventListener('change',action(async()=>{if(state.viewer) await state.viewer.setStyle($('style').value);}));
$('quality').addEventListener('change',action(async()=>{if(state.project) {await save();if(state.viewer) await preview();}}));
$('fov').addEventListener('input',()=>{if(state.viewer) state.viewer.setView({...state.viewer.getView(),fov:Number($('fov').value)});});
$('camera').addEventListener('change',()=>{
  if(!state.viewer) return;
  const views=viewsForBounds(state.manifest.bounds);
  if(views[$('camera').value]) state.viewer.setView({...views[$('camera').value],fov:Number($('fov').value)});
});
function download(data,name,type) {const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('png').addEventListener('click',action(async()=>{const data=await state.viewer.exportPNG({width:2400,height:Math.round(2400*$('viewport').clientHeight/$('viewport').clientWidth)});download(data.blob,'city-ink.png','image/png');$('diagnostics').textContent=json({scope:data.scope,loadedChunkIds:data.loadedChunkIds,attribution:data.attribution});}));
$('glb').addEventListener('click',action(async()=>{const data=await state.viewer.exportGLB({scope:'complete'});download(data.blob,'city-ink.glb','model/gltf-binary');$('diagnostics').textContent=json({scope:data.scope,chunkIds:data.chunkIds,limitations:data.limitations});}));
setInterval(()=>{if(state.viewer) {$('stats').textContent=json(state.viewer.getStats());$('camera').value=cameraPresetForView(state.viewer.getView(),state.manifest.bounds);}},1000);
window.addEventListener('beforeunload',()=>state.viewer?.dispose());
action(async()=>{
  await listProjects();const saved=JSON.parse(localStorage.getItem('city-ink-studio')||'{}');
  state.lastKind=saved.lastKind || 'build';
  if(saved.projectId) await openProject({id:saved.projectId},{pendingJob:saved.jobId?{id:saved.jobId,status:'queued'}:undefined});
  if(saved.jobId) {enabled();await pollJob();}
})();
