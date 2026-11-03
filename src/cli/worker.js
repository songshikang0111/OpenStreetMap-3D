import { parentPort, workerData } from 'node:worker_threads';
import { runProjectTask } from './tasks.js';
import { diagnostic } from '../data/common.js';
const controller=new AbortController();
const requests=new Map();let requestId=0;
parentPort.on('message',message=>{
  if(message.type==='cancel') controller.abort(new DOMException('Task cancelled','AbortError'));
  if(message.type==='response'){
    const pending=requests.get(message.id);if(!pending)return;requests.delete(message.id);
    message.error?pending.reject(Object.assign(new Error(message.error.message),message.error)):pending.resolve(message.value);
  }
});
const request=(url,init)=>new Promise((resolve,reject)=>{
  const id=++requestId;requests.set(id,{resolve,reject});
  parentPort.postMessage({type:'request',id,url,init:{method:init.method,body:init.body?.toString(),headers:init.headers}});
});
try {
  const result=await runProjectTask(workerData.kind,workerData.project,workerData.parameters,{signal:controller.signal,request,onProgress:progress=>parentPort.postMessage({type:'progress',progress})});
  parentPort.postMessage({type:'result',result});
} catch(error) { parentPort.postMessage({type:'error',cancelled:controller.signal.aborted,error:diagnostic(error)}); }
finally { parentPort.close(); }
