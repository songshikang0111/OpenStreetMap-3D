// Reproducible local UI projects. Synthetic geometry is explicitly not live OSM proof.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createProject,readProject,patchProject} from '../src/cli/project.js';
import {buildProject} from '../src/cli/tasks.js';
import {createLocalServer} from '../src/local-server/index.js';
import {projectFixture} from '../test/helpers/project-style.js';
import {viewsForBounds} from '../studio/api.js';

const repository=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.some(arg=>!/^--(?:workspace|port)=/.test(arg)&&arg!=='--serve'))throw new Error('Use --workspace=path --port=4181 [--serve].');
const value=(name,fallback)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const workspace=path.resolve(repository,value('workspace','work/remediation-studio-final')),port=Number(value('port','4181'));
await mkdir(workspace,{recursive:true});
const prepared=[];
for(const name of ['official','external']){
  const root=path.join(workspace,name);let existing;
  try{existing=await readProject(root);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!existing){
    let style={id:'comic',parameters:{aoStrength:.12}};
    if(name==='external'){
      style=await projectFixture(root,{assetName:'paper #1%25.svg'});
      const file=path.join(root,style.entry),source=await readFile(file,'utf8');
      await writeFile(file,source.replace('properties:{warmth:',"properties:{aoStrength:{type:'number',minimum:0,maximum:1,default:.12},warmth:").replace('mode:2,parameters:{}','mode:2,parameters:context.parameters'));
      style={...style,parameters:{...style.parameters,aoStrength:.12}};
    }else await createProject(root,{sample:true,name:'Official style / synthetic offline sample'});
    await patchProject(root,{name:name==='external'?'Project sepia / declared JS CSS SVG': 'Official style / synthetic offline sample',style});
    await buildProject(root);
    const manifest=JSON.parse(await readFile(path.join(root,'dist/manifest.json'),'utf8'));
    await patchProject(root,{camera:{...viewsForBounds(manifest.bounds).street,fov:55}});
  }
  prepared.push({relativePath:name,reused:!!existing,config:(await readProject(root))});
}
const serving=args.includes('--serve'),service=await createLocalServer({workspaceRoot:workspace,port:serving?port:0,sample:false});
try{
  for(const project of prepared){
    const response=await fetch(service.url+'/api/projects/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relativePath:project.relativePath})});
    const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));project.id=value.project.id;
  }
  const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),workspace,url:serving?service.url:undefined,projects:prepared,notes:['Synthetic UI fixtures; separate formal CLI/Studio live fetch evidence is required.','Existing projects are preserved. Use a new --workspace for a fresh independent run.','Start the public service with node bin/city.js studio --workspace <workspace> --port 4181.']};
  await writeFile(path.join(workspace,'fixture-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(serving)await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{await service.close();}
