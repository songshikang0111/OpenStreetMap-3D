// Check the requested and visible levels after refinement, including an unavoidable minimum-cover overrun.
// Run against apps/demo/dist after building the demo with the Enkhuizen tiles.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const dist = fileURLToPath(new URL('../../apps/demo/dist/', import.meta.url));
const tiles = './tiles/enkhuizen/tileset.json';
const page = await openPage(dist, 'index.html?hud=0&panel=0&tiles=' + encodeURIComponent(tiles), { headless: true });
try {
  await page.waitFor('!!globalThis.createCityMap');
  await page.evaluate('cityMap.dispose()');
  const result = await page.evaluate(`(async()=>{
    const cases={};
    for(const [name,quality] of Object.entries({balanced:'balanced',minimum:{visibleTriangles:1,residentBytes:1}})){
      const container=document.createElement('div');
      container.style.cssText='position:fixed;inset:0';
      document.body.append(container);
      const diagnostics=[];
      const m=await createCityMap({container,tiles:${JSON.stringify(tiles)},center:[5.291,52.702],zoom:18.5,pitch:35,bearing:0,quality,
        onDiagnostic:d=>diagnostics.push(d.code)});
      try{
        await m.whenIdle({timeoutMs:60000});
        const visible=()=>m.getStats({raw:true}).raw.tiles.filter(e=>e.visible).map(e=>e.key).sort();
        const initial=visible(), r0=m.getStats().requests.started;
        let emptyFrames=0;
        for(let i=0;i<125;i++){
          if(i===10 || i===30 || i===70)m.jumpTo({bearing:i===30?0.001:0});
          await new Promise(r=>requestAnimationFrame(r));
          if(!m.getStats().tiles.visible) emptyFrames++;
        }
        await m.whenIdle({timeoutMs:60000});
        cases[name]={initial,final:visible(),emptyFrames,additionalRequests:m.getStats().requests.started-r0,
          diagnostics:[...new Set(diagnostics)],budgetWarnings:diagnostics.filter(x=>x==='TILE_MINIMUM_COVER_OVER_BUDGET').length};
      }finally{await m.dispose();container.remove();}
    }
    return cases;
  })()`);
  assert.ok(result.balanced.initial.some((key) => key.startsWith('16/')));
  assert.ok(result.minimum.initial.length && result.minimum.initial.every((key) => key.startsWith('14/')));
  assert.equal(result.minimum.budgetWarnings, 1);
  for (const entry of Object.values(result)) {
    assert.deepEqual(entry.initial, entry.final);
    assert.equal(entry.additionalRequests, 0);
    assert.equal(entry.emptyFrames, 0);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.close();
}
