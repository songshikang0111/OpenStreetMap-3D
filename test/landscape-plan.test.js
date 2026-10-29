import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import clipping from 'polygon-clipping';
import { area, inside, parseOSM } from '../src/osm.js';
import { planRoadSurface } from '../src/road-surface.js';
import { planLandscape } from '../src/landscape-plan.js';

const square = (x, z, w, h = w) => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]];
const feature = (id, outer, kind, holes = []) => ({ id, outer, holes, kind, tags: {} });
const geometry = p => [p.outer, ...(p.holes || [])];
const totalArea = multi => multi.reduce((sum, p) => sum + area(p[0]) - p.slice(1).reduce((s, h) => s + area(h), 0), 0);
const at = (p, f) => inside(p, f.outer) && !(f.holes || []).some(h => inside(p, h));
const fixture = () => ({
  bounds: [-150, -150, 150, 150],
  buildings: [{ ...feature('office', square(-24, -20, 48, 40)), height: 90, minHeight: 0 }],
  roads: [{ id: 'east-road', segments: [[[78, -140], [78, 140]]], width: 12, type: 'secondary', tags: {}, bridge: false, layer: 0 }],
  water: [feature('pond', square(-75, -55, 28, 40))],
  landscapes: [feature('carpark', square(-42, 30, 30, 46), 'parking'), feature('works', square(5, -100, 40, 50), 'construction')],
  greens: [], streetNodes: [],
});

test('inferred courts respect buildings, roads, water, observed uses and frame', () => {
  const data = fixture(), roadPlan = planRoadSurface(data), plan = planLandscape(data, { roadPlan });
  const inferred = plan.surfaces.filter(s => s.source === 'inferred-landscape');
  assert(inferred.some(s => s.kind === 'paving'));
  assert(inferred.some(s => s.kind === 'lawn'));
  assert(inferred.some(s => s.kind === 'shrub'));
  const obstacles = [...data.buildings, ...data.water, ...data.landscapes].map(geometry);
  obstacles.push(...roadPlan.surfaces.map(s => [s.polygon]));
  for (const surface of inferred) {
    for (const ring of geometry(surface)) for (const p of ring) {
      assert(p.every(Number.isFinite));
      assert(p[0] >= -150 && p[0] <= 150 && p[1] >= -150 && p[1] <= 150);
    }
    assert(totalArea(clipping.intersection(geometry(surface), clipping.union(...obstacles))) < .001, 'landscaping must leave mapped features intact');
  }
  assert(plan.surfaces.some(s => s.source === 'osm' && s.kind === 'parking'));
  assert(plan.stats.unfilledAfterFraction < plan.stats.unfilledBeforeFraction);
});

test('central entry routes stay free of lawns, shrubs, trees and benches', () => {
  const data = fixture(), plan = planLandscape(data);
  assert(plan.sites.length > 0);
  for (const site of plan.sites) {
    const point = (x, z) => [site.origin[0] + site.u[0] * x + site.v[0] * z, site.origin[1] + site.u[1] * x + site.v[1] * z];
    for (let depth = site.start + .5; depth < site.depth - .5; depth += 1) for (const across of [-site.accessWidth * .45, 0, site.accessWidth * .45]) {
      const p = point(across, depth);
      assert(!plan.surfaces.some(s => s.id === site.key && /^(lawn|garden|shrub)$/.test(s.kind) && at(p, s)));
    }
    for (const tree of plan.trees.filter(t => t.key.startsWith(`${site.key}:`))) {
      const dx = tree.point[0] - site.origin[0], dz = tree.point[1] - site.origin[1];
      assert(Math.abs(dx * site.u[0] + dz * site.u[1]) > site.accessWidth / 2 + 2);
    }
    for (const bench of plan.props.filter(p => p.siteKey === site.key)) {
      const direction=[Math.sin(bench.angle),Math.cos(bench.angle)],normal=[direction[1],-direction[0]];
      const footprint=[[-.325,-1],[.325,-1],[.325,1],[-.325,1]].map(([a,b])=>[bench.point[0]+normal[0]*a+direction[0]*b,bench.point[1]+normal[1]*a+direction[1]*b]);
      for(const p of footprint){const dx=p[0]-site.origin[0],dz=p[1]-site.origin[1];assert(Math.abs(dx*site.u[0]+dz*site.u[1])>=site.accessWidth/2+.1,'the full bench must remain beside the entry corridor');}
      const paved=plan.surfaces.filter(s=>s.id===site.key&&s.kind==='paving').map(geometry);
      assert(totalArea(clipping.difference([footprint],paved))<.003,'the entire seat footprint, not only its corners, belongs on paving');
    }
  }
});

