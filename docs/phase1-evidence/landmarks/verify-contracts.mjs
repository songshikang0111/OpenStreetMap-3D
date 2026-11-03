import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import pack from '../../../packages/landmarks/index.js';
import styles from '../../../packages/styles/index.js';
import cel from '../../../packages/styles/cel.js';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const dependencies=path.join(root,'work/browser/node_modules');
const {default:Ajv}=await import(pathToFileURL(path.join(dependencies,'ajv/dist/2020.js')));
const ajv=new Ajv(),checked=[];
for(const [name,items] of [['landmark-recipe',pack.recipes],['style',[...styles,cel]]]){
  const validate=ajv.compile(JSON.parse(fs.readFileSync(path.join(root,`schemas/${name}.schema.json`))));
  for(const item of items){if(!validate(item))throw new Error(JSON.stringify(validate.errors));checked.push({schema:name,id:item.id});}
}
const scratch=path.join(root,'work/contracts');fs.mkdirSync(scratch,{recursive:true});
fs.writeFileSync(path.join(scratch,'consumer.ts'),`import {createLandmarkRegistry,checkLandmarkPackage} from '../../src/landmark-registry.js';
import {bindSceneStyle,createStylePipeline,createStyleShared,registerStyle} from '../../src/styles/index.js';
import pack from '../../packages/landmarks/index.js';
import cel from '../../packages/styles/cel.js';
import {Group,WebGLRenderer,Scene,PerspectiveCamera} from 'three';
const registry=createLandmarkRegistry({recipes:pack.recipes});
const matches=registry.match([],{origin:{lat:39,lon:116},bounds:[],seed:1});
registry.generate(matches[0],{features:[]});checkLandmarkPackage(pack);registerStyle(cel);
const shared=createStyleShared();bindSceneStyle(new Group(),{style:{id:'comic'},shared});
createStylePipeline({renderer:new WebGLRenderer(),scene:new Scene(),camera:new PerspectiveCamera(),style:cel,shared});
`);
fs.writeFileSync(path.join(scratch,'tsconfig.json'),JSON.stringify({compilerOptions:{noEmit:true,strict:true,module:'NodeNext',target:'ES2022',moduleResolution:'NodeNext',paths:{three:['../browser/node_modules/@types/three/index.d.ts']},skipLibCheck:true},files:['consumer.ts']}));
execFileSync(process.execPath,[path.join(dependencies,'typescript/bin/tsc'),'-p',path.join(scratch,'tsconfig.json')],{cwd:root,stdio:'pipe'});
const report={date:'2026-11-03',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,checked,strictTypeConsumer:'pass'};
fs.writeFileSync(path.join(here,'contracts-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
