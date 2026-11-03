import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {getStyle,registerStyle,validateStyle,resolveStyleSelection,loadProjectStyle} from '../src/styles/index.js';
import {bundleProjectStyle} from '../src/styles/project-bundle.js';
import {createProject,patchProject} from '../src/cli/project.js';
import {buildProject} from '../src/cli/tasks.js';
import {exportProject} from '../src/cli/export.js';

const pack=properties=>({...getStyle('color'),id:'parameter-contract-test',parametersSchema:{type:'object',additionalProperties:false,properties}});
const integer={type:'integer',minimum:0,maximum:5,default:1};

test('all four primitive types apply defaults only to omitted keys and validate supplied values',()=>{
  const style=pack({count:integer,ratio:{type:'number',minimum:0,maximum:1,default:0},enabled:{type:'boolean',default:false},label:{type:'string',enum:['','ink'],default:''},optional:{type:'string'}});
  assert.deepEqual(resolveStyleSelection(style).parameters,{count:1,ratio:0,enabled:false,label:''});
  assert.deepEqual(resolveStyleSelection({...style,parameters:{count:5,ratio:.25,enabled:true,label:'ink',optional:'yes'}}).parameters,{count:5,ratio:.25,enabled:true,label:'ink',optional:'yes'});
  for(const count of [-2.75,1.25,-1,6,NaN,Infinity,null,undefined,'2',true,{},[],Number.MAX_SAFE_INTEGER+1])assert.throws(()=>resolveStyleSelection({...style,parameters:{count}}),/Invalid style parameter count/);
  for(const parameters of [null,[],false,0,''])assert.throws(()=>resolveStyleSelection({...style,parameters}),/parameters must be an object/);
  for(const parameters of [{ratio:null},{ratio:NaN},{ratio:Infinity},{ratio:'0.5'},{ratio:-.1},{enabled:1},{enabled:null},{label:null},{label:'other'},{optional:undefined},{other:2}])assert.throws(()=>resolveStyleSelection({...style,parameters}));
  assert.equal(resolveStyleSelection({...style,parameters:{count:0}}).parameters.count,0);
  assert.equal(resolveStyleSelection(pack({count:{type:'integer',minimum:.5,maximum:2.5}})).parameters.count,undefined);
});

test('registration rejects unsupported schema rules and inconsistent bounds/defaults/enums',()=>{
  const invalidRules=[null,[],{},...['object','array','null','unknown'].map(type=>({type})),{type:['string','number']},
    {type:'integer',default:1.25},{type:'integer',default:Number.MAX_SAFE_INTEGER+1},{type:'integer',minimum:.1,maximum:.9},
    {type:'number',minimum:NaN},{type:'number',minimum:'0'},{type:'number',maximum:Infinity},{type:'number',minimum:3,maximum:2},
    {type:'number',minimum:0,default:-1},{type:'number',default:null},{type:'number',default:undefined},
    {type:'boolean',minimum:0},{type:'boolean',default:0},{type:'string',maximum:3},{type:'string',default:1},
    {type:'number',enum:[]},{type:'number',enum:Array(1)},{type:'number',enum:[1,,]},{type:'number',enum:[0,-0]},{type:'number',enum:[NaN]},{type:'number',enum:[1,'1']},
    {type:'number',minimum:0,enum:[-1,1]},{type:'integer',enum:[1,1.25]},{type:'boolean',enum:[true,null]},
    {type:'string',enum:['a','a']},{type:'string',enum:['a'],default:'b'},
    {type:'number',multipleOf:2},{type:'string',pattern:'x'},{type:'number',title:2}];
  for(const rule of invalidRules){const style=pack({value:rule});assert.throws(()=>validateStyle(style),/parameter schema/);assert.throws(()=>registerStyle(style),/parameter schema/);}
  for(const schema of [null,[],{type:'object',additionalProperties:false,properties:[]},{type:'object',additionalProperties:false,properties:{},required:[]}])assert.throws(()=>validateStyle({...getStyle('color'),parametersSchema:schema}));
  for(const rule of [{type:'integer',minimum:0,maximum:5,enum:[0,2],default:2},{type:'number',enum:[.5,1]},{type:'boolean',enum:[false],default:false},{type:'string',title:'Label',description:'Optional',enum:[''],default:''}])assert.doesNotThrow(()=>validateStyle(pack({value:rule})));
  const mutable=pack({count:{...integer}});registerStyle(mutable);mutable.parametersSchema.properties.count.type='unsupported';assert.throws(()=>resolveStyleSelection(mutable.id));mutable.parametersSchema.properties.count.type='integer';
});