test('known polygon holes remain holes and can contain independent inferred courts', () => {
  const data = fixture(); data.roads = []; data.water = [];
  data.landscapes = [feature('work-ring', square(-100, -100, 200), 'construction', [square(-65, -65, 130)])];
  const plan = planLandscape(data);
  const known = plan.surfaces.filter(s => s.source === 'osm');
  assert(known.length > 0 && known.some(s => s.holes.length));
  assert(!known.some(s => at([0, 35], s)), 'the OSM inner ring is never painted over');
  assert(plan.surfaces.some(s => s.source === 'inferred-landscape' && at([0, 35], s)), 'an unassigned courtyard inside the hole remains usable');
  assert(plan.surfaces.filter(s => s.source === 'inferred-landscape').every(s => totalArea(clipping.intersection(geometry(s), geometry(data.landscapes[0]))) < .001));
});

test('same seed is stable, different seed only varies planting, and inference can be disabled', () => {
  const data = fixture();
  const first = planLandscape(data, { seed: 12 });
  assert.deepEqual(first, planLandscape(data, { seed: 12 }));
  const other = planLandscape(data, { seed: 13 });
  assert.deepEqual(first.surfaces, other.surfaces);
  assert.notDeepEqual(first.trees, other.trees);
  const off = planLandscape(data, { profile: { enabled: false } });
  assert(off.surfaces.length > 0 && off.surfaces.every(s => s.source === 'osm'));
  assert.equal(off.trees.length, 0); assert.equal(off.props.length, 0);
  const limited = planLandscape(data, { profile: { maxSites: 2, maxTrees: 1, maxProps: 1 } });
  assert(limited.stats.inferredSites <= 2 && limited.trees.length <= 1 && limited.props.length <= 1);
  const bounded = planLandscape(data, { profile: { maxSurfaces: 12 } });
  assert(bounded.surfaces.length <= 12, 'fragmented templates must obey the geometry budget too');
});

test('frontage geometry works after translation and rotation, without geographic IDs', () => {
  const data = fixture(); data.roads = []; data.water = []; data.landscapes = [];
  const original = planLandscape(data,{profile:{maxCommons:0}});
  const transform = ([x, z]) => [12000 - z, 9500 + x];
  const rotated = { ...data, bounds: [11850, 9350, 12150, 9650], buildings: data.buildings.map(b => ({ ...b, outer: b.outer.map(transform) })) };
  const result = planLandscape(rotated,{profile:{maxCommons:0}});
  assert.equal(result.sites.length, original.sites.length);
  assert(Math.abs(result.stats.inferredArea - original.stats.inferredArea) < .001);
  assert.equal(result.trees.length, original.trees.length);
  for (let i = 0; i < original.trees.length; i++) assert(Math.hypot(...transform(original.trees[i].point).map((v, k) => v - result.trees[i].point[k])) < 1e-6);
});

