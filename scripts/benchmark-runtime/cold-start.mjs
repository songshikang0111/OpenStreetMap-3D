import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const base=process.env.CITY_BENCHMARK_URL||'http://127.0.0.1:5187',output=path.resolve(process.argv[2]||'docs/phase1-evidence/runtime/cold-start.json');
const matrix=JSON.parse(await fs.readFile('docs/phase1-evidence/runtime/browser/summary.json')),names=matrix.results.map(r=>r.name);
const browser=await chromium.launch({headless:true,...(process.env.CITY_BENCHMARK_BROWSER?{executablePath:process.env.CITY_BENCHMARK_BROWSER}:{})});
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),method:'Fresh browser context per sample. firstRenderedAtMs is navigation-origin time after the first geometry-containing whole frame has been submitted; firstRenderedMs/allLoadedMs include the manifest request. These are CPU/browser submission markers, not GPU/display-completion timestamps. Existing runtime.firstUsableMs is the earlier mount-only marker and is not reported as first visible content.',samples:[]};
try {
  for(const name of names){
    const context=await browser.newContext({viewport:{width:1280,height:794},deviceScaleFactor:1});await context.addInitScript(()=>performance.setResourceTimingBufferSize(10000));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/examples/embed/?fixture=${name}`);await page.waitForFunction(()=>globalThis.viewer||globalThis.startError);if(await page.evaluate(()=>!!globalThis.startError))throw new Error(await page.evaluate(()=>globalThis.startError));
    await page.evaluate(()=>viewer.whenIdle({timeoutMs:60000}));await page.waitForFunction(()=>viewer.getStats().firstRenderedMs!=null);
    const sample=await page.evaluate(()=>({stats:viewer.getStats(),scripts:[...document.scripts].map(s=>s.src).filter(Boolean),observedAtMs:performance.now()}));
    if(!(sample.stats.firstRenderedMs>0&&sample.stats.firstRenderedAtMs>=sample.stats.firstRenderedMs&&sample.stats.allLoadedMs!=null))throw new Error(`Missing first-render markers for ${name}`);
    report.samples.push({name,...sample,errors});if(errors.length)throw new Error(errors.join('; '));console.log(JSON.stringify({name,firstRenderedMs:sample.stats.firstRenderedMs,firstPageContentMs:sample.stats.firstRenderedAtMs,allLoadedMs:sample.stats.allLoadedMs}));
    await page.evaluate(()=>viewer.dispose());await context.close();
  }
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));
}finally{await browser.close();}
