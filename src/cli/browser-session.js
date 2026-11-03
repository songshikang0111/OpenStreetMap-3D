import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {access,mkdtemp,readFile,rm,realpath} from 'node:fs/promises';

/** Small CDP harness for the CLI's own local viewer. It does not attach to user profiles. */
export async function openLocalBrowser({root,signal,headless=true,executable=process.env.CITY_BROWSER,width=1280,height=720,startPath=''}={}) {
  const browserCandidates=[executable,...(process.platform==='win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] : ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])].filter(Boolean);
  let browser;
  for(const candidate of browserCandidates) {try{await access(candidate);browser=candidate;break;}catch{}}
  if(!browser)throw Object.assign(new Error('No local Chromium browser found. Set CITY_BROWSER to an installed Chrome/Edge executable.'),{code:'BROWSER_UNAVAILABLE',stage:'export'});
  const profile=await mkdtemp(path.join(os.tmpdir(),'city-ink-browser-'));
  const realRoot=await realpath(root);
  const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.glb':'model/gltf-binary'};
  const server=http.createServer(async(req,res)=>{
    try {
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=await realpath(path.join(realRoot,name==='/'?'index.html':name.slice(1)));
      if(!file.startsWith(realRoot+path.sep))throw new Error('Path escape');
      res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');res.end(await readFile(file));
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=new URL(startPath,`http://127.0.0.1:${server.address().port}/`).href;
  const child=spawn(browser,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',`--window-size=${width},${height}`,...(headless?['--headless=new']:[]),url],{stdio:'ignore',windowsHide:true});
  let ws,sequence=0;const pending=new Map(),events=[];let exited=false;
  child.on('error',()=>{exited=true;});child.on('exit',()=>{exited=true;});
  const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
  async function close() {
    signal?.removeEventListener('abort',abort);ws?.close();child.kill();
    for(const value of pending.values())value.reject(new Error('Browser closed'));pending.clear();
    await new Promise(resolve=>server.close(resolve));
    for(let attempt=0;attempt<15;attempt++) {try{await rm(profile,{recursive:true,force:true});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  }
  try {
    let port;const deadline=Date.now()+20000;
    while(!port&&Date.now()<deadline) {
      if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');
      if(exited)throw new Error('Browser exited before CDP became available.');
      try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await new Promise(resolve=>setTimeout(resolve,100));}
    }
    if(!port)throw new Error('Browser debug endpoint timed out.');
    const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    const target=targets.find(item=>item.type==='page'&&item.url.startsWith(url));
    if(!target)throw new Error('Local viewer browser target missing.');
    ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{
      const response=JSON.parse(event.data),item=pending.get(response.id);
      if(item){pending.delete(response.id);response.error?item.reject(new Error(response.error.message)):item.resolve(response.result);}
      if(response.method==='Runtime.exceptionThrown')events.push({level:'error',type:'exception',message:response.params.exceptionDetails.exception?.description||response.params.exceptionDetails.text});
      if(response.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(response.params.type))events.push({level:response.params.type,message:response.params.args.map(arg=>String(arg.value??arg.description??'')).join(' ').slice(0,8000)});
      if(events.length>1000)events.shift();
    });
    ws.addEventListener('close',()=>{for(const item of pending.values())item.reject(new Error('Browser connection closed'));pending.clear();});
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser ${method} timed out`));},120000);
      pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      ws.send(JSON.stringify({id,method,params}));
    });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    return {url,browser,send,close,events,async evaluate(expression){
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    }};
  }catch(error){await close();throw error;}
}
