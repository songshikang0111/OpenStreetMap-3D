import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOSM, inside } from '../src/osm.js';
import { buildRoadSurface, planRoadSurface, subtractConvex, clipPaintSegment } from '../src/road-surface.js';

const road = (id, points, width = 10, extra = {}) => ({ id, width, type: 'primary', bridge: false, layer: 0, tags: {}, segments: points.slice(1).map((p, i) => [points[i], p]), ...extra });
const data = roads => ({ roads, bounds: [-160, -160, 160, 160], streetNodes: [] });
const square = (x, z, w) => [[x, z], [x + w, z], [x + w, z + w], [x, z + w]];
const area = p => Math.abs(p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
// Independent Sutherland-Hodgman reference: verification does not reuse the
// production difference routine it is intended to check.
const intersectionArea = (subject, clip) => {
  let points = subject;
  for (let i = 0; i < clip.length && points.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], next = [];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < points.length; j++) {
      const p = points[j], q = points[(j + 1) % points.length], u = side(p), v = side(q);
      if (u >= 0) next.push(p);
      if ((u < 0) !== (v < 0)) { const t = u / (u - v); next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    points = next;
  }
  return points.length < 3 ? 0 : area(points);
};
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// A spatially indexed exhaustive check; catches actual polygon intersections,
// including parallel strips and the joins between separate OSM ways.
function assertDisjoint(surfaces, tolerance = 1e-5) {
  const cells = new Map(); let comparisons = 0;
  for (const s of surfaces) {
    const b = s.bounds, keys = [], candidates = new Set();
    for (let x = Math.floor(b[0] / 20); x <= Math.floor(b[2] / 20); x++) for (let z = Math.floor(b[1] / 20); z <= Math.floor(b[3] / 20); z++) {
      const key = `${s.level}:${x}:${z}`; keys.push(key);
      for (const other of cells.get(key) || []) candidates.add(other);
    }
    for (const other of candidates) {
      const c = other.bounds;
      if (c[2] <= b[0] || b[2] <= c[0] || c[3] <= b[1] || b[3] <= c[1]) continue;
      comparisons++;
      const overlap = intersectionArea(s.polygon, other.polygon);
      assert(overlap < tolerance, `surface overlap ${overlap} m²: ${s.kind}/${other.kind}, roads ${s.roadId}/${other.roadId}`);
    }
    for (const key of keys) { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(s); }
  }
  return comparisons;
}

test('convex subtraction conserves area, handles containment, identical and touching edges', () => {
  const cases = [
    [square(0, 0, 10), square(5, 0, 10), 50],
    [square(0, 0, 10), square(2, 2, 6), 64],
    [square(0, 0, 10), square(0, 0, 10), 0],
    [square(0, 0, 10), square(10, 0, 10), 100],
    [square(0, 0, 10), square(-1, -1, 12), 0],
  ];
  for (const [subject, clip, expected] of cases) {
    const parts = subtractConvex(subject, clip);
    assert(Math.abs(parts.reduce((s, p) => s + area(p), 0) - expected) < 1e-8);
    for (const part of parts) assert(intersectionArea(part, clip) < 1e-7);
  }
});

test('connected strips replace disc endpoints, stay gap-free and retain continuous dash phase', () => {
  const plan = planRoadSurface(data([road(1, [[-100, 0], [-97, 0], [-91, 0], [-50, 0], [0, 0], [0, 100]])]));
  assert.equal(plan.stats.miterJoins, 1);
  assert.equal(plan.stats.junctions, 0, 'ordinary bend must not erase markings');
  const drive = plan.surfaces.filter(p => p.kind === 'drive');
  assert(drive.some(p => inside([3, -3], p.polygon)), 'outer corner must be filled');
  for (const s of drive) for (const p of s.polygon) { assert(p[0] >= -100 - 1e-7, 'no protruding circular cap'); assert(p[1] <= 100 + 1e-7); }
  assertDisjoint(plan.surfaces);
  assert(plan.markings.some(m => m.kind === 'dash' && Math.abs(m.a[0] + 96) < 1e-6), 'global 4 m phase survives first 3 m segment');
  assert(plan.markings.some(m => m.kind === 'dash' && Math.abs(m.b[0] + 92) < 1e-6));
});

test('sharp bends use bounded bevels; duplicate reversed ways do not duplicate surfaces or paint', () => {
  const input = data([road(1, [[-100, 0], [0, 0], [-98, 5]])]);
  const a = planRoadSurface(input);
  assert.equal(a.stats.bevelJoins, 1);
  assert(Math.max(...a.surfaces.flatMap(s => s.polygon.map(p => p[0]))) < 10, 'no long acute miter spike');
  const single = planRoadSurface(data([road(10, [[-100, 0], [100, 0]])]));
  const duplicate = planRoadSurface(data([road(10, [[-100, 0], [100, 0]]), road(20, [[100, 0], [-100, 0]])]));
  assert.equal(duplicate.stats.duplicateSegments, 1);
  assert.equal(duplicate.stats.roadArea, single.stats.roadArea);
  assert.equal(duplicate.stats.dashes, single.stats.dashes);
});

test('T/X junctions remove internal overlap, clip footways and suppress paint through crossings', () => {
  const input = data([road(1, [[-100, 0], [0, 0], [100, 0]], 12), road(2, [[0, -100], [0, 0]], 8), road(3, [[-100, -25], [100, -25]], 3, { type: 'footway' })]);
  const plan = planRoadSurface(input);
  assert.equal(plan.stats.junctions, 1);
  assert.equal(plan.junctions[0].branches.length, 3);
  assertDisjoint(plan.surfaces);
  for (const paint of plan.markings) for (const zone of plan.exclusionZones) assert(intersectionArea(paint.polygon, zone.polygon) < 1e-6);
  assert(!plan.markings.some(m => inside([0, 0], m.polygon)));
  const x = planRoadSurface(data([road(1, [[-100, 0], [100, 0]]), road(2, [[0, -100], [0, 100]])]));
  assert.equal(x.junctions[0].branches.length, 4);
  assert(Math.abs(x.stats.roadArea - 3900) < 1e-7, 'two 200 × 10 strips minus a 10 × 10 shared square');
});

test('grade-separated roads never form junctions or erase pavement at the other elevation', () => {
  const plan = planRoadSurface(data([road(1, [[-100, 0], [100, 0]]), road(2, [[0, -100], [0, 100]], 10, { bridge: true, layer: 1 })]));
  assert.equal(plan.stats.junctions, 0);
  assert(Math.abs(plan.stats.roadArea - 4000) < 1e-7);
  assert(plan.surfaces.some(p => p.kind === 'drive' && p.y === 7));
  assertDisjoint(plan.surfaces);
});

test('sidewalks rise above asphalt, crossings stay flat, and inferred margins respect road access and buildings', () => {
  const input=data([
    road(1,[[-100,0],[100,0]],10),
    road(2,[[-100,20],[100,20]],2,{type:'footway',tags:{footway:'sidewalk'}}),
    road(3,[[20,-20],[20,20]],2,{type:'footway',tags:{footway:'crossing'}}),
    road(4,[[-100,50],[100,50]],12,{type:'trunk',tags:{foot:'no'}}),
    road(5,[[-100,80],[100,80]],8,{bridge:true,layer:1}),
  ]);
  input.buildings=[{outer:[[25,5],[45,5],[45,20],[25,20]],holes:[],minHeight:0}];
  const plan=planRoadSurface(input);
  assert(plan.surfaces.filter(s=>s.roadId===2).every(s=>Math.abs(s.y-.47)<1e-8));
  assert(plan.surfaces.filter(s=>s.roadId===3).every(s=>s.y===.32));
  assert(!plan.surfaces.some(s=>s.kind==='paving'&&(s.roadId===4||s.roadId===5)));
  for(const p of plan.surfaces.filter(s=>s.kind==='paving'))assert(intersectionArea(p.polygon,input.buildings[0].outer)<1e-8);
  assert.equal(plan.stats.observedSidewalkWays,1);assert.equal(plan.stats.observedCrossingWays,1);
  assertDisjoint(plan.surfaces);
});

test('observed zebra exclusions and inferred controlled stop lines keep a geometric buffer', () => {
  const input = data([road(1, [[-100, 0], [100, 0]], 12), road(2, [[0, -100], [0, 100]], 10)]);
  input.streetNodes = [{ id: 90, point: [16, 0], kind: 'crossing', tags: { crossing: 'traffic_signals' } }];
  const plan = planRoadSurface(input), stops = plan.markings.filter(m => m.kind === 'stop');
  assert.equal(plan.stats.crossingExclusions, 1);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].osmId, 90);
  assert.equal(stops[0].source, 'inferred-from-osm-controlled-crossing');
  for (const paint of plan.markings) for (const zone of [...plan.exclusionZones, ...(paint.kind === 'dash' ? plan.stopZones : [])]) assert(intersectionArea(paint.polygon, zone.polygon) < 1e-6);
  const fragments = clipPaintSegment([-20, 0], [20, 0], [square(-5, -5, 10)]);
  assert.deepEqual(fragments, [[[-20, 0], [-5, 0]], [[5, 0], [20, 0]]]);
});

