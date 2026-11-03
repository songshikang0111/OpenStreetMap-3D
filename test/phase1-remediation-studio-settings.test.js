import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceFromForm,styleFromForm,jsonObject} from '../studio/settings.js';

test('studio explicitly preserves source identity while saving GET/self-host/fallback settings',()=>{
  const source={kind:'overpass',file:'data/source.json'},form={endpoint:'http://127.0.0.1:8888/interpreter',transport:'get',fallbackEndpoints:'https://other.example/api/interpreter\n',fallbackPolicy:'unavailable'};
  assert.deepEqual(sourceFromForm(source,form),{...source,endpoint:form.endpoint,transport:'get',fallbackEndpoints:['https://other.example/api/interpreter'],fallbackPolicy:'unavailable'});
  assert.deepEqual(source,{kind:'overpass',file:'data/source.json'});
  assert.equal(sourceFromForm(source,{...form,endpoint:'',fallbackEndpoints:''},{endpoint:'https://configured.example/interpreter'}).endpoint,'https://configured.example/interpreter');
  assert.throws(()=>sourceFromForm(source,{...form,endpoint:'https://user:secret@example.test/api'}));
  assert.throws(()=>sourceFromForm(source,{...form,fallbackEndpoints:form.endpoint}));
  assert.throws(()=>sourceFromForm(source,{...form,fallbackEndpoints:'https://one.test\nhttps://two.test\nhttps://three.test'}));
});
test('studio round-trips declared external entry, dependencies, assets and AO parameters',()=>{
  const form={option:'external',id:'project-sepia',entry:'styles/sepia.ts',parameters:'{"aoStrength":0.12,"tint":"#705030"}',dependencies:'{"@project/palette":"styles/palette.js"}',assets:'["styles/paper.png"]'};
  assert.deepEqual(styleFromForm(form),{id:'project-sepia',entry:'styles/sepia.ts',parameters:{aoStrength:.12,tint:'#705030'},dependencies:{'@project/palette':'styles/palette.js'},assets:['styles/paper.png']});
  assert.deepEqual(styleFromForm({...form,option:'comic',parameters:'{"aoStrength":0.12}'}),{id:'comic',parameters:{aoStrength:.12}});
  for(const text of ['[]','null','broken'])assert.throws(()=>jsonObject(text));
  for(const text of ['{"aoStrength":1e400}','{"nested":{"values":[0.12,-1e400]}}'])assert.throws(()=>jsonObject(text),/有限/);
  assert.throws(()=>styleFromForm({...form,assets:'{}'}));assert.throws(()=>styleFromForm({...form,entry:''}));
});
