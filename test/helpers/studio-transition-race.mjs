import vm from 'node:vm';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import * as apiHelpers from '../../studio/api.js';import {createProjectSettings} from '../../studio/project-settings.js';
const elements=new Map(),loaded=[],viewers=[],pending=[],trace=[];
function element(id){if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:false,checked:false,textContent:'',valueAsNumber:1,listeners:{},classList:{add(){},toggle(){},remove(){}},querySelector(){return element(id+'-button');},addEventListener(name,handler){this.listeners[name]=handler;},replaceChildren(){},append(){}});return elements.get(id);}
const bounds=[-100,0,-100,100,30,100],config={name:'Race project',area:{south:39.908,west:116.459,north:39.91,east:116.462},source:{kind:'sample',file:'data/source.json'},style:{id:'comic',parameters:{}},quality:'balanced',seed:1,tiling:{sizeMeters:500},generation:{inferRoofs:false,landscapeEnabled:false},landmarks:{enabled:true,packages:[]}};
const api={dataSources:async()=>({defaults:{endpoint:'https://overpass.test/api',transport:'post',fallbackPolicy:'none',fallbackEndpoints:[]},providers:[]}),projects:async()=>({projects:[]}),stylePreview:async(id,style)=>({preview:{style,styleModule:null,baseUrl:'/preview/',sdkUrl:'/preview/sdk.js',report:{}}}),save:async(id,patch)=>({project:{id,config:{...config,...patch}}})};
const previousOption=globalThis.Option;globalThis.Option=class{};
let context;
try{
 context=vm.createContext({...apiHelpers,createStudioApi:()=>api,createProjectSettings,console,document:{getElementById:element},Option:globalThis.Option,window:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},location:{href:'http://127.0.0.1:4179/'},fetch:async()=>({ok:true,json:async()=>({bounds,featureIndex:{}})}),setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},URL,Blob});
 const module=new vm.SyntheticModule(['loadProjectStyle','createCityViewer'],function(){
  this.setExport('loadProjectStyle',async style=>{const handle={...style,active:true,dispose(){this.active=false;trace.push('css-dispose-'+this.id);}};loaded.push(handle);return handle;});
  this.setExport('createCityViewer',options=>new Promise(resolve=>{let view={position:[0,100,100],target:[0,0,0],fov:45};const viewer={id:viewers.length+1,style:options.style.id,quality:options.quality,onProgress:options.onProgress,active:true,getView:()=>view,setView:next=>{view={...view,...next};},getStats:()=>({}),whenIdle:async()=>{},dispose:async function(){this.active=false;trace.push('viewer-dispose-'+this.id);}};viewers.push(viewer);pending.push(()=>resolve(viewer));}));
 },{context});await module.link(()=>{});await module.evaluate();
 const source=await readFile(new URL('../../studio/main.js',import.meta.url),'utf8');const script=new vm.Script(source.replace(/^import .*;\r?\n/gm,'')+'\nglobalThis.review={state,settings,preview,disposePreview,openProject,pollJob,enabled};',{importModuleDynamically:async()=>module});script.runInContext(context);await new Promise(setImmediate);
 context.review.state.project={id:'p1'};context.review.state.config=config;context.review.settings.loadStyle(config.style);element('quality').value='balanced';
 const first=context.review.preview();for(let i=0;i<40&&pending.length<1;i++)await new Promise(setImmediate);assert.equal(pending.length,1);
 const second=context.review.preview();for(let i=0;i<40&&pending.length<2;i++)await new Promise(setImmediate);assert.equal(pending.length,2);
 pending[1]();await second;pending[0]();await first;
 const beforeDispose={activeViewers:viewers.filter(v=>v.active).map(v=>v.id),ownedViewer:context.review.state.viewer.id,activeCSS:loaded.filter(handle=>handle.active).length};await context.review.disposePreview();
 const afterDispose={activeViewers:viewers.filter(v=>v.active).map(v=>v.id),activeCSS:loaded.filter(handle=>handle.active).length};
 context.review.state.config=config;context.review.settings.loadStyle(config.style);context.review.state.preparedStyle=null;for(const [name,value]of Object.entries(config.area))element(name).value=String(value);element('project-name').value=config.name;element('seed').valueAsNumber=1;element('tile-size').valueAsNumber=500;element('landmarks').checked=true;
 const pendingBefore=pending.length,third=context.review.preview();for(let i=0;i<40&&pending.length===pendingBefore;i++)await new Promise(setImmediate);assert.equal(pending.length,pendingBefore+1);
 element('style').value='line';const changingStyle=element('style').listeners.change({preventDefault(){}});
 for(let i=0;i<80&&pending.length<pendingBefore+2;i++)await new Promise(setImmediate);assert.equal(pending.length,pendingBefore+2);
 pending[pendingBefore+1]();await changingStyle;pending[pendingBefore]();await third;
 const savedDuringLoad={formStyle:element('style').value,savedStyle:context.review.state.config.style.id,renderedStyle:context.review.state.viewer.style};assert.equal(savedDuringLoad.savedStyle,'line');assert.equal(savedDuringLoad.renderedStyle,'line');await context.review.disposePreview();
 api.get=async id=>({project:{id,config:{...config,name:'Second project'}}});
 const oldPending=pending.length,oldProject=context.review.preview();for(let i=0;i<40&&pending.length===oldPending;i++)await new Promise(setImmediate);
 const opening=context.review.openProject({id:'p2'});for(let i=0;i<80&&pending.length<oldPending+2;i++)await new Promise(setImmediate);assert.equal(pending.length,oldPending+2);
 pending[oldPending+1]();await opening;pending[oldPending]();await oldProject;
 assert.equal(context.review.state.project.id,'p2');assert.deepEqual(viewers.filter(v=>v.active).map(v=>v.id),[context.review.state.viewer.id]);assert.equal(loaded.filter(handle=>handle.active).length,1);
 context.review.state.job={id:'failed-export',kind:'export-web',status:'running'};api.job=async id=>({job:{id,kind:'export-web',status:'failed',diagnostics:[{code:'STALE_BUILD'}],artifacts:[]}});
 await context.review.pollJob();const failedStatus=element('job-status').textContent;assert.match(failedStatus,/export-web.*failed/);context.review.state.viewer.onProgress({complete:true});assert.equal(element('job-status').textContent,failedStatus);
 context.review.state.job=null;context.review.state.actionBusy=true;context.review.enabled();assert.equal(element('cancel').disabled,true);context.review.state.actionBusy=false;
 await context.review.disposePreview();
 assert.equal(viewers.filter(v=>v.active).length,0);assert.equal(loaded.filter(handle=>handle.active).length,0);
 for(const id of ['report','selection','diagnostics','job-status','stats'])element(id).textContent='Old project source / success';context.review.state.manifest={old:true};element('progress').value=.8;
 context.fetch=async()=>({ok:false});await context.review.openProject({id:'p3'});
 assert.equal(context.review.state.manifest,null);assert.equal(context.review.state.viewer,null);assert.equal(element('progress').value,0);
 for(const id of ['report','selection','diagnostics','job-status','stats'])assert.doesNotMatch(element(id).textContent,/Old project/);
 assert.deepEqual(beforeDispose.activeViewers,[2]);assert.equal(beforeDispose.ownedViewer,2);assert.equal(beforeDispose.activeCSS,1);assert.deepEqual(afterDispose,{activeViewers:[],activeCSS:0});console.log(JSON.stringify({beforeDispose,afterDispose,trace}));
}finally{globalThis.Option=previousOption;}