test('invalid/zero segments are ignored, clipping respects extraction bounds, output is deterministic', () => {
  const input = data([road(1, [[-200, 0], [200, 0]]), road(2, [[0, 0], [0, 0]]), road(3, [[NaN, 0], [2, 3]])]);
  const a = planRoadSurface(input), b = planRoadSurface(input);
  assert.deepEqual(a, b);
  assert.equal(a.stats.segments, 1);
  for (const s of [...a.surfaces, ...a.markings]) for (const [x, z] of s.polygon) assert(x >= -160 - 1e-7 && x <= 160 + 1e-7 && z >= -160 - 1e-7 && z <= 160 + 1e-7);
});

test('actual Guomao extract: every surface is disjoint, paint avoids all same-level clear zones, mesh winding is up', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/data/beijing-cbd.json', import.meta.url)));
  raw.elements.push(...JSON.parse(readFileSync(new URL('../public/data/street-details.json', import.meta.url))).elements);
  const input = parseOSM(raw), sourceSnapshot = JSON.stringify(input.roads), start = performance.now();
  const built = buildRoadSurface(input), { plan } = built;
  assert.equal(JSON.stringify(input.roads), sourceSnapshot, 'OSM-derived inputs are never mutated');
  assert.equal(plan.stats.sourceRoads, 785);
  assert(plan.stats.segments > 2500 && plan.stats.miterJoins > 1000 && plan.stats.junctions > 100);
  assert.equal(plan.stats.crossingExclusions, 85);
  assert(plan.stats.stopLines > 0 && plan.stats.surfaceTriangles < 100000);
  const comparisons = assertDisjoint(plan.surfaces, .0001);
  let paintedArea = 0;
  for (const m of plan.markings) {
    paintedArea += area(m.polygon);
    for (const z of [...plan.exclusionZones, ...(m.kind === 'dash' ? plan.stopZones : [])]) {
      if (m.level !== z.level) continue;
      const b = z.bounds;
      if (m.polygon.every(p => p[0] < b[0]) || m.polygon.every(p => p[0] > b[2]) || m.polygon.every(p => p[1] < b[1]) || m.polygon.every(p => p[1] > b[3])) continue;
      assert(intersectionArea(m.polygon, z.polygon) < .00001, `paint overlaps ${z.kind}`);
    }
  }
  assert(paintedArea > 500);
  built.group.traverse(mesh => {
    if (!mesh.isMesh||!mesh.userData.roadSurface) return;
    assert.equal(mesh.userData.inkClass, mesh.name.includes('lane paint')?3.5:mesh.name.includes('carriageways')?3:3.2);
    assert.equal(mesh.castShadow, false);
    const p = mesh.geometry.attributes.position;
    assert([...p.array].every(Number.isFinite));
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i + 1) - p.getX(i), az = p.getZ(i + 1) - p.getZ(i), bx = p.getX(i + 2) - p.getX(i), bz = p.getZ(i + 2) - p.getZ(i);
      assert(az * bx - ax * bz >= -.0001, 'triangle must face up, allowing float32 microfragment collapse');
    }
  });
  console.log('R10 Guomao:', { ...plan.stats, testedPolygonPairs: comparisons, paintedArea: Math.round(paintedArea), totalValidationMs: Math.round(performance.now() - start) });
  built.dispose();
});
