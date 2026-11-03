import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safePath, readJSON, CityError } from '../data/common.js';

export async function acquireProjectLock(root){
  return acquireProcessLock(root,'.city-cache/task-owner.json');
}
export async function acquireProcessLock(root,relative,{code='PROJECT_BUSY'}={}){
  const busy=()=>new CityError(code,'job','Another CLI, batch or studio task owns this project or queue.','Wait for that task to finish or cancel it in its owning process.');
  function alive(owner){try{process.kill(owner.pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
  async function claim(relative,depth=0){
    if(depth>8)throw new CityError('LOCK_RECOVERY_LIMIT','job','Too many interrupted lock-recovery records.','Inspect .city-cache/task-owner.json recovery records and retry after stopping project tasks.');
    const file=await safePath(root,relative,{allowMissing:true});await mkdir(path.dirname(file),{recursive:true});const token=randomUUID();
    const write=()=>writeFile(file,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
    const release=async()=>{try{if((await readJSON(file)).token===token)await rm(file,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}};
    try{await write();return release;}catch(e){if(e.code!=='EEXIST')throw e;}
    let owner;try{owner=await readJSON(file);}catch(e){if(e.code==='ENOENT')throw busy();throw e;}
    if(alive(owner))throw busy();
    // The recovery claim serializes stale removal. If a recoverer itself died,
    // the next suffix provides the same arbitration before reclaiming it.
    const releaseRecovery=await claim(`${relative}.recovery`,depth+1);
    try{
      let current;try{current=await readJSON(file);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(current){if(current.token!==owner.token||alive(current))throw busy();await rm(file);}
      try{await write();return release;}catch(e){if(e.code==='EEXIST')throw busy();throw e;}
    }finally{await releaseRecovery();}
  }
  return claim(relative);
}
export async function withProjectLock(root,action){const release=await acquireProjectLock(root);try{return await action();}finally{await release();}}
