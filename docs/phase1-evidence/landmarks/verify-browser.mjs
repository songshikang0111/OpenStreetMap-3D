import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const modulePath=process.env.CITY_PLAYWRIGHT_MODULE||path.join(root,'work/browser/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(modulePath));
const executablePath=process.env.CITY_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath,headless:true});
const errors=[],consoleWarnings=[];
try{
  const page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')consoleWarnings.push(m.text());});
  await page.goto(`${process.env.CITY_BROWSER_BASE||'http://127.0.0.1:5193'}/docs/phase1-evidence/landmarks/browser.html`);
  await page.waitForFunction(()=>window.ready,{timeout:30000});
  const results=[];
  for(const id of ['comic','line','color','white','external-cel']){
    const result=await page.evaluate(id=>window.runStyle(id),id);assert(result.nonWhitePixels>10000,`${id} blank render`);
    for(const role of ['road','water','foliage','glass'])assert(result.roles.includes(role),`Missing ${role}`);
    results.push(result);await page.screenshot({path:path.join(here,`${id}.png`)});
  }
  assert.deepEqual(errors,[],'Browser/shader errors');
  const report={date:'2026-11-03',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),environment:{...(await page.evaluate(()=>window.environment)),platform:os.platform(),cpu:os.cpus()[0]?.model},results,errors,warnings:consoleWarnings,scope:'Component WebGL/decoded shader acceptance, not full-city GPU performance or SDK integration'};
  fs.writeFileSync(path.join(here,'browser-results.json'),JSON.stringify(report,null,2));
  await page.evaluate(()=>window.finish());console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
