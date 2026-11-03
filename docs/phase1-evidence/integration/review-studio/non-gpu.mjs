import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile,copyFile,cp} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {build as viteBuild} from 'vite';

const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.dirname(fileURLToPath(import.meta.url));
const consumer=path.join(directory,'consumer');
await mkdir(consumer,{recursive:true});
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,results:[]};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
async function command(args,cwd=root){
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error(`${code}: ${stdout}\n${stderr}`)));});
}
async function check(name,operation){try{const details=await operation();report.results.push({name,status:'pass',details});console.log(JSON.stringify({name,status:'pass'}));}catch(error){report.results.push({name,status:'fail',error:error.stack});console.error(JSON.stringify({name,status:'fail',error:error.message}));}await writeFile(path.join(directory,'non-gpu-results.json'),JSON.stringify(report,null,2));}
let installed,cli,project,real,api;
await check('independent offline package install / public entry points / strict declarations',async()=>{
 const packed=JSON.parse((await command([npm,'pack','--ignore-scripts','--json','--pack-destination',directory])).stdout)[0];
 assert.ok(!packed.files.some(({path:file})=>/^(?:work|public|\.city)/.test(file)||/\.(?:cink|glb|tgz)$/.test(file)));
 await writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'independent-city-review',private:true,type:'module'}));
 await command([npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund',path.join(directory,packed.filename)],consumer);
 installed=path.join(consumer,'node_modules/beijing-city-ink');cli=path.join(installed,'bin/city.js');
 for(const entry of ['src/sdk/index.js','src/core/index.js','src/styles/index.js','src/landmark-registry.js','src/data/index.js','src/local-server/index.js'])assert.ok(Object.keys(await import(pathToFileURL(path.join(installed,entry)))).length);
 await copyFile(path.join(root,'examples/quickstart/typecheck.ts'),path.join(consumer,'typecheck.ts'));
 await command([path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',path.join(consumer,'typecheck.ts')],consumer);
 api=await import(pathToFileURL(path.join(installed,'src/cli/project.js')));
 return {files:packed.files.length,archive:packed.filename,integrity:packed.integrity,offline:true};
});
await check('installed README sample commands / runtime save and static output',async()=>{
 project=path.join(consumer,'sample');
 const commands=[['init',project,'--sample','--json'],['build','--project',project,'--offline','--json'],['validate','--project',project,'--offline','--json']];
 for(const args of commands){const json=JSON.parse((await command([cli,...args],consumer)).stdout);assert.equal(json.status,'succeeded');}
 await api.patchProject(project,{camera:{position:[150,120,150],target:[0,10,0],fov:55},style:{id:'line',parameters:{}},quality:'low'});
 for(const args of [['validate','--project',project,'--offline','--json'],['export','web','--project',project,'--output','exports/nested','--json']]){const json=JSON.parse((await command([cli,...args],consumer)).stdout);assert.equal(json.status,'succeeded');}
 const config=JSON.parse(await readFile(path.join(project,'exports/nested/viewer-config.json')));assert.equal(config.camera.fov,55);assert.equal(config.style.id,'line');
 return {project,camera:config.camera,style:config.style};
});
await check('stranger recipe tutorial / real source geometry change / rollback',async()=>{
 const variant=path.join(consumer,'my-landmarks');
 await command([path.join(installed,'examples/quickstart/make-recipe-package.mjs'),variant],consumer);
 assert.equal(JSON.parse((await command([cli,'landmarks','check',variant,'--json'],consumer)).stdout).status,'succeeded');
 const source=JSON.parse(await readFile(path.join(root,'public/data/beijing-cbd.json'),'utf8'));
 const zun=source.elements.find(item=>item.type==='way'&&item.id===599547918);assert.ok(zun?.geometry?.length);
 const lat=zun.geometry.map(p=>p.lat),lon=zun.geometry.map(p=>p.lon),area={south:Math.min(...lat)-.001,west:Math.min(...lon)-.001,north:Math.max(...lat)+.001,east:Math.max(...lon)+.001};
 real=path.join(consumer,'real-zun');await api.createProject(real,{name:'Independent real China Zun',area,tiling:{sizeMeters:100}});
 const input=path.join(consumer,'real-zun.json');await writeFile(input,JSON.stringify({...source,elements:[zun]}));
 await command([cli,'data','import',input,'--project',real,'--json'],consumer);await command([cli,'build','--project',real,'--offline','--json'],consumer);
 const hashes=async()=>JSON.parse(await readFile(path.join(real,'dist/manifest.json'))).chunks.flatMap(chunk=>chunk.lods.filter(lod=>lod.id==='high').map(lod=>lod.hash));
 const initial=await hashes();
 assert.equal(JSON.parse((await command([cli,'landmarks','update',variant,'--project',real,'--json'],consumer)).stdout).status,'succeeded');
 const updated=await hashes();assert.notDeepEqual(updated,initial);
 assert.equal(JSON.parse((await command([cli,'validate','--project',real,'--json'],consumer)).stdout).status,'succeeded');
 assert.equal(JSON.parse((await command([cli,'landmarks','update','--project',real,'--rollback','--json'],consumer)).stdout).status,'succeeded');assert.deepEqual(await hashes(),initial);
 await command([cli,'export','web','--project',real,'--json'],consumer);
 const manifest=JSON.parse(await readFile(path.join(real,'dist/manifest.json')));
 return {input:'Real repository OSM way/599547918, complete geometry; not a live download',features:Object.keys(manifest.featureIndex).length,chunks:manifest.chunks.length,initial,updated,rollback:await hashes()};
});
await check('stranger style tutorial / roles / actual external application bundling',async()=>{
 await mkdir(path.join(consumer,'styles'),{recursive:true});await copyFile(path.join(installed,'examples/quickstart/sepia-style.js'),path.join(consumer,'styles/sepia.js'));
 const style=(await import(pathToFileURL(path.join(consumer,'styles/sepia.js')))).default;
 const styleApi=await import(pathToFileURL(path.join(installed,'src/styles/index.js')));styleApi.registerStyle(style);assert.equal(styleApi.getStyle('project-sepia'),style);
 const {Group,Mesh,BoxGeometry,MeshBasicMaterial}=await import(pathToFileURL(path.join(consumer,'node_modules/three/build/three.module.js')));
 const roles=['wall','glass','roof','structure','road','water','foliage','ground','facility','landmark'],group=new Group();
 for(const role of roles){const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.userData.city={schemaVersion:1,featureId:`review:${role}`,materialRole:role,inkClass:1};group.add(mesh);}
 const binding=styleApi.bindSceneStyle(group,{style:'project-sepia'});assert.deepEqual(binding.diagnostics,[]);assert.ok(group.children.every(mesh=>mesh.material.isMeshStandardMaterial));binding.dispose();for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}
 await writeFile(path.join(consumer,'index.html'),'<style>html,body,#city{width:100%;height:100%;margin:0}</style><div id="city"></div><script type="module" src="./main.js"></script>');
 await writeFile(path.join(consumer,'main.js'),`import {createCityViewer} from 'beijing-city-ink';\nimport {registerStyle} from 'beijing-city-ink/styles';\nimport sepia from './styles/sepia.js';\nregisterStyle(sepia);\nconst events=[];\nglobalThis.viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl:'./scene/manifest.json',style:'project-sepia',onDiagnostic:d=>events.push(d)});\nglobalThis.events=events;\nawait viewer.whenIdle();\nglobalThis.reviewReady=true;\n`);
 await viteBuild({configFile:false,root:consumer,base:'./',publicDir:false,logLevel:'warn',build:{outDir:'app',emptyOutDir:true}});
 await cp(path.join(project,'dist'),path.join(consumer,'app/scene'),{recursive:true});
 return {roles,application:path.join(consumer,'app'),style:'project-sepia',sourceCopiedFromTutorial:true};
});
await check('project camera schema and SDK accepted-range consistency',async()=>{
 const config=await api.readProject(project);
 const {validateProjectConfig}=await import(pathToFileURL(path.join(installed,'src/core/config.js')));
 const accepted=validateProjectConfig({...config,camera:{fov:170}}).valid;
 return {projectAcceptsFov170:accepted,sdkSourceRejectsOutside:'[5,140]',requiresBrowserReproduction:accepted};
});
report.status=report.results.every(result=>result.status==='pass')?'pass':'fail';await writeFile(path.join(directory,'non-gpu-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,directory}));process.exitCode=report.status==='pass'?0:1;
