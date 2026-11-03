import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safePath, readJSON, CityError } from '../data/common.js';

export async function acquireProjectLock(root){
  const file=await safePath(root,'.city-cache/task-owner.json',{allowMissing:true});
  await mkdir(path.dirname(file),{recursive:true});const token=randomUUID();
  const claim=()=>writeFile(file,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
  try{await claim();}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const owner=await readJSON(file);let alive=true;
    try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
    if(alive)throw new CityError('PROJECT_BUSY','job','Another CLI, batch or studio task is modifying this project.','Wait for that task to finish or cancel it in its owning process.');
    // Only reclaim the stale record we inspected.
    if((await readJSON(file)).token!==owner.token)throw new CityError('PROJECT_BUSY','job','Project ownership changed; retry later.');
    await rm(file);try{await claim();}catch(error){if(error.code==='EEXIST')throw new CityError('PROJECT_BUSY','job','Another process acquired the project.');throw error;}
  }
  return async()=>{try{if((await readJSON(file)).token===token)await rm(file,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}};
}
export async function withProjectLock(root,action){const release=await acquireProjectLock(root);try{return await action();}finally{await release();}}
