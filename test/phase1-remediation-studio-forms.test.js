import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSettings} from '../studio/project-settings.js';
import {createStudioApi} from '../studio/api.js';

test('Studio controls restore all external fields and retain drafts across official switches',()=>{
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',replaceChildren(...items){this.options=items;}});return elements.get(id);};
  const settings=createProjectSettings($),style={id:'sepia',entry:'styles/sepia.ts',dependencies:{palette:'styles/palette.js'},assets:['styles/paper #1.svg'],parameters:{aoStrength:.12}};
  settings.loadStyle(style);assert.equal($('style').value,'external');assert.equal($('external-style-fields').hidden,false);assert.deepEqual(settings.style(),style);
  $('style-parameters').value='{"aoStrength":0.23}';
  $('style').value='comic';settings.changeStyle();assert.deepEqual(settings.style(),{id:'comic',parameters:{}});assert.equal($('external-style-fields').hidden,true);
  $('style-parameters').value='{"aoStrength":0.12}';
  $('style').value='external';settings.changeStyle();assert.deepEqual(settings.style(),{...style,parameters:{aoStrength:.23}});
  $('style').value='comic';settings.changeStyle();assert.deepEqual(settings.style(),{id:'comic',parameters:{aoStrength:.12}});
  settings.loadStyle({id:'unknown',parameters:{aoStrength:.12}});assert.equal($('style').value,'external');assert.equal($('style-id').value,'unknown');assert.throws(()=>settings.style(),/入口/);
});

test('Studio source controls use effective defaults and label regional providers explicitly',()=>{
  const previousOption=globalThis.Option;globalThis.Option=class{constructor(text,value){Object.assign(this,{text,value});}};
  try{
    const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',replaceChildren(...items){this.options=items;}});return elements.get(id);};
    const settings=createProjectSettings($),providers=[{id:'global',name:'Global',endpoint:'https://global.test/api',transport:'post',coverage:'global'},{id:'europe',name:'Regional',endpoint:'https://europe.test/api',transport:'get',coverage:'Europe only'}];
    settings.configureSources({defaults:{...providers[0],fallbackPolicy:'none',fallbackEndpoints:[]},providers});
    assert.equal($('source-provider').value,'global');
    $('source-provider').value='europe';settings.chooseProvider();assert.match($('source-coverage').textContent,/Europe only/);assert.equal($('source-transport').value,'get');
    $('source-endpoint').value='http://127.0.0.1:8888/interpreter';settings.matchProvider();assert.equal($('source-provider').value,'custom');
    $('source-fallback-policy').value='unavailable';$('source-fallbacks').value='https://fallback.test/api';
    const source=settings.source({kind:'overpass',file:'data/source.json'});
    assert.deepEqual(source,{kind:'overpass',file:'data/source.json',provider:'custom',endpoint:'http://127.0.0.1:8888/interpreter',transport:'get',fallbackPolicy:'unavailable',fallbackEndpoints:['https://fallback.test/api']});
    settings.loadSource(source);assert.deepEqual(settings.source({kind:'overpass',file:'data/source.json'}),source);
  }finally{globalThis.Option=previousOption;}
});

test('Studio client sends explicit project source context and preview declarations',async()=>{
  const calls=[],api=createStudioApi({fetchImpl:async(url,options)=>{calls.push({url,...options});return{ok:true,json:async()=>({status:'succeeded'})};}});
  const style={id:'sepia',entry:'styles/sepia.js',parameters:{aoStrength:.12},dependencies:{},assets:[]};
  await api.dataSources();await api.search('CCTV','p/1');await api.stylePreview('p/1',style);
  assert.equal(calls[0].url,'/api/data-sources');assert.equal(calls[1].url,'/api/search?q=CCTV&projectId=p%2F1');
  assert.equal(calls[2].url,'/api/projects/p%2F1/style-preview');assert.deepEqual(JSON.parse(calls[2].body),{style});
});
