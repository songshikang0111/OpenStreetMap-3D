import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {getStyle,validateStyle,resolveStyleSelection} from '../../../../../src/styles/index.js';
import {createProject,patchProject} from '../../../../../src/cli/project.js';
import {buildProject} from '../../../../../src/cli/tasks.js';
import {exportProject} from '../../../../../src/cli/export.js';
import {hash} from '../../../../../src/data/common.js';
const records=[];
const pack=rule=>({...getStyle('color'),id:'integer-style',parametersSchema:{type:'object',additionalProperties:false,properties:{count:rule}}});
async function check(name,fn){try{const value=await fn();records.push({name,status:'pass',value});}catch(e){records.push({name,status:'fail',message:e.message});}}
const integer={type:'integer',minimum:0,maximum:5,default:1};
for(const value of [0,1,5])await check(`integer valid ${value}`,()=>assert.equal(resolveStyleSelection({...pack(integer),parameters:{count:value}}).parameters.count,value));
for(const value of [-1,6,1.25,null,'1',true])await check(`integer invalid ${JSON.stringify(value)}`,()=>assert.throws(()=>resolveStyleSelection({...pack(integer),parameters:{count:value}})));
await check('integer default is retained',()=>assert.equal(resolveStyleSelection(pack(integer)).parameters.count,1));
for(const rule of [{type:'array'},{type:'object'},{type:'nonsense'},{type:'integer',default:1.25},{type:'integer',minimum:0,default:-1},{type:'number',default:null},{type:'integer',enum:[1,'2']},{type:'number',minimum:2,maximum:1}])await check(`invalid rule ${JSON.stringify(rule)}`,()=>assert.throws(()=>validateStyle(pack(rule))));
for(const [name,values] of [['Array(1)',Array(1)],['[1,,]',[1,,]]])await check(`sparse enum ${name}`,()=>assert.throws(()=>validateStyle(pack({type:'integer',enum:values}))));
for(const rule of [{type:'number',minimum:0,maximum:1,default:.12},{type:'boolean',default:false},{type:'string',default:'a',enum:['a','b']}])await check(`valid primitive ${rule.type}`,()=>assert.equal(resolveStyleSelection(pack(rule)).parameters.count,rule.default));
await check('official null does not silently default',()=>assert.throws(()=>resolveStyleSelection({id:'comic',parameters:{aoStrength:null}})));
await check('invalid standard export preserves existing site',async()=>{
 const root=path.resolve('work/root-remediation-architecture/replay/atomic-'+Date.now());await createProject(root,{sample:true});await buildProject(root);await exportProject(root,{format:'web'});const before=hash(await readFile(path.join(root,'site/viewer-config.json')));
 await mkdir(path.join(root,'styles'),{recursive:true});await writeFile(path.join(root,'styles/integer.js'),"import {MeshStandardMaterial} from 'three';export default {schemaVersion:1,id:'integer-style',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,parametersSchema:{type:'object',additionalProperties:false,properties:{count:{type:'integer',minimum:0,maximum:5,default:1}}},materialRoles:['facility'],fallbackRole:'facility',rebuildParameters:[],qualityHints:{},createMaterial(){return new MeshStandardMaterial();},createPipeline(){return {render(){},resize(){},dispose(){}}},dispose(){}};");
 await patchProject(root,{style:{id:'integer-style',entry:'styles/integer.js',parameters:{count:-2.75}}});let rejection;await assert.rejects(exportProject(root,{format:'web'}),e=>{rejection={code:e.code,message:e.message};return /^STYLE_/.test(e.code);});assert.equal(hash(await readFile(path.join(root,'site/viewer-config.json'))),before);return rejection;
});
await check('sparse enum module exports fail and preserve existing site',async()=>{
 const root=path.resolve('work/root-remediation-architecture/replay/sparse-'+Date.now());await createProject(root,{sample:true});await buildProject(root);await exportProject(root,{format:'web'});const before=hash(await readFile(path.join(root,'site/viewer-config.json')));await mkdir(path.join(root,'styles'),{recursive:true});const rejected=[];
 for(const expression of ['Array(1)','[1,,]']){
  const source="import {MeshStandardMaterial} from 'three';export default {schemaVersion:1,id:'sparse-style',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,parametersSchema:{type:'object',additionalProperties:false,properties:{count:{type:'integer',enum:"+expression+"}}},materialRoles:['facility'],fallbackRole:'facility',rebuildParameters:[],qualityHints:{},createMaterial(){return new MeshStandardMaterial();},createPipeline(){return {render(){},resize(){},dispose(){}}},dispose(){}};";
  await writeFile(path.join(root,'styles/sparse.js'),source);await patchProject(root,{style:{id:'sparse-style',entry:'styles/sparse.js',parameters:{}}});await assert.rejects(exportProject(root,{format:'web'}),e=>{rejected.push({expression,code:e.code,message:e.message});return e.code==='STYLE_MODULE_INVALID';});assert.equal(hash(await readFile(path.join(root,'site/viewer-config.json'))),before);
 }return rejected;
});
const result={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),records,failures:records.filter(r=>r.status==='fail').length};await writeFile('work/root-remediation-architecture/replay/parameter-retest.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.failures)process.exitCode=1;
