import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {getStyle,validateStyle,resolveStyleSelection,loadProjectStyle} from '../../../../../src/styles/index.js';
import {bundleProjectStyle} from '../../../../../src/styles/project-bundle.js';
const root=path.resolve('work/root-remediation-architecture/replay/style-integer-'+Date.now());await mkdir(path.join(root,'styles'),{recursive:true});
const style={...getStyle('color'),id:'integer-style',parametersSchema:{type:'object',additionalProperties:false,properties:{count:{type:'integer',minimum:0,maximum:5,default:1}}}};
const pure={validStyle:validateStyle(style).id,resolved:resolveStyleSelection({...style,parameters:{count:1.25}}).parameters};
const text="import {MeshStandardMaterial} from 'three';export default {schemaVersion:1,id:'integer-style',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,parametersSchema:{type:'object',additionalProperties:false,properties:{count:{type:'integer',minimum:0,maximum:5,default:1}}},materialRoles:['facility'],fallbackRole:'facility',rebuildParameters:[],qualityHints:{},createMaterial(){return new MeshStandardMaterial();},createPipeline(){return {render(){},resize(){},dispose(){}}},dispose(){}};";
await writeFile(path.join(root,'styles/integer.js'),text);
const bundled=await bundleProjectStyle(root,{id:'integer-style',entry:'styles/integer.js',parameters:{count:-2.75}});
const bundleResult={status:'succeeded',style:bundled.style,module:bundled.module,files:bundled.report.files};
let packageHelper;try{await import('beijing-city-ink/styles/project-bundle');packageHelper={status:'succeeded'};}catch(e){packageHelper={status:'failed',code:e.code,message:e.message};}
const result={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pure,bundleResult,packageHelper};await writeFile('work/root-remediation-architecture/replay/style-findings.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
