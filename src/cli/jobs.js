import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { atomicWrite, readJSON, CityError, diagnostic } from '../data/common.js';
import { requestJSON } from '../data/http.js';
import { acquireProjectLock } from './project-lock.js';

const terminal=new Set(['succeeded','failed','cancelled']);
export const JOB_KINDS=['fetch','build','export-web','update-landmarks','export-png','export-glb'];
export function workerRunner(job,onProgress,signal) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{kind:job.kind,project:job.project,parameters:job.parameters}});
    let settled=false, timer, stage;
    const finish=(error,result)=>{
      if(settled)return; settled=true; clearTimeout(timer); signal.removeEventListener('abort',cancel);
      worker.terminate().catch(()=>{}); error?reject(error):resolve(result);
    };
    const cancel=()=>{
      worker.postMessage({type:'cancel'});
      timer=setTimeout(()=>{if(stage!=='publish') finish(new DOMException('Task cancelled','AbortError'));},1000);
    };
    worker.on('message',message=>{
      if(message.type==='request'){
        requestJSON(message.url,{...message.init,signal}).then(value=>{if(!settled)worker.postMessage({type:'response',id:message.id,value});},error=>{if(!settled)worker.postMessage({type:'response',id:message.id,error:diagnostic(error)});});
      }
      if(message.type==='progress'){stage=message.progress.stage;onProgress(message.progress);}
      if(message.type==='result')finish(null,message.result);
      if(message.type==='error')finish(message.cancelled?new DOMException('Task cancelled','AbortError'):Object.assign(new Error(message.error.message),message.error));
    });
    worker.on('error',finish);worker.on('exit',code=>{if(!settled)finish(new CityError('WORKER_EXIT','job',`Worker exited before reporting a result (${code}).`));});
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
}
export class JobManager {
  constructor({directory,concurrency=1,runner=workerRunner,validateJob=async()=>{}}={}) {
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new CityError('CONCURRENCY_LIMIT','job','Concurrency must be 1–4.');
    Object.assign(this,{directory,concurrency,runner,validateJob,jobs:new Map(),active:new Map(),waiters:new Map(),writes:Promise.resolve(),closed:false});
  }
  async open(){
    await mkdir(this.directory,{recursive:true});
    this.ownerFile=path.join(this.directory,'owner.json');
    try{await writeFile(this.ownerFile,JSON.stringify({pid:process.pid}),{flag:'wx'});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const owner=await readJSON(this.ownerFile);let alive=true;
      try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
      if(alive)throw new CityError('JOBS_BUSY','job','Another process owns this task queue.','Use jobs status/cancel, or wait for that process to finish.');
      await rm(this.ownerFile);await writeFile(this.ownerFile,JSON.stringify({pid:process.pid}),{flag:'wx'});
    }
    try{
    for(const file of await readdir(this.directory))if(/^[a-f0-9-]+\.json$/.test(file)){
      const job=await readJSON(path.join(this.directory,file));
      if(job.id!==file.slice(0,-5)||!JOB_KINDS.includes(job.kind)||typeof job.project!=='string'||!Array.isArray(job.diagnostics))throw new CityError('INVALID_JOB_STATE','job',`Invalid persisted job ${file}.`);
      await this.validateJob(job);
      if(!terminal.has(job.status)){job.status='failed';job.stage='interrupted';job.diagnostics.push({code:'INTERRUPTED',stage:'job',message:'Previous process ended before completion.',hint:'Resume this job explicitly.'});await this.persist(job);}
      this.jobs.set(job.id,job);
    }
    this.cancelPoll=setInterval(async()=>{
      for(const job of this.jobs.values())if(!terminal.has(job.status)){
        const marker=path.join(this.directory,`${job.id}.cancel`);
        try{await readJSON(marker);await this.cancel(job.id);await rm(marker,{force:true});}catch(e){if(e.code!=='ENOENT')this.lastPollError=diagnostic(e);}
      }
    },250);this.cancelPoll.unref();
    return this;
    }catch(error){clearInterval(this.cancelPoll);await rm(this.ownerFile,{force:true});throw error;}
  }
  persist(job){const value=structuredClone(job);this.writes=this.writes.catch(()=>{}).then(()=>atomicWrite(path.join(this.directory,`${job.id}.json`),value));return this.writes;}
  get(id){const job=this.jobs.get(id);if(!job)throw new CityError('JOB_NOT_FOUND','job',`Unknown job ${id}.`);return structuredClone(job);}
  async enqueue(kind,project,parameters={}){
    if(this.closed)throw new CityError('SERVICE_CLOSED','job','Job manager is closed.');
    if(!JOB_KINDS.includes(kind))throw new CityError('UNKNOWN_JOB','job',`Unsupported job kind ${kind}.`);
    const job={schemaVersion:1,id:randomUUID(),kind,project,parameters,status:'queued',stage:'queued',progress:0,artifacts:[],diagnostics:[],attempt:1,createdAt:new Date().toISOString()};
    await this.validateJob(job);
    this.jobs.set(job.id,job);await this.persist(job);this.pump();return this.get(job.id);
  }
  pump(){
    if(this.closed)return;
    for(const job of this.jobs.values()){
      if(this.active.size>=this.concurrency)break;
      if(job.status!=='queued'||[...this.active.values()].some(a=>a.project===job.project))continue;
      const controller=new AbortController();this.active.set(job.id,{controller,project:job.project});
      this.execute(job,controller).catch(()=>{});
    }
  }
  async execute(job,controller){
    job.status='running';job.stage='starting';job.startedAt=new Date().toISOString();
    let release;
    try{
      if(path.isAbsolute(job.project)){
        try{await readJSON(path.join(job.project,'city.config.json'));release=await acquireProjectLock(job.project);}catch(e){if(e.code!=='ENOENT')throw e;}
      }
      await this.persist(job);
      const result=await this.runner(structuredClone(job),p=>{
        if(terminal.has(job.status))return;
        if(typeof p==='string')job.stage=p;
        else {job.stage=p.stage||job.stage;job.progress=Math.max(0,Math.min(1,p.progress??job.progress));}
        this.persist(job).catch(()=>{});
      },controller.signal);
      if(result?.status && result.status!=='succeeded')throw new CityError('TASK_FAILED',job.stage,'Task returned a non-success result.');
      Object.assign(job,{status:'succeeded',stage:'complete',progress:1,artifacts:result?.artifacts||[],diagnostics:result?.diagnostics||[],result});
    }catch(error){job.status=controller.signal.aborted||error.name==='AbortError'?'cancelled':'failed';job.diagnostics.push(diagnostic(error,job.stage));}
    finally{
      job.finishedAt=new Date().toISOString();
      try{await this.persist(job);}
      catch(error){job.status='failed';delete job.result;job.artifacts=[];job.diagnostics.push({code:'JOB_PERSIST_FAILED',stage:'job',message:`Could not persist final job state: ${error.message}`,hint:'Free disk space or release locked job files, then resume explicitly.'});}
      try{await rm(path.join(this.directory,`${job.id}.cancel`),{force:true});await release?.();}catch(error){job.status='failed';job.diagnostics.push(diagnostic(error,'cleanup'));}
      this.active.delete(job.id);
      for(const resolve of this.waiters.get(job.id)||[])resolve(this.get(job.id));this.waiters.delete(job.id);this.pump();
    }
  }
  async cancel(id){
    const job=this.jobs.get(id);this.get(id);
    if(terminal.has(job.status))return this.get(id);
    job.cancelRequested=true;
    if(job.status==='queued'){
      job.status='cancelled';job.finishedAt=new Date().toISOString();await this.persist(job);
      for(const resolve of this.waiters.get(id)||[])resolve(this.get(id));this.waiters.delete(id);
    }else{this.active.get(id)?.controller.abort(new DOMException('Task cancelled','AbortError'));await this.persist(job);}
    return this.get(id);
  }
  async resume(id,parameters){
    const job=this.jobs.get(id);this.get(id);
    await this.validateJob(job);
    if(!terminal.has(job.status))return this.get(id);
    if(job.status==='succeeded')return this.get(id);
    if(parameters)job.parameters={...job.parameters,...parameters};
    await rm(path.join(this.directory,`${job.id}.cancel`),{force:true});
    Object.assign(job,{status:'queued',stage:'queued',progress:0,artifacts:[],diagnostics:[],attempt:job.attempt+1,cancelRequested:false});
    delete job.result;delete job.finishedAt;await this.persist(job);this.pump();return this.get(id);
  }
  wait(id){const job=this.get(id);if(terminal.has(job.status)&&!this.active.has(id))return this.writes.catch(()=>{}).then(()=>this.get(id));return new Promise(resolve=>{this.waiters.set(id,[...(this.waiters.get(id)||[]),resolve]);});}
  async close(){this.closed=true;clearInterval(this.cancelPoll);try{for(const job of this.jobs.values())if(!terminal.has(job.status))await this.cancel(job.id);await Promise.all([...this.active.keys()].map(id=>this.wait(id)));await this.writes.catch(()=>{});}finally{if(this.ownerFile)await rm(this.ownerFile,{force:true});}}
}
export async function inspectJob(directory,id){if(!/^[a-f0-9-]+$/.test(id))throw new CityError('JOB_NOT_FOUND','job','Invalid job ID.');return readJSON(path.join(directory,`${id}.json`));}
export async function requestJobCancel(directory,id){const job=await inspectJob(directory,id);if(!terminal.has(job.status))await atomicWrite(path.join(directory,`${id}.cancel`),{cancel:true});return job;}
