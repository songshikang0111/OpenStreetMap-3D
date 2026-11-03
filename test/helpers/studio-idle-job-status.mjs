import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import * as apiHelpers from '../../studio/api.js';
import {createProjectSettings} from '../../studio/project-settings.js';
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:false,checked:false,textContent:'',valueAsNumber:1,listeners:{},classList:{add(){},toggle(){},remove(){}},querySelector(){return element(id+'-button');},addEventListener(name,handler){this.listeners[name]=handler;},replaceChildren(){},append(){}});return elements.get(id);}
const config={name:'Idle race',area:{south:39.908,west:116.459,north:39.91,east:116.462},source:{kind:'sample',file:'data/source.json'},style:{id:'comic',parameters:{}},quality:'balanced',seed:1,tiling:{sizeMeters:500},generation:{inferRoofs:false,landscapeEnabled:false},landmarks:{enabled:true,packages:[]}};
const api={dataSources:async()=>({defaults:{endpoint:'https://overpass.test/api',transport:'post',fallbackPolicy:'none',fallbackEndpoints:[]},providers:[]}),projects:async()=>({projects:[]}),stylePreview:async(id,style)=>({preview:{style,styleModule:null,baseUrl:'/preview/',sdkUrl:'/preview/sdk.js',report:{}}}),save:async(id,patch)=>({project:{id,config:{...config,...patch}}}),start:async()=>({job:{id:'export-job',kind:'export-web',status:'queued'}}),job:async id=>({job:id==='build-job'?{id,kind:'build',status:'succeeded'}:{id,kind:'export-web',status:'failed',diagnostics:[{message:'Injected export failure'}]}})};
const previousOption=globalThis.Option;globalThis.Option=class{};
let resolveIdle,idleEntered=false;
const idle=new Promise(resolve=>{resolveIdle=resolve;});
try{
 const context=vm.createContext({...apiHelpers,createStudioApi:()=>api,createProjectSettings,console,document:{getElementById:element},Option:globalThis.Option,window:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},location:{href:'http://127.0.0.1:4179/'},fetch:async()=>({ok:true,json:async()=>({bounds:[-100,0,-100,100,30,100],featureIndex:{}})}),setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},URL,Blob});
 const module=new vm.SyntheticModule(['loadProjectStyle','createCityViewer'],function(){this.setExport('loadProjectStyle',async style=>({...style,dispose(){}}));this.setExport('createCityViewer',async()=>{let view={position:[0,100,100],target:[0,0,0],fov:45};return {getView:()=>view,setView:next=>{view={...view,...next};},getStats:()=>({}),whenIdle:()=>{idleEntered=true;return idle;},dispose:async()=>{}};});},{context});await module.link(()=>{});await module.evaluate();
 const source=await readFile(new URL('../../studio/main.js',import.meta.url),'utf8');
 new vm.Script(source.replace(/^import .*;\r?\n/gm,'')+'\nglobalThis.review={state,settings,pollJob};',{importModuleDynamically:async()=>module}).runInContext(context);await new Promise(setImmediate);
 context.review.state.project={id:'p1'};context.review.state.config=config;context.review.settings.loadStyle(config.style);context.review.settings.loadSource(config.source);element('quality').value='balanced';
 for(const [name,value]of Object.entries(config.area))element(name).value=String(value);element('project-name').value=config.name;element('seed').valueAsNumber=1;element('tile-size').valueAsNumber=500;element('landmarks').checked=true;
 context.review.state.job={id:'build-job',kind:'build',status:'running'};
 const buildPoll=context.review.pollJob();for(let i=0;i<80&&!idleEntered;i++)await new Promise(setImmediate);assert.equal(idleEntered,true);assert.equal(element('web').disabled,false);
 await element('web').listeners.click({preventDefault(){}});
 const failedStatus=element('job-status').textContent;assert.match(failedStatus,/export-web.*failed/);assert.equal(context.review.state.job.status,'failed');
 resolveIdle();await buildPoll;
 const finalStatus=element('job-status').textContent;assert.equal(context.review.state.job.status,'failed');assert.equal(finalStatus,failedStatus);assert.match(element('diagnostics').textContent,/Injected export failure/);
}finally{globalThis.Option=previousOption;}
