import { parentPort, workerData } from 'node:worker_threads';
import { runProjectTask } from './tasks.js';
import { diagnostic } from '../data/common.js';
const controller=new AbortController();
parentPort.on('message',message=>{if(message.type==='cancel') controller.abort(new DOMException('Task cancelled','AbortError'));});
try {
  const result=await runProjectTask(workerData.kind,workerData.project,workerData.parameters,{signal:controller.signal,onProgress:progress=>parentPort.postMessage({type:'progress',progress})});
  parentPort.postMessage({type:'result',result});
} catch(error) { parentPort.postMessage({type:'error',cancelled:controller.signal.aborted,error:diagnostic(error)}); }
finally { parentPort.close(); }