test('loader rejects invalid integer values/defaults before replacing a registered style',async()=>{
  const current=pack({count:integer});registerStyle(current);
  const options={module:{schemaVersion:1,id:current.id,version:current.version,entry:'./style.js',stylesheets:[]},baseUrl:'http://localhost/site/viewer-config.json',importModule:async()=>({default:pack({count:integer})})};
  await assert.rejects(loadProjectStyle({id:current.id,parameters:{count:-2.75}},options),/Invalid style parameter count/);assert.equal(getStyle(current.id),current);
  await assert.rejects(loadProjectStyle({id:current.id,parameters:{count:2}},{...options,importModule:async()=>({default:pack({count:{...integer,default:null}})})}),/parameter schema/);assert.equal(getStyle(current.id),current);
  assert.equal((await loadProjectStyle({id:current.id,parameters:{count:2}},options)).parameters.count,2);
});

test('real bundle/export rejects illegal saved integer parameters and schema while retaining the old site',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-style-integer-'));
  try{
    await createProject(root,{sample:true});await buildProject(root);await mkdir(path.join(root,'styles'));
    const original=await readFile(new URL('../examples/quickstart/sepia-style.js',import.meta.url),'utf8');
    const write=rule=>writeFile(path.join(root,'styles/integer.js'),original.replace('properties:{}',`properties:{count:${JSON.stringify(rule)}}`));
    await write(integer);
    const selection={id:'project-sepia',entry:'styles/integer.js',parameters:{count:2}};
    await patchProject(root,{style:selection});const valid=await bundleProjectStyle(root,selection);assert.equal(valid.style.parameters.count,2);await exportProject(root,{format:'web'});
    const site=await readFile(path.join(root,'site/viewer-config.json'));
    for(const count of [-2.75,1.25,6,null]){
      const invalid={...selection,parameters:{count}};await patchProject(root,{style:invalid});
      await assert.rejects(bundleProjectStyle(root,invalid),error=>error.code==='STYLE_MODULE_INVALID');
      await assert.rejects(exportProject(root,{format:'web'}),error=>error.code==='STYLE_MODULE_INVALID');
      assert((await readFile(path.join(root,'site/viewer-config.json'))).equals(site));
    }
    for(const rule of [{type:'object'},{...integer,default:1.25},{...integer,enum:[-1,1]},{...integer,enum:[1,2],default:3}]){
      await write(rule);await patchProject(root,{style:selection});await assert.rejects(exportProject(root,{format:'web'}),error=>error.code==='STYLE_MODULE_INVALID');assert((await readFile(path.join(root,'site/viewer-config.json'))).equals(site));
    }
    for(const expression of ["{type:'integer',enum:Array(1)}","{type:'integer',enum:[1,,]}"]){
      await writeFile(path.join(root,'styles/integer.js'),original.replace('properties:{}',`properties:{count:${expression}}`));
      await assert.rejects(bundleProjectStyle(root,selection),error=>error.code==='STYLE_MODULE_INVALID');await assert.rejects(exportProject(root,{format:'web'}),error=>error.code==='STYLE_MODULE_INVALID');assert((await readFile(path.join(root,'site/viewer-config.json'))).equals(site));
    }
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});
