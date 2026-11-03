import path from 'node:path';import {fileURLToPath} from 'node:url';import {mkdir,readFile,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {createLocalServer} from '../../src/local-server/index.js';import {openLocalBrowser} from './browser-session-visible.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.dirname(fileURLToPath(import.meta.url)),downloads=path.join(directory,'downloads');await mkdir(downloads,{recursive:true});
const service=await createLocalServer({workspaceRoot:path.join(directory,'ui-workspace'),port:0,offline:true});let browser;
try{
 browser=await openLocalBrowser({root,startPath:service.url,headless:false,width:1600,height:1000});await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await browser.evaluate("document.title='Independent Studio Review '+location.port");await writeFile(path.join(directory,'ui-ready.json'),JSON.stringify({url:service.url}));console.log(JSON.stringify({url:service.url,title:'Independent Studio Review'}));
 while(true){
  let command;try{command=JSON.parse(await readFile(path.join(directory,'ui-command.json')));await rm(path.join(directory,'ui-command.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(command?.kind==='stop')break;
  if(command?.kind==='capture'){
   const state=await browser.evaluate(`(()=>{const value=id=>document.getElementById(id)?.value;return {url:location.href,jobStatus:document.getElementById('job-status').textContent,diagnostics:document.getElementById('diagnostics').textContent,style:value('style'),fov:value('fov'),area:Object.fromEntries(['south','west','north','east'].map(id=>[id,value(id)])),saved:localStorage.getItem('city-ink-studio'),empty:document.getElementById('empty').hidden,canvas:document.querySelector('#viewport canvas')?.getBoundingClientRect().toJSON()};})()`);
   const metrics=await browser.send('Page.getLayoutMetrics'),size=metrics.cssContentSize||metrics.contentSize,shot=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});await writeFile(path.join(directory,'screenshots',command.name+'.png'),Buffer.from(shot.data,'base64'));
   const files=[];for(const name of await readdir(downloads))files.push({name,bytes:(await stat(path.join(downloads,name))).size});await writeFile(path.join(directory,command.name+'.json'),JSON.stringify({date:new Date().toISOString(),state,files},null,2));console.log(JSON.stringify({captured:command.name,state,files}));
  }
  await new Promise(resolve=>setTimeout(resolve,200));
 }
}finally{await browser?.close();await service.close();console.log('Closed review browser and service');}
