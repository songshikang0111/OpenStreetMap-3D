import {createCityViewer} from '../../dist-sdk/city-ink.js';
performance.setResourceTimingBufferSize(50000);
let viewer,manifest;const diagnostics=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sample=()=>viewer.getStats();
globalThis.benchmark={
  async load(name,bounds,manifestUrl){
    await viewer?.dispose();const startupResources=performance.getEntriesByType('resource').map(item=>({url:item.name,transferSize:item.transferSize,encodedBodySize:item.encodedBodySize,duration:item.duration}));performance.clearResourceTimings();diagnostics.length=0;
    const url=new URL(manifestUrl||`../../work/remediation-integration-scenes/${name}/manifest.json`,import.meta.url);
    // Camera bounds come from the same manifest read by the Node runner. Asset
    // loading here follows the SDK's real default fetch path exactly once.
    manifest={bounds};const started=performance.now();
    viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl:url.href,style:'comic',quality:'balanced',onDiagnostic:d=>diagnostics.push(d)});
    globalThis.cityViewer=viewer;
    await viewer.whenIdle({timeoutMs:90000});await sleep(300);
    const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');
    const cold=sample();if(!Number.isFinite(cold.firstRenderedAtMs))throw new Error('SDK did not record actual rendered content.');
    return {cold,wallLoadMs:performance.now()-started,firstUsableSceneMs:cold.firstRenderedAtMs-started,firstUsableFromNavigationMs:cold.firstRenderedAtMs,completeSceneMs:cold.loadRequestedAtMs+cold.allLoadedMs-started,completeFromNavigationMs:cold.loadRequestedAtMs+cold.allLoadedMs,startupResources,manifestBounds:manifest.bounds,hardware:{userAgent:navigator.userAgent,webgl:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),vendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),gpuTimerExtension:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')}};
  },
  async measure(seconds=60){
    const [x0,,z0,x1,y1,z1]=manifest.bounds,cx=(x0+x1)/2,cz=(z0+z1)/2,span=Math.max(x1-x0,z1-z0),focus=Math.min(40,y1*.25);
    const keys=[
      {t:0,position:[cx+span*.7,span*.9,cz+span],target:[cx,focus,cz],fov:45},
      {t:10,position:[x0+span*.25,25,z0+span*.3],target:[cx,20,cz],fov:55},
      {t:22,position:[x1-span*.2,30,z1-span*.25],target:[cx,18,cz],fov:55},
      {t:34,position:[cx-span*.8,span*1.5,cz-span*.8],target:[cx,focus,cz],fov:40},
      {t:37,position:[cx+span*.05,22,cz+span*.09],target:[cx,18,cz-span*.14],fov:30},
      {t:42,position:[cx+span,span*1.2,cz+span],target:[cx,focus,cz],fov:70},
      {t:50,position:[cx-span*.4,20,cz+span*.2],target:[cx+span*.4,20,cz-span*.2],fov:50},
      {t:60,position:[cx+span*.7,span*.9,cz+span],target:[cx,focus,cz],fov:45},
    ];
    viewer.setView(keys[0]);await viewer.whenIdle({timeoutMs:90000});await sleep(2500);viewer.resetStats();
    const samples=[],start=performance.now();let next=0;
    await new Promise(resolve=>{function step(now){
      const elapsed=(now-start)/1000,t=Math.min(60,elapsed/seconds*60);let i=keys.findIndex((key,index)=>index<keys.length-1&&t>=key.t&&t<=keys[index+1].t);if(i<0)i=keys.length-2;
      const a=keys[i],b=keys[i+1],u=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t))),mix=(x,y)=>x.map((value,index)=>value+(y[index]-value)*u);
      viewer.setView({position:mix(a.position,b.position),target:mix(a.target,b.target),fov:a.fov+(b.fov-a.fov)*u});
      if(elapsed>=next){const stats=sample();samples.push({second:elapsed,runtime:stats.runtime,render:stats.rendering.last});next++;}
      if(elapsed<seconds)requestAnimationFrame(step);else resolve();
    }requestAnimationFrame(step);});
    return {durationSeconds:seconds,keys,samples,stats:viewer.getStats({raw:true}),diagnostics:[...diagnostics],transfers:performance.getEntriesByType('resource').map(item=>({url:item.name,transferSize:item.transferSize,encodedBodySize:item.encodedBodySize,decodedBodySize:item.decodedBodySize,duration:item.duration}))};
  },
  async stationary(view,seconds=15){
    viewer.setLodMode('auto');viewer.setView(view);await viewer.whenIdle({timeoutMs:90000});await sleep(2000);
    const baseline=sample();viewer.resetStats();const samples=[],start=performance.now(),measurementEpochMs=performance.timeOrigin+start;let next=0;
    await new Promise(resolve=>{function step(now){
      const elapsed=(now-start)/1000;
      if(elapsed>=next){const stats=sample();samples.push({second:elapsed,runtime:stats.runtime,nearAttachments:stats.nearAttachments,render:stats.rendering.last});next+=.1;}
      if(elapsed<seconds)requestAnimationFrame(step);else resolve();
    }requestAnimationFrame(step);});
    return {view,measurementEpochMs,endedEpochMs:performance.timeOrigin+performance.now(),durationSeconds:(performance.now()-start)/1000,baseline,samples,stats:viewer.getStats({raw:true})};
  },
  resources:()=>performance.getEntriesByType('resource').map(item=>({url:item.name,transferSize:item.transferSize,encodedBodySize:item.encodedBodySize,decodedBodySize:item.decodedBodySize,duration:item.duration})),
  async comparisons(){
    const home=viewer.getView(),result={};
    for(const mode of ['far','full','far']){
      viewer.setView(home);viewer.setLodMode(mode);await sleep(1200);await viewer.whenIdle({timeoutMs:90000});await sleep(1200);viewer.resetStats();await sleep(2000);
      result[mode==='far'&&result.far?'farAfter':mode]=sample();
    }
    viewer.setLodMode('auto');return result;
  },
  async lifecycle(){
    const home=viewer.getView(),[x0,,z0,x1,,z1]=manifest.bounds,cx=(x0+x1)/2,cz=(z0+z1)/2,span=Math.max(x1-x0,z1-z0),result=[];
    for(let cycle=0;cycle<5;cycle++){
      viewer.setView({position:[cx+span*6,span*.7,cz+span*6],target:[cx+span*9,span*.7,cz+span*9]});await sleep(2200);const away=sample();
      viewer.setView(home);await viewer.whenIdle({timeoutMs:90000});await sleep(2200);result.push({cycle,away,returned:sample()});
    }
    return result;
  },
  stats:sample,dispose:()=>viewer?.dispose(),
};
globalThis.benchmarkReady=true;
