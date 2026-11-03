import path from 'node:path';
import { CityError, diagnostic, readJSON, hash, atomicWrite } from '../data/common.js';
import { searchPlaces } from '../data/search.js';
import { createProject, importData, readProject } from './project.js';
import { readRecipePackage } from './landmarks.js';
import { validateProject } from './tasks.js';
import { JobManager, workerRunner, inspectJob, requestJobCancel } from './jobs.js';
import { createLocalServer } from '../local-server/index.js';

export const HELP=`City Ink — local city toolchain
Usage: city <command> [options]
  init [path] --sample | --area south,west,north,east [--name text]
  search <query> [--offline] [--photon-url URL]
  data fetch --project path [--refresh] [--offline]
  data import <file.json> --project path
  build --project path [--resume JOB_ID] [--offline]
  batch <list.json> [--concurrency 1..4] [--resume]
  validate --project path [--offline]
  studio [--workspace path | --project path] [--port 4178]
  preview --project path [--port 4178]
  export web|png|glb --project path [--output relative/path]
  landmarks check <package-dir>
  landmarks update <package-dir> --project path [--rollback]
  jobs status|cancel|resume <JOB_ID> --project path
Common: --json (one structured stdout result), --help, --offline, --project path
Exit codes: 0 success; 1 failed input/task; 2 partial/failed batch; 130 cancelled.
Batch file: {"projects":[{"project":"relative/path","kind":"build","parameters":{}}]}
Search coordinates: latitude,longitude. OSM: way/123 or https://openstreetmap.org/way/123.
Sample data is synthetic and explicitly labeled. Fetch is bounded to 5 km/side, 16 km².
PNG requires Playwright + Chromium; GLB uses full-region highest-detail standard materials.
Ordinary build/export/validate never refreshes network data. --resume retries failed/cancelled jobs.
`;
const flags=new Set(['json','help','offline','refresh','sample','rollback']);
const valued=new Set(['project','workspace','name','area','origin','port','concurrency','output','photon-url','cache']);
function parse(args){
  const options={},positionals=[];
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='-h'){options.help=true;continue;}
    if(!arg.startsWith('--')){positionals.push(arg);continue;}
    const name=arg.slice(2);
    if(flags.has(name))options[name]=true;
    else if(valued.has(name)){if(!args[i+1]||args[i+1].startsWith('--'))throw new CityError('MISSING_OPTION','cli',`--${name} requires a value.`);options[name]=args[++i];}
    else if(name==='resume')options.resume=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;
    else throw new CityError('UNKNOWN_OPTION','cli',`Unknown option ${arg}.`,'Run city --help.');
  }
  return {options,positionals};
}
const result=(extra={})=>({schemaVersion:1,status:'succeeded',artifacts:[],diagnostics:[],...extra});
export async function runBatch(file,{concurrency=1,resume=false,signal,runner=workerRunner}={}){
  const list=await readJSON(file);const entries=Array.isArray(list)?list:list.projects;
  if(!Array.isArray(entries)||!entries.length||entries.length>100)throw new CityError('INVALID_BATCH','batch','Batch requires 1–100 project entries.');
  const base=path.dirname(file),directory=path.join(base,'.city-cache',`batch-${hash(entries)}`);
  const manager=await new JobManager({directory:path.join(directory,'jobs'),concurrency,runner}).open();
  const stateFile=path.join(directory,'batch.json');let state={schemaVersion:1,items:[]};
  if(resume)try{state=await readJSON(stateFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  const cancel=()=>{for(const item of state.items)manager.cancel(item.id).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
    for(let i=0;i<entries.length;i++){
      const entry=typeof entries[i]==='string'?{project:entries[i]}:entries[i];
      if(!entry||typeof entry.project!=='string')throw new CityError('INVALID_BATCH','batch',`Entry ${i} requires project.`);
      let job;
      if(state.items[i])job=await manager.resume(state.items[i].id);
      else{job=await manager.enqueue(entry.kind||'build',path.resolve(base,entry.project),entry.parameters||{});state.items.push({index:i,id:job.id,project:entry.project});await atomicWrite(stateFile,state);}
      if(signal?.aborted)await manager.cancel(job.id);
    }
    const jobs=await Promise.all(state.items.map(item=>manager.wait(item.id)));
    const succeeded=jobs.filter(j=>j.status==='succeeded').length;
    return result({status:succeeded===jobs.length?'succeeded':jobs.some(j=>j.status==='cancelled')?'cancelled':succeeded?'partial':'failed',jobs,artifacts:jobs.flatMap(j=>j.artifacts.map(a=>path.join(j.project,a))),diagnostics:jobs.flatMap(j=>j.diagnostics),stateFile});
  }finally{signal?.removeEventListener('abort',cancel);await manager.close();}
}
export async function runCLI(args,{cwd=process.cwd(),stdout=process.stdout,stderr=process.stderr,signal,runner=workerRunner}={}){
  let options={},command;
  const emit=value=>{stdout.write(options.json?`${JSON.stringify(value)}\n`:value.help||`${value.status}: ${JSON.stringify(value)}\n`);return value;};
  try{
    const parsed=parse(args);options=parsed.options;const p=parsed.positionals;command=p[0];
    if(options.help||!command)return emit(result({help:HELP}));
    const root=path.resolve(cwd,options.project||'.');
    const allowedOffline=new Set(['search','data','build','batch','validate','export','init','preview','studio','landmarks','jobs']);
    if(options.offline&&!allowedOffline.has(command))throw new CityError('OFFLINE_UNSUPPORTED','cli','--offline is not supported here.');
    if(command==='init'){
      let area,origin;
      if(options.area){const nums=options.area.split(',').map(Number);if(nums.length!==4)throw new CityError('INVALID_AREA','cli','--area requires south,west,north,east.');area=Object.fromEntries(['south','west','north','east'].map((k,i)=>[k,nums[i]]));}
      if(options.origin){const [lat,lon]=options.origin.split(',').map(Number);origin={lat,lon};}
      if(!options.sample&&!area)throw new CityError('AREA_REQUIRED','init','Choose --sample or an explicit --area.');
      const directory=path.resolve(cwd,p[1]||options.project||'.');const config=await createProject(directory,{name:options.name||path.basename(directory),...(area?{area}:{}),origin,sample:!!options.sample});return emit(result({project:directory,config,artifacts:['city.config.json','city.lock.json',...(options.sample?[config.source.file]:[])]}));
    }
    if(command==='search'){const candidates=await searchPlaces(p.slice(1).join(' '),{cacheDir:path.resolve(cwd,options.cache||'.city-cache/search'),offline:options.offline,photonUrl:options['photon-url'],signal});return emit(result({candidates}));}
    if(command==='data'&&p[1]==='import'){if(!p[2])throw new CityError('FILE_REQUIRED','import','Specify a JSON file.');const imported=await importData(root,path.resolve(cwd,p[2]),{signal});return emit(result({artifacts:imported.artifacts,diagnostics:imported.diagnostics,contentHash:imported.contentHash}));}
    if(command==='validate')return emit(await validateProject(root));
    if(command==='landmarks'&&p[1]==='check'){if(!p[2])throw new CityError('PACKAGE_REQUIRED','landmarks','Specify a package directory.');const pack=await readRecipePackage(path.resolve(cwd,p[2]));return emit(result({hash:pack.hash,recipes:pack.recipes.map(r=>({id:r.id,version:r.version}))}));}
    if(command==='batch'){if(!p[1])throw new CityError('FILE_REQUIRED','batch','Specify a batch list.');return emit(await runBatch(path.resolve(cwd,p[1]),{concurrency:Number(options.concurrency||1),resume:!!options.resume,signal,runner}));}
    if(command==='studio'||command==='preview'){
      if(command==='preview')await readProject(root);
      const service=await createLocalServer({workspaceRoot:path.resolve(cwd,options.workspace||'.city-studio'),projectRoot:options.project||command==='preview'?root:undefined,port:options.port===undefined?4178:Number(options.port)});
      const active=emit(result({url:service.url,projects:[...service.projects.values()]}));
      const close=()=>service.close();signal?.addEventListener('abort',close,{once:true});
      return {...active,service};
    }
    if(command==='jobs'&&['status','cancel'].includes(p[1])){
      if(!p[2])throw new CityError('JOB_REQUIRED','job','Specify a job ID.');
      const job=await (p[1]==='status'?inspectJob:requestJobCancel)(path.join(root,'.city-cache/jobs'),p[2]);
      return emit(result({job,...(p[1]==='cancel'?{cancelRequested:true}:{})}));
    }
    const manager=await new JobManager({directory:path.join(root,'.city-cache/jobs'),runner:(job,progress,abort)=>runner(job,event=>{progress(event);stderr.write(`${JSON.stringify({jobId:job.id,...event})}\n`);},abort)}).open();
    let id;
    const cancel=()=>{if(id)manager.cancel(id).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
    try{
      let job;
      if(command==='jobs'){
        if(!p[2])throw new CityError('JOB_REQUIRED','job','Specify a job ID.');
        if(p[1]==='status')return emit(result({job:manager.get(p[2])}));
        if(p[1]==='cancel')return emit(result({job:await manager.cancel(p[2])}));
        if(p[1]!=='resume')throw new CityError('UNKNOWN_COMMAND','cli','Unknown jobs command.');
        job=await manager.resume(p[2]);
      }else if(options.resume){
        if(typeof options.resume!=='string')throw new CityError('JOB_REQUIRED','job','--resume requires an ID for a single job.');job=await manager.resume(options.resume);
      }else{
        let kind,parameters={};
        if(command==='build')kind='build';
        else if(command==='data'&&p[1]==='fetch'){kind='fetch';parameters={offline:!!options.offline,refresh:!!options.refresh};}
        else if(command==='export'&&['web','png','glb'].includes(p[1])){kind=`export-${p[1]}`;if(options.output)parameters.output=options.output;}
        else if(command==='landmarks'&&p[1]==='update'){kind='update-landmarks';parameters={rollback:!!options.rollback,...(p[2]?{packagePath:path.resolve(cwd,p[2])}:{})};}
        else throw new CityError('UNKNOWN_COMMAND','cli',`Unknown command ${p.join(' ')}.`,'Run city --help.');
        job=await manager.enqueue(kind,root,parameters);
      }
      id=job.id;if(signal?.aborted)await manager.cancel(id);
      const done=await manager.wait(id);return emit(result({status:done.status,job:done,artifacts:done.artifacts,diagnostics:done.diagnostics}));
    }finally{signal?.removeEventListener('abort',cancel);await manager.close();}
  }catch(error){return emit(result({status:error.name==='AbortError'?'cancelled':'failed',diagnostics:[diagnostic(error,command||'cli')]}));}
}
export function exitCode(output){return output.status==='succeeded'?0:output.status==='cancelled'?130:output.jobs?2:1;}
