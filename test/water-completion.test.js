import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import clipping from 'polygon-clipping';
import { parseOSM,inside,area } from '../src/osm.js';
import { planLandscape } from '../src/landscape-plan.js';
import { planStreetLife } from '../src/streetlife.js';

const geometry=p=>[p.outer,...p.holes];
const coverage=polys=>polys.reduce((s,[outer,...holes])=>s+area(outer)-holes.reduce((n,h)=>n+area(h),0),0);
test('Sydney harbour is complete, clipped and non-overlapping; Opera House and gardens remain land',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../public/data/sydney-harbour.json',import.meta.url)));
  const data=parseOSM(raw),at=([lat,lon])=>{const p=data.project.point({lat,lon});return data.water.some(w=>inside(p,w.outer)&&!w.holes.some(h=>inside(p,h)));};
  assert(raw.metadata.completedAreas.some(r=>r.relation===1252425));
  assert(at([-33.8568,151.2185]));assert(at([-33.8565,151.2125]));
  assert(!at([-33.8568,151.2153]));assert(!at([-33.8600,151.2155]));
  const waterArea=coverage(data.water.map(geometry)),frameArea=(data.bounds[2]-data.bounds[0])*(data.bounds[3]-data.bounds[1]);
  assert(waterArea/frameArea>.6&&waterArea/frameArea<.9);
  assert(Math.abs(coverage(clipping.union(...data.water.map(geometry)))-waterArea)<.001);
  for(const w of data.water)for(const p of w.outer)assert(p[0]>=data.bounds[0]-.001&&p[0]<=data.bounds[2]+.001&&p[1]>=data.bounds[1]-.001&&p[1]<=data.bounds[3]+.001);
  const ground=planLandscape(data,{profile:{enabled:false}});
  assert.equal(ground.stats.inferredSites,0);assert(ground.surfaces.length>0);
  // Landscape booleans snap to a 1 mm grid; allow only the resulting sub-0.1 m²
  // shoreline slivers, never a garden patch or a metre-scale intrusion.
  for(const surface of ground.surfaces)assert(coverage(clipping.intersection(geometry(surface),data.water.map(geometry)))<.1);
  const vegetation=planStreetLife(data);
  for(const t of vegetation.trees.filter(t=>t.source!=='osm'))assert(!data.water.some(w=>inside([t.x,t.z],w.outer)&&!w.holes.some(h=>inside([t.x,t.z],h))));
});

test('partial water relations do not invent an ocean boundary or erase unrepresented islands',()=>{
  const raw={metadata:{bbox:[0,0,.01,.01]},elements:[{type:'relation',id:1,tags:{type:'multipolygon',natural:'water'},members:[{type:'way',ref:999,role:'outer'}]}]};
  const data=parseOSM(raw);assert.equal(data.water.length,0);assert.equal(data.stats.incompleteRelations,1);
});
