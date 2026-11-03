import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openLocalBrowser} from '../../../../src/cli/browser-session.js';
const root=process.cwd(),base=path.join(root,'work/root-remediation-acceptance'),directory=path.join(base,`ao-${Date.now()}`);
await fs.mkdir(directory,{recursive:true});await fs.copyFile(new URL('./ao-probe.html',import.meta.url),path.join(directory,'probe.html'));
const cli=args=>JSON.parse(execFileSync(process.execPath,[path.join(root,'bin/city.js'),...args,'--json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const project=path.join(directory,'project');assert.equal(cli(['init',project,'--sample']).status,'succeeded');assert.equal(cli(['build','--project',project,'--offline']).status,'succeeded');
const browser=await openLocalBrowser({root,startPath:path.relative(root,path.join(directory,'probe.html')).replaceAll('\\','/'),width:960,height:760});
const checks=[];
try{
  await browser.evaluate(`(async()=>{const end=performance.now()+20000;while(!globalThis.probeReady){if(performance.now()>end)throw Error('Probe page not ready');await new Promise(r=>setTimeout(r,40));}})()`);
  for(const quality of ['balanced','low','high']){
    const actual=await browser.evaluate(`probe.create(${JSON.stringify(quality)},.12)`);assert.equal(actual.effectiveStrength,.12);assert.equal(actual.aoEnabled,quality!=='low');checks.push({quality,requested:.12,...actual});
  }
  await browser.evaluate("probe.create('balanced',.12)");
  const pngs=[];
  for(const strength of [0,.12,.9]){
    const actual=await browser.evaluate(`probe.setStrength(${strength})`);assert.equal(actual.effectiveStrength,strength);assert.equal(actual.aoEnabled,true);
    const bytes=Buffer.from(await browser.evaluate('probe.png()')),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    await fs.writeFile(path.join(directory,`ao-${strength}.png`),bytes);pngs.push({strength,sha256,bytes:bytes.length});checks.push({quality:'balanced',requested:strength,...actual});
  }
  assert.equal(new Set(pngs.map(p=>p.sha256)).size,3,'AO parameter did not change exported image bytes');
  assert.equal(browser.events.filter(e=>e.level==='error').length,0,JSON.stringify(browser.events));assert.equal(browser.network.filter(r=>!r.allowed).length,0);
  await browser.evaluate('probe.dispose()');
  const result={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'pass',mode:'Independent public createCityViewer, official createInkPipeline service observed through a custom StylePack factory; actual WebGL/PNG, no GPU performance claim',checks,pngs,networkPolicy:browser.networkPolicy,errors:browser.events};
  await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(base,'ao-latest.json'),JSON.stringify({directory,...result},null,2));console.log(JSON.stringify({status:result.status,directory,checks:checks.length}));
}finally{await browser.close();}
