import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import clipping from 'polygon-clipping';
import { inlayPaint } from '../src/paint-inlay.js';
import { area } from '../src/osm.js';

test('Kyoto parking inlay remains a closed partition instead of aborting the city build',()=>{
  const {surface,paint}=JSON.parse(fs.readFileSync(new URL('fixtures/kyoto-paint-inlay.json',import.meta.url)));
  const result=inlayPaint(surface,paint);
  assert.equal(result.omitted,0);assert(result.pieces.length>0);assert(result.paint.length>0);
  assert(result.pieces.flat(3).every(Number.isFinite));
  const whole=clipping.union(result.pieces,...result.paint);
  const difference=clipping.xor(whole,[surface]);
  const changedArea=difference.reduce((sum,p)=>sum+area(p[0])-p.slice(1).reduce((n,h)=>n+area(h),0),0);
  assert(changedArea<.25,`precision repair must not materially alter the host footprint: ${changedArea} m²`);
  const paintedArea=polygons=>clipping.union(...polygons).reduce((n,p)=>n+area(p[0])-p.slice(1).reduce((s,h)=>s+area(h),0),0);
  // The fixture contains ~27.73 m² of stripes; ~1.8 m² lies outside its host.
  assert(paintedArea(result.paint)>25,'repair must retain the valid painted layout');
});
