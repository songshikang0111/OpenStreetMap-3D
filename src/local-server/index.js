import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CityError, diagnostic, readJSON, atomicWrite, safePath } from '../data/common.js';
import { searchPlaces } from '../data/search.js';
import { createProject, readProject, patchProject, importData } from '../cli/project.js';
import { JobManager } from '../cli/jobs.js';
import { withProjectLock } from '../cli/project-lock.js';
import { resolveDataSource, expandDataSourceOverrides, DATA_SOURCE_FIELDS, DATA_SOURCE_PROVIDERS } from '../data/source.js';

const MIME={'.json':'application/json','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.glb':'model/gltf-binary','.svg':'image/svg+xml','.wasm':'application/wasm'};
const envelope=(extra={})=>({schemaVersion:1,status:'succeeded',artifacts:[],diagnostics:[],...extra});
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new CityError('CONTENT_TYPE','http','Use application/json for write requests.');
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw new CityError('BODY_LIMIT','http','Request exceeds 1 MiB.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}
  catch{throw new CityError('INVALID_JSON','http','Expected a JSON object.');}
}
function keys(value,allowed){for(const key of Object.keys(value))if(!allowed.includes(key))throw new CityError('INVALID_PARAMETER','http',`Unsupported parameter ${key}.`);}
export async function createLocalServer({workspaceRoot,projectRoot,port=4178,host='127.0.0.1',concurrency=1,runner,search=searchPlaces,studioRoot=fileURLToPath(new URL('../../studio/',import.meta.url)),sample=true,offline=false,dataSource={}}={}){
  if(!['127.0.0.1','localhost','::1'].includes(host))throw new CityError('LOCALHOST_ONLY','server','The studio service only binds loopback.');
  if(!Number.isInteger(port)||port<0||port>65535)throw new CityError('INVALID_PORT','server','Port must be 0–65535.');
  const sourceDefaults=resolveDataSource(dataSource);
  workspaceRoot=path.resolve(projectRoot||workspaceRoot||process.cwd());await mkdir(workspaceRoot,{recursive:true});
  const registryFile=await safePath(workspaceRoot,'.city-service/projects.json',{allowMissing:true});
  let jobs;
  const projects=new Map();let registryWrites=Promise.resolve(),vite;
  const persist=()=>{const entries=[...projects.values()];registryWrites=registryWrites.then(()=>atomicWrite(registryFile,entries));return registryWrites;};
  async function register(relativePath){
    const root=await safePath(workspaceRoot,relativePath);const config=await readProject(root);
    let project=[...projects.values()].find(p=>p.relativePath===relativePath);
    if(!project){project={id:randomUUID(),relativePath};projects.set(project.id,project);await persist();}
    return {...project,config};
  }
  try{for(const p of await readJSON(registryFile)){await safePath(workspaceRoot,p.relativePath);await readProject(await safePath(workspaceRoot,p.relativePath));projects.set(p.id,p);}}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(projectRoot)await register('.');
  else if(sample){
    try{await readProject(await safePath(workspaceRoot,'sample'));}
    catch(e){if(e.code!=='ENOENT')throw e;await createProject(await safePath(workspaceRoot,'sample',{allowMissing:true}),{name:'Offline synthetic sample',sample:true});}
    await register('sample');
  }
  jobs=await new JobManager({directory:await safePath(workspaceRoot,'.city-service/jobs',{allowMissing:true}),concurrency,runner,validateJob:async job=>{
    const relative=path.relative(workspaceRoot,job.project).replaceAll('\\','/')||'.';
    const root=await safePath(workspaceRoot,relative);
    if(![...projects.values()].some(p=>path.resolve(workspaceRoot,p.relativePath)===root))throw new CityError('JOB_PROJECT_ESCAPE','job','Persisted job project is not registered in this workspace.');
    if(job.parameters?.packagePath){const relativePackage=path.relative(workspaceRoot,job.parameters.packagePath).replaceAll('\\','/');await safePath(workspaceRoot,relativePackage);}
    if(job.parameters?.output)await safePath(root,job.parameters.output,{allowMissing:true});
    if(job.kind==='fetch')resolveDataSource(sourceDefaults,(await readProject(root)).source,job.parameters);
  }}).open();
  async function locate(id){const p=projects.get(id);if(!p)throw new CityError('PROJECT_NOT_FOUND','project',`Unknown project ${id}.`);return {p,root:await safePath(workspaceRoot,p.relativePath)};}
  async function staticFile(root,relative,res){
    const file=await safePath(root,relative);if(!(await stat(file)).isFile())throw new CityError('NOT_FOUND','http','File not found.');
    const data=await readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(data);
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const allowedHosts=new Set([`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`,`[::1]:${server.address().port}`]);
      if(!allowedHosts.has(req.headers.host))throw new CityError('HOST_REJECTED','http','Invalid local Host header.');
      if(req.headers.origin && (!allowedHosts.has(new URL(req.headers.origin).host)||new URL(req.headers.origin).protocol!=='http:'))throw new CityError('ORIGIN_REJECTED','http','Cross-origin requests are not allowed.');
      const url=new URL(req.url,'http://127.0.0.1'), route=decodeURIComponent(url.pathname);
      if(route==='/api/data-sources'&&req.method==='GET')return send(res,200,envelope({defaults:sourceDefaults,providers:DATA_SOURCE_PROVIDERS,limits:{maxFallbackEndpoints:2,maxSideMeters:5000,maxAreaKm2:16},fallbackOn:['network-error','timeout','HTTP 502/503/504'],neverFallbackOn:['HTTP 429/406','invalid-data','cancellation']}));
      if(route==='/api/search'&&req.method==='GET'){
        const config=url.searchParams.has('projectId')?await readProject((await locate(url.searchParams.get('projectId'))).root):undefined;
        return send(res,200,envelope({candidates:await search(url.searchParams.get('q'),{source:resolveDataSource(sourceDefaults,config?.source),cacheDir:await safePath(workspaceRoot,'.city-service/search',{allowMissing:true}),offline:offline||url.searchParams.get('offline')==='true'})}));
      }
      if(route==='/api/projects'&&req.method==='GET'){
        const list=[];for(const p of projects.values()){const config=await readProject((await locate(p.id)).root);list.push({...p,config,dataSource:resolveDataSource(sourceDefaults,config.source)});}
        return send(res,200,envelope({projects:list}));
      }
      if(route==='/api/projects'&&req.method==='POST'){
        const input=await body(req);keys(input,['name','area','origin','source','sample']);
        const relativePath=`projects/${randomUUID()}`;const root=await safePath(workspaceRoot,relativePath,{allowMissing:true});
        await createProject(root,{...input,source:{...expandDataSourceOverrides(dataSource),...input.source,...expandDataSourceOverrides(input.source)}});return send(res,201,envelope({project:await register(relativePath)}));
      }
      if(route==='/api/projects/open'&&req.method==='POST'){
        const input=await body(req);keys(input,['relativePath']);if(typeof input.relativePath!=='string')throw new CityError('INVALID_PARAMETER','project','relativePath is required.');
        return send(res,200,envelope({project:await register(input.relativePath)}));
      }
      const match=route.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/(jobs|import))?$/);
      if(match){
        const {p,root}=await locate(match[1]);
        if(!match[2]&&req.method==='GET'){const config=await readProject(root);return send(res,200,envelope({project:{...p,config,dataSource:resolveDataSource(sourceDefaults,config.source)},config}));}
        if(!match[2]&&req.method==='PATCH'){
          if([...jobs.jobs.values()].some(j=>j.project===root&&['running','queued'].includes(j.status)))throw new CityError('PROJECT_BUSY','config','Wait for or cancel this project’s jobs before editing.');
          const patch=await body(req);keys(patch,['name','area','origin','seed','source','generation','tiling','quality','style','landmarks','camera']);
          return send(res,200,envelope({project:{...p,config:await withProjectLock(root,()=>patchProject(root,patch))}}));
        }
        if(match[2]==='import'&&req.method==='POST'){
          if([...jobs.jobs.values()].some(j=>j.project===root&&['running','queued'].includes(j.status)))throw new CityError('PROJECT_BUSY','import','Wait for or cancel this project’s jobs before importing.');
          const input=await body(req);keys(input,['relativePath']);
          const result=await withProjectLock(root,async()=>importData(root,await safePath(workspaceRoot,input.relativePath)));return send(res,200,envelope({artifacts:result.artifacts,diagnostics:result.diagnostics}));
        }
        if(match[2]==='jobs'&&req.method==='POST'){
          const input=await body(req);keys(input,['kind','parameters','resume','refresh','offline','output','packagePath','rollback',...DATA_SOURCE_FIELDS]);
          if(!['fetch','build','export-web','update-landmarks'].includes(input.kind))throw new CityError('UNKNOWN_JOB','job','Unsupported studio job kind.');
          if(input.parameters&&(typeof input.parameters!=='object'||Array.isArray(input.parameters)))throw new CityError('INVALID_PARAMETER','job','parameters must be an object.');
          const flat=Object.fromEntries(['refresh','offline','output','packagePath','rollback',...DATA_SOURCE_FIELDS].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
          const parameters={...flat,...expandDataSourceOverrides(flat),...input.parameters,...expandDataSourceOverrides(input.parameters)};
          const allowed={fetch:['refresh','offline',...DATA_SOURCE_FIELDS],build:['offline'], 'export-web':['output','offline'], 'update-landmarks':['packagePath','rollback','offline']}[input.kind];keys(parameters,allowed);
          for(const flag of ['refresh','offline','rollback'])if(parameters[flag]!==undefined&&typeof parameters[flag]!=='boolean')throw new CityError('INVALID_PARAMETER','job',`${flag} must be boolean.`);
          if(offline)parameters.offline=true;
          if(parameters.packagePath)parameters.packagePath=await safePath(workspaceRoot,parameters.packagePath);
          if(parameters.output)await safePath(root,parameters.output,{allowMissing:true});
          let job;
          if(input.resume){
            const resumeId=input.resume===true?[...jobs.jobs.values()].reverse().find(j=>j.project===root&&j.kind===input.kind&&['failed','cancelled'].includes(j.status))?.id:input.resume;
            if(resumeId){const old=jobs.get(resumeId);if(old.project!==root||old.kind!==input.kind)throw new CityError('JOB_MISMATCH','job','Resume job belongs to a different project or kind.');const overrides={...parameters,...(input.kind==='fetch'?resolveDataSource(sourceDefaults,(await readProject(root)).source,old.parameters,parameters):{})};job=await jobs.resume(resumeId,overrides);}
          }
          if(!job)job=await jobs.enqueue(input.kind,root,{...parameters,...(input.kind==='fetch'?resolveDataSource(sourceDefaults,(await readProject(root)).source,parameters):{})});
          return send(res,202,envelope({job}));
        }
      }
      const jobMatch=route.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(cancel))?$/);
      if(jobMatch){
        const job=jobs.get(jobMatch[1]);if(![...projects.values()].some(p=>path.resolve(workspaceRoot,p.relativePath)===job.project))throw new CityError('JOB_NOT_FOUND','job','Job is not registered in this workspace.');
        if(req.method==='GET'&&!jobMatch[2])return send(res,200,envelope({job}));
        if(req.method==='POST'&&jobMatch[2]){await body(req);return send(res,200,envelope({job:await jobs.cancel(jobMatch[1])}));}
      }
      const asset=route.match(/^\/projects\/([a-f0-9-]+)\/(dist|site)\/(.+)$/);
      if(asset&&req.method==='GET'){const {root}=await locate(asset[1]);return await staticFile(await safePath(root,asset[2]),asset[3],res);}
      if(route.startsWith('/api/')||route.startsWith('/projects/'))throw new CityError('NOT_FOUND','http','Endpoint not found.');
      if(req.method!=='GET')throw new CityError('NOT_FOUND','http','Endpoint not found.');
      // Prefer an installed static studio build; source mode uses Vite's actual module graph.
      try{await stat(path.join(studioRoot,'dist/index.html'));return await staticFile(path.join(studioRoot,'dist'),route==='/'?'index.html':route.slice(1),res);}
      catch(e){if(e.code!=='ENOENT')throw e;}
      try{await stat(path.join(studioRoot,'index.html'));}
      catch{throw new CityError('STUDIO_UNAVAILABLE','studio','Studio UI has not been integrated.','Integrate studio/ from task E; the real API is available.');}
      if(route!=='/'&&!/^\/(studio|src|node_modules|@vite|@id)\//.test(route)&&!/^\/packages\/(styles|landmarks)\//.test(route))throw new CityError('NOT_FOUND','http','Resource is outside studio source roots.');
      if(!vite){const {createServer}=await import('vite');vite=await createServer({configFile:false,publicDir:false,root:path.dirname(studioRoot),server:{middlewareMode:true,hmr:{server},host:'127.0.0.1',fs:{allow:[path.dirname(studioRoot)]}},appType:'custom'});}
      if(route==='/'){
        const html=await vite.transformIndexHtml('/studio/index.html',await readFile(path.join(studioRoot,'index.html'),'utf8'));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      vite.middlewares(req,res,()=>send(res,404,envelope({status:'failed',diagnostics:[{code:'NOT_FOUND',stage:'studio',message:'Resource not found.',hint:'Check the studio build.'}]})));
    }catch(error){const status=/NOT_FOUND|ENOENT/.test(error.code)?404:/BUSY/.test(error.code)?409:/UNAVAILABLE/.test(error.code)?503:/HOST_REJECTED|ORIGIN_REJECTED|PATH_ESCAPE/.test(error.code)?403:400;send(res,status,envelope({status:'failed',diagnostics:[diagnostic(error)]}));}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
  catch(error){await jobs.close();throw new CityError(error.code==='EADDRINUSE'?'PORT_IN_USE':'SERVER_FAILED','server',error.message,'Choose an unused --port.');}
  return {server,jobs,projects,workspaceRoot,dataSource:sourceDefaults,url:`http://${host.includes(':')?`[${host}]`:host}:${server.address().port}`,close:async()=>{await jobs.close();await vite?.close();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
