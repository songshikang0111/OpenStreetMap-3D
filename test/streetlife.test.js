import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOSM, inside } from '../src/osm.js';
import { planStreetLife, buildStreetLife, segmentDistance } from '../src/streetlife.js';

const square = (x, z, w) => [[x, z], [x + w, z], [x + w, z + w], [x, z + w]];
const road = (id, points, width = 10, type = 'primary') => ({ id, type, width, layer: 0, bridge: false, segments: points.slice(1).map((p, i) => [points[i], p]) });
const fixture = () => ({ bounds: [-160, -160, 160, 160], buildings: [{ id: 'b', outer: square(10, 30, 32), holes: [] }], roads: [road(1, [[-140, 0], [0, 0], [140, 0]]), road(2, [[0, -140], [0, 0], [0, 140]])], trees: [], greens: [{ id: 'g', outer: square(15, 15, 120), holes: [square(90, 90, 22)], tags: { leisure: 'park' } }] });

test('generated planting is deterministic, avoids buildings, carriageways and green holes', () => {
  const data = fixture(), a = planStreetLife(data), b = planStreetLife(data);
  assert.deepEqual(a, b);
  assert(a.stats.streetTrees > 0 && a.stats.greenTrees > 0);
  for (const t of a.trees) {
    const point = [t.x, t.z];
    assert(!inside(point, data.buildings[0].outer));
    for (const r of data.roads) for (const [p, q] of r.segments) assert(segmentDistance(point, p, q) >= r.width / 2 + .64);
    if (t.source === 'inferred-green') assert(!inside(point, data.greens[0].holes[0]));
  }
  for (let i = 0; i < a.trees.length; i++) for (let j = i + 1; j < a.trees.length; j++) assert(Math.hypot(a.trees[i].x - a.trees[j].x, a.trees[i].z - a.trees[j].z) >= 5.999);
});

test('parallel duplicate ways do not double tree rows; bridges and narrow paths do not seed street trees', () => {
  const one = fixture(); one.greens = []; one.roads = [one.roads[0]];
  const a = planStreetLife(one);
  one.roads.push({ ...one.roads[0], id: 3 });
  const b = planStreetLife(one);
  assert(b.trees.length <= a.trees.length + 4);
  one.roads = [{ ...one.roads[0], bridge: true }, road(4, [[-100, 50], [100, 50]], 2, 'footway')];
  assert.equal(planStreetLife(one).stats.streetTrees, 0);
});

test('junction-based crossings stay on connected approaches and remain stable', () => {
  const data = fixture(), plan = planStreetLife(data);
  assert(plan.crosswalks.length >= 2);
  assert.equal(plan.stats.junctions, 1);
  for (const c of plan.crosswalks) assert(data.roads.some(r => r.segments.some(([a, b]) => segmentDistance(c.point, a, b) < .8)));
});

test('kerb segments leave shallow-angle and wide connecting carriageways clear',()=>{
  const data=fixture();data.buildings=[];data.greens=[];
  data.roads.push(road(3,[[-100,-20],[110,35]],18));
  const plan=planStreetLife(data);assert(plan.curbs.length>0);
  for(const curb of plan.curbs)for(const t of [-.5,-.25,0,.25,.5]){
    const q=[curb.point[0]+Math.sin(curb.angle)*curb.length*t,curb.point[1]+Math.cos(curb.angle)*curb.length*t];
    for(const r of data.roads)for(const[a,b]of r.segments)assert(segmentDistance(q,a,b)>=r.width/2+.019);
  }
});

test('OSM crossing observations suppress speculative junction crossings and tree rows remain attributed', () => {
  const data = fixture();
  data.streetNodes = [{ id: 91, point: [35, 0], kind: 'crossing', tags: {} }, { id: 92, point: [-100, -100], kind: 'crossing', tags: {} }];
  data.treeRows = [{ id: 70, points: [[-120, -50], [-30, -50]], tags: {} }];
  const plan = planStreetLife(data);
  assert.equal(plan.crosswalks.length, 1);
  assert.equal(plan.crosswalks[0].osmId, 91);
  assert.equal(plan.crosswalks[0].source, 'osm-crossing-node');
  assert(plan.stats.rowTrees > 0);
  assert(plan.trees.some(t => t.source === 'inferred-osm-row'));
});

test('Beijing furniture has finite instance transforms and foliage-only ink classification', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/data/beijing-cbd.json', import.meta.url)));
  const details = JSON.parse(readFileSync(new URL('../public/data/street-details.json', import.meta.url)));
  raw.elements.push(...details.elements);
  const data = parseOSM(raw), life = buildStreetLife(data);
  assert(life.treeCount > data.trees.length);
  assert(life.stats.observedCrossings > 0 && life.stats.observedSignals > 0);
  life.updateLOD({ position: { x: 0, y: 3, z: 0 } });
  assert(life.stats.nearTrees > 0);
  for (const group of [life.treeGroup, life.streetGroup]) group.traverse(mesh => {
    if (!mesh.isInstancedMesh) return;
    assert([...mesh.instanceMatrix.array].every(Number.isFinite));
    if (/crowns|clusters/.test(mesh.name)) assert.equal(mesh.userData.inkClass, 2);
    if (/Trunks|branching/.test(mesh.name)) assert.equal(mesh.userData.inkClass, 4);
  });
  const roads = data.roads.filter(r => !r.bridge && !/footway|path|steps|pedestrian|cycleway/.test(r.type));
  for (const t of life.plan.trees) for (const r of roads) for (const [a, b] of r.segments) assert(segmentDistance([t.x, t.z], a, b) >= r.width / 2 + .64);
  console.log('Street life:', life.stats);
  life.dispose();
});
