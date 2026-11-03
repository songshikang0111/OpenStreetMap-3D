import { setTimeout as delay } from 'node:timers/promises';
import { CityError, checkAbort } from './common.js';

const queues = new Map();
async function waitForQueue(promise,signal){
  if(!signal)return promise;
  checkAbort(signal);let abort;
  try{await Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
// All requests to an origin share a queue, including concurrent batch jobs.
export async function requestJSON(url, { fetchImpl = fetch, signal, timeoutMs = 75000, maxBytes = 32 * 1024 * 1024,
  retries = 2, minIntervalMs = 1100, sleep = (ms, signal) => delay(ms, undefined, { signal }), ...init } = {}) {
  const origin = new URL(url).origin;
  const previous = queues.get(origin) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate); queues.set(origin, tail);
  tail.then(()=>{if(queues.get(origin)===tail)queues.delete(origin);});
  let started=false;
  try {
    await waitForQueue(previous.catch(() => {}),signal);started=true;
    for (let attempt = 0; attempt <= retries; attempt++) {
      checkAbort(signal);
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new CityError('TIMEOUT', 'download', 'Request timed out.', 'Retry later or use a local JSON extract.')), timeoutMs);
      try {
        const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal,
          headers: { 'User-Agent': 'CityInk/1.0 (local small-area tool)', Accept: 'application/json', ...init.headers } });
        if (!response.ok) {
          await response.body?.cancel();
          const retryable = response.status === 429 || response.status >= 500;
          const seconds = Number(response.headers.get('retry-after'));
          const retryDate = Date.parse(response.headers.get('retry-after'));
          const waitMs = Math.max(minIntervalMs, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(retryDate) ? retryDate - Date.now() : 2000 * 2 ** attempt);
          if (retryable && attempt < retries && waitMs <= 60000) {
            clearTimeout(timer); await sleep(waitMs, signal); continue;
          }
          throw new CityError(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', 'download', `Source returned HTTP ${response.status}.`, 'Retry later using the same source, or import a local extract.');
        }
        if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new CityError('DOWNLOAD_LIMIT', 'download', 'Response exceeds size limit.'); }
        const chunks = []; let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > maxBytes) { const error=new CityError('DOWNLOAD_LIMIT', 'download', 'Response exceeds size limit.', 'Use a smaller area.');controller.abort(error);throw error; }
          chunks.push(chunk);
        }
        checkAbort(controller.signal);
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new CityError('INVALID_JSON', 'download', 'Source returned invalid JSON.'); }
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof CityError || attempt === retries) throw error;
        await sleep(Math.max(minIntervalMs, 2000 * 2 ** attempt), signal);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
  } finally {
    // Hold the queue through the cooldown, even after failure.
    if(started)await sleep(minIntervalMs).catch(() => {}); release();
  }
}