test('deep residual commons use large non-grid outlines and respect mapped/restricted ground',()=>{
  const data=fixture();data.bounds=[-240,-240,240,240];data.roads=[];data.water=[];
  data.landscapes=[feature('sport',square(70,35,100,80),'sport'),feature('parking',square(-160,70,90,100),'parking')];
  data.landscapeContexts=[{...feature('industrial-context',square(-240,-240,480,120)),kind:'industrial',tags:{landuse:'industrial'}}];
  const plan=planLandscape(data),commons=plan.sites.filter(s=>s.template==='pocket-common');
  assert(commons.length>0&&commons.length<=plan.profile.maxCommons);
  assert(commons.every(s=>s.radius>=20&&s.radius<=65&&s.area>1600&&s.openEdgeMargin>=3));
  const forbidden=[...data.landscapes,...data.landscapeContexts].map(geometry);
  for(const surface of plan.surfaces.filter(s=>s.source==='inferred-landscape'))assert(totalArea(clipping.intersection(geometry(surface),clipping.union(...forbidden)))<.001);
  for(const site of commons){
    const surfaces=plan.surfaces.filter(s=>s.id===site.key),paved=surfaces.filter(s=>s.kind==='paving').reduce((sum,s)=>sum+s.area,0);
    assert(paved/site.area>.2,'a common retains generous hardscape');
    assert(surfaces.some(s=>s.outer.length>4),'a common must not render a sampling-grid square');
  }
  const delta=[12000,9500],move=p=>p.map((v,i)=>v+delta[i]);
  const shifted={...data,bounds:data.bounds.map((n,i)=>n+delta[i%2]),buildings:data.buildings.map(b=>({...b,outer:b.outer.map(move)})),landscapes:data.landscapes.map(s=>({...s,outer:s.outer.map(move)})),landscapeContexts:data.landscapeContexts.map(s=>({...s,outer:s.outer.map(move)}))};
  const moved=planLandscape(shifted);
  assert.equal(moved.stats.templates['pocket-common'],plan.stats.templates['pocket-common']);
  assert(Math.abs(moved.stats.inferredArea-plan.stats.inferredArea)<.2,'distance-field completion works equally at another map origin');
});

test('real CBD plan has bounded geometry, four templates and balanced detail budgets', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/data/beijing-cbd.json', import.meta.url)));
  const merged = new Map(raw.elements.map(e => [`${e.type}:${e.id}`, e]));
  for (const filename of ['street-details.json', 'landscape-details.json']) for (const e of JSON.parse(readFileSync(new URL(`../public/data/${filename}`, import.meta.url))).elements) merged.set(`${e.type}:${e.id}`, e);
  raw.elements = [...merged.values()];
  const data = parseOSM(raw), roadPlan = planRoadSurface(data), plan = planLandscape(data, { roadPlan });
  assert(plan.stats.inferredSites > 100 && plan.stats.inferredSites <= plan.profile.maxSites);
  assert(plan.stats.templates.forecourt > 0 && plan.stats.templates['garden-court'] > 0 && plan.stats.templates.verge > 0);
  assert(plan.stats.templates['pocket-common']>0);
  assert(plan.stats.layouts.paired>0&&plan.stats.layouts.single>0&&plan.stats.layouts.offset>0,'courts should not all use the same paired lawn composition');
  assert(plan.stats.treesByTemplate['pocket-common']>=100&&plan.stats.treesByTemplate.verge>=100,'large buildings cannot consume all tree detail');
  assert(plan.trees.length <= plan.profile.maxTrees);
  assert(plan.stats.surfaces <= plan.profile.maxSurfaces);
  assert.equal(plan.stats.rejectedGeometry, 0, 'the committed CBD extract must not rely on malformed-geometry recovery');
  assert(plan.stats.inferredFraction > .05 && plan.stats.inferredFraction < .4);
  for (const surface of plan.surfaces) for (const ring of geometry(surface)) for (const p of ring) assert(p.every(Number.isFinite));
  for (const tree of plan.trees) assert(plan.surfaces.some(s => s.source === 'inferred-landscape' && /^(lawn|garden|shrub)$/.test(s.kind) && at(tree.point, s)), 'every inferred tree has a planted support');
});
