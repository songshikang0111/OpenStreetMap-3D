import {projectFixture} from './helpers/project-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {bundleProjectStyle} from '../src/styles/project-bundle.js';
import {loadProjectStyle,getStyle} from '../src/styles/index.js';
import {validateProjectConfig} from '../src/core/config.js';
import {createProject,patchProject} from '../src/cli/project.js';
import {buildProject} from '../src/cli/tasks.js';
import {exportProject} from '../src/cli/export.js';

test('project style bundles relative ESM, explicit dependency, CSS and asset; loader preserves saved parameters',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-style-export-'));
  try{
    const style=await projectFixture(root),bundle=await bundleProjectStyle(root,style);
    assert.equal(bundle.module.id,style.id);assert.equal(bundle.style.parameters.warmth,.23);
    assert(bundle.module.stylesheets.length);assert([...bundle.assets.keys()].some(f=>f.includes('/resources/')&&f.endsWith('.svg')));
    assert(Object.keys(bundle.report.inputs).includes('styles/palette.js'));assert(Object.keys(bundle.report.inputs).includes('styles/vendor.js'));
    await writeFile(path.join(root,'package.json'),'{"type":"module"}');
    for(const [relative,bytes] of bundle.assets){await mkdir(path.dirname(path.join(root,relative)),{recursive:true});await writeFile(path.join(root,relative),bytes);}
    // Node cannot load CSS; the browser acceptance separately exercises it.
    const loaded=await loadProjectStyle(bundle.style,{module:{...bundle.module,stylesheets:[]},baseUrl:pathToFileURL(path.join(root,'index.html')).href});
    assert.equal(loaded.parameters.warmth,.23);
    assert.equal((await bundleProjectStyle(root,{id:'comic',parameters:{aoStrength:.12}})).style.parameters.aoStrength,.12);
    await assert.rejects(loadProjectStyle(bundle.style,{module:{...bundle.module,id:'other'},baseUrl:pathToFileURL(path.join(root,'index.html')).href}),/descriptor/);
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});

test('unknown or broken project styles fail before replacing an existing standard site',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-style-atomic-'));
  try{
    await createProject(root,{sample:true});await buildProject(root);await exportProject(root,{format:'web'});
    const previous=await readFile(path.join(root,'site/viewer-config.json'),'utf8');
    const checks=[
      {id:'missing-style',parameters:{}},
      {id:'project-sepia',entry:'styles/missing.js',parameters:{}},
      {id:'comic',parameters:{aoStrength:2}},
    ];
    for(const style of checks){await patchProject(root,{style});await assert.rejects(exportProject(root,{format:'web'}));assert.equal(await readFile(path.join(root,'site/viewer-config.json'),'utf8'),previous);}
    const style=await projectFixture(path.join(root,'nested'));
    await writeFile(path.join(root,'nested/styles/vendor.js'),'export const accent = ;');
    await assert.rejects(bundleProjectStyle(path.join(root,'nested'),style),e=>e.code==='STYLE_BUNDLE_FAILED');
    assert(!(await readdir(path.join(root,'.city-cache'))).some(f=>f.startsWith('site-')));
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});

test('style configuration paths and import graph are explicit and cannot escape the project',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-style-graph-'));
  try{
    const style=await projectFixture(root),config=JSON.parse(await readFile(path.join(root,'city.config.json'),'utf8'));
    for(const override of [{entry:'../escape.js'},{dependencies:{three:'styles/vendor.js'}},{assets:['/outside.svg']},{assets:42}])assert.equal(validateProjectConfig({...config,style:{...style,...override}}).valid,false);
    await assert.rejects(bundleProjectStyle(root,{...style,dependencies:{}}),/Undeclared/);
    await assert.rejects(bundleProjectStyle(root,{...style,assets:[]}),/Undeclared style asset/);
    await writeFile(path.join(root,'styles/sepia.js'),"const location='./palette.js'; export const p=()=>import(location);export default {}; ");
    await assert.rejects(bundleProjectStyle(root,style),e=>e.code==='STYLE_BUNDLE_WARNING');
    await writeFile(path.join(root,'styles/sepia.js'),"import x from 'https://example.com/style.js';export default x;");
    await assert.rejects(bundleProjectStyle(root,style),/Undeclared or nonlocal/);
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});

test('project loader CSS ownership supports repeated opens and releases a previous project',async()=>{
  const previous=globalThis.document,links=[];
  globalThis.document={createElement(){return {remove(){const i=links.indexOf(this);if(i>=0)links.splice(i,1);}};},head:{append(link){links.push(link);queueMicrotask(()=>link.onload());}}};
  try{
    const descriptor={schemaVersion:1,id:'color',version:'1.0.0',entry:'./style.js',stylesheets:['./project.css']};
    const options={module:descriptor,baseUrl:'http://localhost/project/index.html',importModule:async()=>({default:getStyle('color')})};
    for(let i=0;i<5;i++){const style=await loadProjectStyle({id:'color'},options);assert.equal(links.length,1);style.dispose();style.dispose();assert.equal(links.length,0);}
    const a=await loadProjectStyle({id:'color'},options),b=await loadProjectStyle({id:'color'},options);assert.equal(links.length,2);a.dispose();assert.equal(links.length,1);b.dispose();assert.equal(links.length,0);
    await assert.rejects(loadProjectStyle({id:'color'},{...options,importModule:async()=>({default:{}})}));assert.equal(links.length,0);
  }finally{globalThis.document=previous;}
});

test('JS, CSS and descriptor asset URLs preserve hash/percent filename characters',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-style-encoding-'));
  try{
    const style=await projectFixture(root,{assetName:'paper#v2%done.svg'}),bundle=await bundleProjectStyle(root,style);
    const url=bundle.module.assets['styles/paper#v2%done.svg'];assert(url.includes('paper%23v2%25done.svg'));
    const scripts=[...bundle.assets].filter(([key])=>key.endsWith('.js')).map(([,value])=>new TextDecoder().decode(value)).join('\n');assert(scripts.includes('paper%23v2%25done.svg'));
    const css=[...bundle.assets].filter(([key])=>key.endsWith('.css')).map(([,value])=>new TextDecoder().decode(value)).join('\n');assert(!css.includes('#v2'));assert(!css.includes('%done'));
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});
