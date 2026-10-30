import test from 'node:test';
import assert from 'node:assert/strict';
import {inlayRoadPaint} from '../src/road-surface.js';
import {roadHeightAt} from '../src/road-grade.js';
import {area} from '../src/osm.js';
import clipping from 'polygon-clipping';
test('paint and asphalt partition one graded surface, even when two dashes overlap',()=>{
  const road={kind:'drive',polygon:[[0,0],[20,0],[20,8],[0,8]],level:'ramp',a:[0,0],b:[20,0],yA:0,yB:2,y:1};
  const paint={...road,kind:'dash',polygon:[[3,3],[12,3],[12,4],[3,4]],heightOffset:.018};
  const p=inlayRoadPaint({surfaces:[road],markings:[paint,{...paint,polygon:[[8,3],[15,3],[15,4],[8,4]]}]});
  assert(Math.abs([...p.surfaces,...p.markings].reduce((s,p)=>s+area(p.polygon),0)-160)<1e-7);
  for(const m of p.markings){for(const q of m.polygon)assert.equal(roadHeightAt(m,q),roadHeightAt(road,q));for(const s of p.surfaces)assert.equal(clipping.intersection([m.polygon],[s.polygon]).length,0);}
  assert(Math.abs(p.markings.reduce((s,p)=>s+area(p.polygon),0)-12)<1e-7);
});
test('a marking on a different deck cannot punch a hole in the ground road',()=>{
  const road={kind:'drive',polygon:[[0,0],[20,0],[20,8],[0,8]],level:'same',y:0};
  const p=inlayRoadPaint({surfaces:[road],markings:[{...road,y:6,kind:'dash'}]});
  assert.equal(p.markings.length,0);assert.deepEqual(p.surfaces[0].polygon,road.polygon);
});
