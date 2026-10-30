import * as THREE from 'three';
import { inside, stableRandom } from './osm.js';
import { clipPaintSegment } from './road-surface.js';
import { roadHeightAt } from './road-grade.js';
import { treeStructureClearance } from './tree-clearance.js';
import { crownGeometry, foliageMaterial, crownBase, crownEnvelope, crownProfile, crownMorphWeight, treeLODWeights, TREE_LOD } from './foliage.js';
export { TREE_LOD } from './foliage.js';

// These additions are spatially constrained illustrations, not surveyed street assets.
// Metres, counts and contextual planting rules; no city-specific coordinates.
export const TREE_PLANTING_PROFILE = Object.freeze({
  maxTrees: 6000, streetSpacingMin: 8.8, streetSpacingMax: 10.4,
  streetHeightMin: 9.7, streetHeightMax: 11.7, rowSpacing: 8.2,
  woodlandSpacing: 7.4, parkSpacing: 8.2, lawnEdgeDepth: 6.5,
  parkEdgeDepth: 19, minimumSpacing: 6,
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const inPoly = (p, poly) => inside(p, poly.outer) && !(poly.holes || []).some(h => inside(p, h));
const boundsOf = ring => ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);

export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

// Crosswalk centres are retained; the 4.8m access width is an illustrative rule.
export function clipKerbsAtCrossings(curbs, crossings) {
  const zones=crossings.map(c=>{
    const d=[Math.sin(c.angle),Math.cos(c.angle)],side=[-d[1],d[0]],half=c.width/2+2;
    return {center:c.point,radius:Math.hypot(half,2.4),polygon:[[-2.4,-half],[2.4,-half],[2.4,half],[-2.4,half]].map(([a,b])=>[c.point[0]+d[0]*a+side[0]*b,c.point[1]+d[1]*a+side[1]*b])};
  });
  const result=[];let cutSegments=0,droppedLength=0;
  for(const curb of curbs){
    const direction=[Math.sin(curb.angle),Math.cos(curb.angle)];
    const end=t=>[curb.point[0]+direction[0]*t,curb.point[1]+direction[1]*t];
    const nearby=zones.filter(z=>Math.hypot(z.center[0]-curb.point[0],z.center[1]-curb.point[1])<=z.radius+curb.length/2+.2);
    if(!nearby.length){result.push(curb);continue;}
    const pieces=clipPaintSegment(end(-curb.length/2),end(curb.length/2),nearby,.5);
    let kept=0;
    for(const [a,b]of pieces){const length=Math.hypot(b[0]-a[0],b[1]-a[1]);kept+=length;result.push({...curb,point:[(a[0]+b[0])/2,(a[1]+b[1])/2],length});}
    if(curb.length-kept>1e-5){cutSegments++;droppedLength+=curb.length-kept;}
  }
  return {curbs:result,cutSegments,droppedLength};
}

class Grid {
  constructor(size = 32) { this.size = size; this.cells = new Map(); }
  add(item, bounds) {
    const s = this.size;
    for (let x = Math.floor(bounds[0] / s); x <= Math.floor(bounds[2] / s); x++)
      for (let z = Math.floor(bounds[1] / s); z <= Math.floor(bounds[3] / s); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
  }
  near(p, radius = 0) {
    const s = this.size, result = new Set();
    for (let x = Math.floor((p[0] - radius) / s); x <= Math.floor((p[0] + radius) / s); x++)
      for (let z = Math.floor((p[1] - radius) / s); z <= Math.floor((p[1] + radius) / s); z++)
        for (const item of this.cells.get(`${x},${z}`) || []) result.add(item);
    return result;
  }
}

/** Attach furnishings to the same source carriageway profile as their road. */
export function gradeStreetLife(plan, roadPlan) {
  if (!roadPlan?.segments?.length) return plan;
  const index=new Grid();
  for(const segment of roadPlan.segments){
    if(segment.walk || segment.road.bridge)continue;
    const box=boundsOf([segment.a,segment.b]),pad=segment.width/2+4;
    index.add(segment,[box[0]-pad,box[1]-pad,box[2]+pad,box[3]+pad]);
  }
  const sample=(point,roadId)=>{
    let candidates=[...index.near(point)].map(s=>({s,d:segmentDistance(point,s.a,s.b)})).filter(({s,d})=>d<=s.width/2+4);
    const own=candidates.filter(({s})=>s.road.id===roadId);if(own.length)candidates=own;
    candidates.sort((a,b)=>a.d-b.d||String(a.s.road.id).localeCompare(String(b.s.road.id))||a.s.a[0]-b.s.a[0]||a.s.a[1]-b.s.a[1]);
    if(!candidates.length)return null;
    const {s,d}=candidates[0],length=Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1]);
    const rise=Number.isFinite(s.yA+s.yB)?s.yB-s.yA:0;
    return {baseY:roadHeightAt(s,point),grade:[(s.b[0]-s.a[0])*rise/(length*length),(s.b[1]-s.a[1])*rise/(length*length)],roadId:s.road.id,distance:d,width:s.width};
  };
  let elevated=0;
  const attach=(items,sidewalk=false)=>items.map(item=>{
    const support=sample(item.point,item.roadId);if(!support)return item;
    if(support.baseY>.37)elevated++;
    return {...item,baseY:support.baseY+(sidewalk?.15:0),grade:support.grade,roadId:support.roadId};
  });
  // Trees inferred on a raised approach cannot be rooted in its thin side
  // paving. Remove only that speculative planting; actual OSM trees stay put.
  const removed=[],structureRemoved=[],structureTypes={vehicle:0,pedestrian:0};
  const structuralConflict=treeStructureClearance(roadPlan);
  const trees=plan.trees.filter(tree=>{
    // Vehicle viaducts need the same clearance as footbridges and stairs.
    // Use actual joined deck footprints and vertical slab/rail intervals;
    // observed OSM trees stay unchanged and require source review if in conflict.
    const conflict=tree.source!=='osm'&&structuralConflict(tree);
    if(conflict){structureTypes[conflict.kind]++;structureRemoved.push(tree);return false;}
    if(tree.source!=='inferred-street')return true;
    const support=sample([tree.x,tree.z]);
    const suppress=support&&support.baseY>.62&&support.distance<=support.width/2+2;
    if(suppress)removed.push(tree);return !suppress;
  });
  const result={...plan,trees,curbs:attach(plan.curbs),crosswalks:attach(plan.crosswalks),cars:attach(plan.cars),people:attach(plan.people,true),lamps:attach(plan.lamps,true),signals:attach(plan.signals,true)};
  result.stats={...plan.stats,trees:trees.length,streetTrees:plan.stats.streetTrees-removed.length-structureRemoved.filter(t=>t.source==='inferred-street').length,generatedTrees:plan.stats.generatedTrees-removed.length-structureRemoved.length,gradeAdjustedFurnishings:elevated,gradeSuppressedTrees:removed.length,structureSuppressedTrees:structureRemoved.length,vehicleStructureSuppressedTrees:structureTypes.vehicle,pedestrianStructureSuppressedTrees:structureTypes.pedestrian};
  for(const [counter,source]of [['landscapeTrees','inferred-landscape'],['greenTrees','inferred-green'],['rowTrees','inferred-osm-row']]) result.stats[counter]=(plan.stats[counter]||0)-structureRemoved.filter(t=>t.source===source).length;
  return result;
}

function sampleRoad(road, step, phase, callback) {
  let distance = phase, serial = 0;
  for (const [a, b] of road.segments) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .01) continue;
    const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    for (; distance < length; distance += step) callback([a[0] + dx * distance, a[1] + dz * distance], dx, dz, serial++);
    distance -= length;
  }
}

function crossing(a, b, c, d) {
  const x = b[0] - a[0], z = b[1] - a[1], u = d[0] - c[0], v = d[1] - c[1];
  const determinant = x * v - z * u;
  if (Math.abs(determinant) < .001 || Math.abs(determinant) / (Math.hypot(x, z) * Math.hypot(u, v)) < .4) return null;
  const q = c[0] - a[0], r = c[1] - a[1];
  const t = (q * v - r * u) / determinant, s = (q * z - r * x) / determinant;
  if (t < -.001 || t > 1.001 || s < -.001 || s > 1.001) return null;
  return [a[0] + t * x, a[1] + t * z];
}

/** Pure deterministic placement. Kept independent of Three.js rendering for clearance tests. */
export function planStreetLife(data, { seed = 1, maxTrees = null, plantingProfile = {}, maxCars = 110, maxPeople = 170, roadPlan = null, landscapeTrees = [] } = {}) {
  const planting = { ...TREE_PLANTING_PROFILE };
  for (const key of Object.keys(planting)) if (Number.isFinite(plantingProfile[key])) planting[key] = Math.max(.5, plantingProfile[key]);
  planting.streetSpacingMin = Math.max(6, planting.streetSpacingMin);
  planting.streetSpacingMax = Math.max(planting.streetSpacingMin, planting.streetSpacingMax);
  planting.minimumSpacing = Math.max(4, planting.minimumSpacing);
  maxTrees = Math.max(0, Math.floor(Number.isFinite(maxTrees) ? maxTrees : planting.maxTrees));
  const bounds = data.bounds, buildings = new Grid(), roads = new Grid(), occupiedTrees = new Grid(12);
  const validBounds = (p, margin = 1) => p[0] > bounds[0] + margin && p[0] < bounds[2] - margin && p[1] > bounds[1] + margin && p[1] < bounds[3] - margin;
  for (const building of data.buildings) buildings.add(building, boundsOf(building.outer));
  const atBuilding = (p, margin = 0) => {
    for (const building of buildings.near(p, margin)) {
      if (inPoly(p, building)) return true;
      if (margin > 0) for (const ring of [building.outer, ...(building.holes || [])])
        for (let i = 0; i < ring.length; i++) if (segmentDistance(p, ring[i], ring[(i + 1) % ring.length]) < margin) return true;
    }
    return false;
  };
  const driveRoads = data.roads.filter(r => !r.bridge && !r.tunnel && r.layer >= 0 && !/footway|path|steps|pedestrian|cycleway|corridor/.test(r.type));
  const segments = [];
  for (const road of driveRoads) for (const [a, b] of road.segments) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < .1) continue;
    const entry = { a, b, road, index: segments.length };
    const box = boundsOf([a, b]), pad = road.width / 2 + 4;
    roads.add(entry, [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]);
    segments.push(entry);
  }
  const roadClear = (p, margin = .65) => {
    for (const s of roads.near(p, margin)) if (segmentDistance(p, s.a, s.b) < s.road.width / 2 + margin) return false;
    return true;
  };
  const isClear = (p, margin = 1.8) => validBounds(p, 3) && !atBuilding(p, margin) && roadClear(p);
  const junctionGrid = new Grid(24), junctions = [];
  for (const s of segments) {
    if (s.road.width < 6 || /motorway|trunk.*link/.test(s.road.type)) continue;
    const center = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    const radius = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2;
    for (const t of roads.near(center, radius)) {
      if (t.index <= s.index || s.road.id === t.road.id || t.road.width < 6 || /motorway|trunk.*link/.test(t.road.type)) continue;
      const point = crossing(s.a, s.b, t.a, t.b);
      if (!point || !validBounds(point, 30) || atBuilding(point)) continue;
      const existing = [...junctionGrid.near(point, 14)].find(j => Math.hypot(j.point[0] - point[0], j.point[1] - point[1]) < 14);
      if (existing) { if (!existing.roads.some(r => r.id === t.road.id)) existing.roads.push(t.road); continue; }
      const entry = { point, roads: [s.road, t.road], directions: [s, t] };
      junctions.push(entry); junctionGrid.add(entry, [point[0], point[1], point[0], point[1]]);
    }
  }
  const nearJunction = (p, distance = 14) => [...junctionGrid.near(p, distance)].some(j => Math.hypot(j.point[0] - p[0], j.point[1] - p[1]) < distance);
  const trees = [], lamps = [], cars = [], people = [], curbs = [], crosswalks = [], signals = [];
  const stats = { observedTrees: 0, rejectedObservedTrees: 0, rowTrees: 0, streetTrees: 0, greenTrees: 0, landscapeTrees: 0, junctions: junctions.length, placementSource: 'OSM observations + constrained inferred furnishings and landscape templates; no image-derived geometry' };
  const forbiddenTrees = new Grid();
  for (const p of [...(data.water || []), ...(data.landscapes || []).filter(p=>['parking','sport','construction','plaza','soil'].includes(p.kind))]) forbiddenTrees.add(p,boundsOf(p.outer));
  const paths = new Grid();
  for (const road of data.roads.filter(r=>!r.bridge && /footway|path|steps|pedestrian|cycleway/.test(r.type))) for (const [a,b] of road.segments) {
    const box=boundsOf([a,b]),pad=road.width/2+1;
    paths.add({a,b,width:road.width},[box[0]-pad,box[1]-pad,box[2]+pad,box[3]+pad]);
  }
  const treeSiteClear = p => ![...forbiddenTrees.near(p)].some(poly=>inPoly(p,poly)) && ![...paths.near(p)].some(s=>segmentDistance(p,s.a,s.b)<s.width/2+1);
  const treeNear = (p, distance) => [...occupiedTrees.near(p, distance)].some(t => Math.hypot(t.x - p[0], t.z - p[1]) < distance);
  function addTree(point, key, height, source, shape, extra = {}) {
    if (source !== 'osm' && !treeSiteClear(point)) return false;
    if (trees.length >= maxTrees || !isClear(point, source === 'osm' ? .5 : 2.1) || treeNear(point, source === 'osm' ? 2.6 : planting.minimumSpacing)) return false;
    const rng = stableRandom(`crown:${key}:${seed}`), h = clamp(height || 8.2 + rng() * 3, 3.8, 19);
    const choice = rng(), family = shape || (choice < .12 ? 'columnar' : choice < .37 ? 'round' : choice < .67 ? 'vase' : 'spreading');
    const tree = { x: point[0], z: point[1], h, radius: 0, shape: family, key, source, seed, rotation: rng() * Math.PI * 2, variation: rng(), ...extra };
    const envelope = crownEnvelope(tree); tree.radius = envelope.radius; tree.crownBottom = envelope.bottom; tree.crownTop = envelope.top;
    // Broad mature crowns may overhang a road above their clear stems. They
    // must not pass through buildings. A confined frontage gets a narrow tree.
    if (source !== 'osm' && atBuilding(point, tree.radius)) {
      tree.shape = 'columnar'; const narrow = crownEnvelope(tree); tree.radius = narrow.radius; tree.crownBottom = narrow.bottom; tree.crownTop = narrow.top;
      if (atBuilding(point, tree.radius)) return false;
    }
    trees.push(tree); occupiedTrees.add(tree, [tree.x, tree.z, tree.x, tree.z]); return true;
  }
  for (const tree of data.trees || []) {
    if (addTree(tree.point, `osm:${tree.id}`, tree.height, 'osm')) stats.observedTrees++;
    else stats.rejectedObservedTrees++;
  }
  // Queue inferred planting by source AND site. A long first road must not
  // spend the whole budget before parks and courtyards receive any trees.
  const candidates = new Map();
  const offer = (source, group, tree) => {
    if (!candidates.has(source)) candidates.set(source, new Map());
    const groups = candidates.get(source);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ ...tree, source, group });
  };
  for (const row of data.treeRows || []) {
    const rng = stableRandom(`tree-row:${row.id}:${seed}`), points = row.points || [];
    const line = { segments: points.slice(1).map((p, i) => [points[i], p]) };
    sampleRoad(line, planting.rowSpacing, 2, (point, dx, dz, i) => {
      offer('inferred-osm-row', String(row.id), { point, key: `row:${row.id}:${i}`, height: parseFloat(row.tags?.height) || 8.5 + rng() * 2.5 });
    });
  }
  const plantedRoads = driveRoads.filter(r => r.width >= 7 && /^(primary|secondary|tertiary|residential|unclassified)$/.test(r.type)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const road of plantedRoads) {
    const rng = stableRandom(`avenue:${road.name || road.id}:${seed}`), step = planting.streetSpacingMin + rng() * (planting.streetSpacingMax - planting.streetSpacingMin);
    const family = rng(), shape = family < .07 ? 'columnar' : family < .29 ? 'round' : family < .62 ? 'vase' : 'spreading';
    const roadHeight = planting.streetHeightMin + rng() * (planting.streetHeightMax - planting.streetHeightMin);
    sampleRoad(road, step, 3 + rng() * 5, (p, dx, dz, index) => {
      for (const side of [-1, 1]) {
        const offset = road.width / 2 + 1.25;
        // A little longitudinal drift preserves a planted avenue's rhythm;
        // arbitrary sideways jitter would push roots into its carriageway.
        const drift = (rng() - .5) * .75;
        const q = [p[0] - dz * side * offset + dx * drift, p[1] + dx * side * offset + dz * drift];
        if (!nearJunction(q, Math.max(14, road.width))) offer('inferred-street', `${road.id}:${side}`, { point: q, key: `street:${road.id}:${index}:${side}`, height: roadHeight * (.93 + rng() * .14), shape, roadId: road.id });
      }
    });
  }
  for (const green of [...(data.greens || [])].sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
    const rng = stableRandom(`green:${green.id}:${seed}`), box = boundsOf(green.outer);
    const dense = /forest|wood|trees/.test([green.tags?.landuse, green.tags?.natural, green.tags?.landcover].join(' '));
    const lawn = /^(grass|meadow)$/.test(green.tags?.landuse || green.tags?.landcover || green.tags?.natural || '');
    const suitable = p => inPoly(p, green) && [green.outer, ...(green.holes || [])].every(ring => ring.every((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length]) >= 1.8));
    if (dense) {
      const step = Math.max(6, planting.woodlandSpacing);
      let row = 0;
      for (let z = Math.max(bounds[1] + 3, box[1]) + step / 2; z < Math.min(bounds[3] - 3, box[3]); z += step, row++)
        for (let x = Math.max(bounds[0] + 3, box[0]) + step / 2 + (row % 2) * step / 2; x < Math.min(bounds[2] - 3, box[2]); x += step) {
          const p = [x + (rng() - .5) * 1.6, z + (rng() - .5) * 1.6];
          if (suitable(p)) offer('inferred-green', String(green.id), { point: p, key: `green:${green.id}:${row}:${x}`, height: 9 + rng() * 4, shape: rng()<.25?'round':'spreading', plantingContext: 'woodland' });
        }
    } else {
      // Follow actual polygon edges in staggered, locally continuous belts.
      // Grass keeps a single edge row; parks get two staggered rows and an open centre.
      const line = { segments: green.outer.map((p,i)=>[p,green.outer[(i+1)%green.outer.length]]) }, step = Math.max(6.5, planting.parkSpacing);
      const rows = lawn ? [3.5] : [4.2, 10.9].filter(d=>d<=planting.parkEdgeDepth);
      sampleRoad(line, step, 2.5, (p,dx,dz,index) => {
        const patch = Math.floor(index / 5), patchRng = stableRandom(`green-patch:${green.id}:${patch}:${seed}`);
        // Leave an occasional broad opening, not random single-tree holes.
        if (patchRng() < (lawn ? .26 : .12)) return;
        for (const [row, depth] of rows.entries()) {
          if (lawn && depth > planting.lawnEdgeDepth) continue;
          const along = (row % 2 ? step * .48 : 0) + (rng() - .5) * .8, inset = depth + (rng() - .5) * 1.1;
          for (const side of [-1,1]) {
            const q = [p[0] + dx * along - dz * inset * side, p[1] + dz * along + dx * inset * side];
            if (!suitable(q)) continue;
            // In concave polygons the row from a neighbouring edge can pass
            // farther into the lawn; enforce distance to the closest edge.
            const edge = Math.min(...green.outer.map((a,i)=>segmentDistance(q,a,green.outer[(i+1)%green.outer.length])));
            if (edge > (lawn ? planting.lawnEdgeDepth : planting.parkEdgeDepth)) continue;
            offer('inferred-green', String(green.id), { point: q, key: `green:${green.id}:${index}:${row}:${side}`, height: (lawn ? 7.8 : 8.6) + rng() * 2.5, shape: rng()<.28?'round':'spreading', plantingContext: lawn ? 'lawn-edge' : 'park-belt' });
          }
        }
      });
    }
  }
  for (const tree of landscapeTrees) offer('inferred-landscape', tree.siteKey || tree.template || String(tree.key), tree);
  const queues = new Map();
  for (const [source, groups] of candidates) {
    const sites = [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,items])=>items), queue=[];
    for (let rank=0;sites.some(items=>rank<items.length);rank++) for (const items of sites) if(items[rank]) queue.push(items[rank]);
    queues.set(source,{items:queue,index:0});
  }
  const counters = { 'inferred-osm-row':'rowTrees', 'inferred-street':'streetTrees', 'inferred-green':'greenTrees', 'inferred-landscape':'landscapeTrees' };
  const cycle = ['inferred-osm-row','inferred-street','inferred-street','inferred-green','inferred-landscape'];
  stats.treeCandidates = Object.fromEntries([...queues].map(([source,q])=>[source,q.items.length]));
  while (trees.length < maxTrees && [...queues.values()].some(q=>q.index<q.items.length)) {
    for (const source of cycle) {
      const queue=queues.get(source); if (!queue || queue.index>=queue.items.length || trees.length>=maxTrees) continue;
      const item=queue.items[queue.index++],{point,key,height,shape,group,...extra}=item;
      if(addTree(point,key,height,source,shape,extra)) stats[counters[source]]++;
    }
  }
  stats.treeBudget = maxTrees;
  stats.treeBudgetLimited = [...queues.values()].some(q=>q.index<q.items.length);
  const facilityGrid = new Grid(20), reserveFacility = (p, distance = 12) => {
    if ([...facilityGrid.near(p, distance)].some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < distance)) return false;
    facilityGrid.add(p, [p[0], p[1], p[0], p[1]]); return true;
  };
  const nearestRoad = p => {
    let result = null, distance = Infinity;
    for (const seg of roads.near(p, 25)) {
      const d = segmentDistance(p, seg.a, seg.b);
      if (d < distance && !/motorway|trunk.*link/.test(seg.road.type)) { result = seg; distance = d; }
    }
    return distance < 25 ? result : null;
  };
  for (const node of data.streetNodes || []) {
    if (!/street_lamp|traffic_signals/.test(node.kind)) continue;
    const seg = nearestRoad(node.point);
    if (!seg) continue;
    const { a, b, road } = seg, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    const along = clamp((node.point[0] - a[0]) * dx + (node.point[1] - a[1]) * dz, 0, length);
    const center = [a[0] + dx * along, a[1] + dz * along];
    const side = (node.point[0] - center[0]) * -dz + (node.point[1] - center[1]) * dx < 0 ? -1 : 1;
    const position = roadClear(node.point) ? node.point : [center[0] - dz * side * (road.width / 2 + 1.35), center[1] + dx * side * (road.width / 2 + 1.35)];
    if (!isClear(position, .3) || treeNear(position, 1.25) || !reserveFacility(position, 3)) continue;
    const observation = { source: 'osm-node', osmId: node.id, originalPoint: node.point, positionAdjusted: Math.hypot(position[0] - node.point[0], position[1] - node.point[1]) > .05 };
    if (node.kind === 'street_lamp') lamps.push({ point: position, direction: [dz * side, -dx * side], h: clamp(parseFloat(node.tags?.height) || 9, 4, 16), roadId:seg.road.id, ...observation });
    else signals.push({ point: position, angle: Math.atan2(dx, dz), roadId:seg.road.id, ...observation });
  }
  for (const road of plantedRoads) {
    const rng = stableRandom(`life:${road.id}:${seed}`);
    sampleRoad(road, 46, 9 + rng() * 22, (p, dx, dz, index) => {
      const side = index % 2 ? 1 : -1, offset = road.width / 2 + 1.45;
      const q = [p[0] - dz * side * offset, p[1] + dx * side * offset];
      if (isClear(q, .65) && !nearJunction(q, 10) && !treeNear(q, 2.4) && reserveFacility(q)) lamps.push({ point: q, direction: [dz * side, -dx * side], h: road.width >= 12 ? 10.5 : 8.5, roadId:road.id });
    });
    sampleRoad(road, 104, 12 + rng() * 60, (p, dx, dz, index) => {
      if (cars.length >= maxCars || nearJunction(p, 17)) return;
      const offset = road.width * .22, side = index % 2 ? 1 : -1;
      const q = [p[0] - dz * side * offset, p[1] + dx * side * offset];
      if (!validBounds(q, 6) || atBuilding(q, 1.2)) return;
      if (cars.some(c => Math.hypot(c.point[0] - q[0], c.point[1] - q[1]) < 14)) return;
      cars.push({ point: q, angle: Math.atan2(dx * side, dz * side), color: rng() < .56 ? '#d2d5d2' : rng() < .6 ? '#4b626c' : '#938472', source: 'inferred', roadId:road.id });
    });
    sampleRoad(road, 34, 7 + rng() * 25, (p, dx, dz, index) => {
      if (people.length >= maxPeople || rng() < .38) return;
      const side = index % 2 ? -1 : 1, offset = road.width / 2 + .95;
      const q = [p[0] - dz * side * offset, p[1] + dx * side * offset];
      if (isClear(q, .4) && !nearJunction(q, 5) && !treeNear(q, 1.6) && reserveFacility(q, 2)) people.push({ point: q, angle: Math.atan2(dx, dz), h: 1.55 + rng() * .25, source: 'inferred', roadId:road.id });
    });
    for (const [a, b] of road.segments) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 2) continue;
      const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
      for (let distance = 0; distance < length; distance += 8) {
        const size = Math.min(8, length - distance), p = [a[0] + dx * (distance + size / 2), a[1] + dz * (distance + size / 2)];
        if (nearJunction(p, Math.max(11, road.width))) continue;
        for (const side of [-1, 1]) {
          const q = [p[0] - dz * side * (road.width / 2 + .12), p[1] + dx * side * (road.width / 2 + .12)];
          // A center-only check leaves eight-metre kerbs protruding into a
          // joining carriageway. Check both ends and intermediate sections.
          const clear=[-.5,-.25,0,.25,.5].every(t=>roadClear([q[0]+dx*size*t,q[1]+dz*size*t],.02));
          if (clear&&!atBuilding(q, .1)) curbs.push({ point: q, angle: Math.atan2(dx, dz), length: size, roadId:road.id });
        }
      }
    }
  }
  const knownCrossings = (data.streetNodes || []).filter(n => n.kind === 'crossing' && !/^(no|unmarked)$/.test(n.tags?.crossing || ''));
  for (const node of knownCrossings) {
    const seg = nearestRoad(node.point);
    if (!seg || seg.road.width < 4 || segmentDistance(node.point, seg.a, seg.b) > seg.road.width / 2 + 2.5 || atBuilding(node.point, 1)) continue;
    const dx = seg.b[0] - seg.a[0], dz = seg.b[1] - seg.a[1], length = Math.hypot(dx, dz);
    const along = clamp(((node.point[0] - seg.a[0]) * dx + (node.point[1] - seg.a[1]) * dz) / length, 0, length);
    const point = [seg.a[0] + dx / length * along, seg.a[1] + dz / length * along];
    if (crosswalks.some(c => Math.hypot(c.point[0] - point[0], c.point[1] - point[1]) < 8)) continue;
    crosswalks.push({ point, angle: Math.atan2(dx, dz), width: Math.max(3, seg.road.width - 1), source: 'osm-crossing-node', osmId: node.id, roadId:seg.road.id });
  }
  // If the extract includes crossing nodes, use those observations instead of fabricating extra junctions.
  const inferredJunctions = knownCrossings.length ? [] : junctions.slice().sort((a, b) => b.roads[0].width - a.roads[0].width).slice(0, 20);
  for (const junction of inferredJunctions) {
    for (const seg of junction.directions.slice(0, 2)) {
      const road = seg.road, length = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
      const dx = (seg.b[0] - seg.a[0]) / length, dz = (seg.b[1] - seg.a[1]) / length;
      const otherWidth = Math.max(...junction.roads.filter(r => r.id !== road.id).map(r => r.width), 6);
      for (const direction of [-1, 1]) {
        const run = otherWidth / 2 + 5, p = [junction.point[0] + dx * run * direction, junction.point[1] + dz * run * direction];
        if (!validBounds(p, 8) || atBuilding(p, 2)) continue;
        // A connected approach must really exist here; do not paint beyond a T-junction.
        if (!road.segments.some(([a, b]) => segmentDistance(p, a, b) < .8)) continue;
        if (crosswalks.some(c => Math.hypot(c.point[0] - p[0], c.point[1] - p[1]) < 10)) continue;
        crosswalks.push({ point: p, angle: Math.atan2(dx, dz), width: Math.max(3, road.width - 1), source: 'inferred-junction', roadId:road.id });
        const q = [p[0] - dz * (road.width / 2 + 1.3), p[1] + dx * (road.width / 2 + 1.3)];
        if (isClear(q, .4) && !treeNear(q, 1.4) && reserveFacility(q, 4)) signals.push({ point: q, angle: Math.atan2(dx * direction, dz * direction), source: 'inferred-junction', roadId:road.id });
      }
    }
  }
  Object.assign(stats, { trees: trees.length, generatedTrees: stats.rowTrees + stats.streetTrees + stats.greenTrees + stats.landscapeTrees, lamps: lamps.length, cars: cars.length, people: people.length, crosswalks: crosswalks.length, signals: signals.length, curbs: curbs.length, observedCrossings: crosswalks.filter(c => c.source === 'osm-crossing-node').length, observedSignals: signals.filter(s => s.source === 'osm-node').length, observedLamps: lamps.filter(l => l.source === 'osm-node').length });
  const clippedKerbs=clipKerbsAtCrossings(curbs,crosswalks);curbs.length=0;curbs.push(...clippedKerbs.curbs);
  Object.assign(stats,{curbs:curbs.length,curbCrossingCuts:clippedKerbs.cutSegments,curbCrossingClearanceMetres:clippedKerbs.droppedLength});
  return gradeStreetLife({ trees, lamps, cars, people, curbs, crosswalks, signals, stats },roadPlan);
}

export function buildStreetLife(data, options = {}) {
  const plan = planStreetLife(data, options), treeGroup = new THREE.Group(), streetGroup = new THREE.Group();
  treeGroup.name = 'Trees — OSM observations and constrained procedural additions';
  streetGroup.name = 'Street life — inferred lamps, crossings, cars and pedestrians';
  const box = new THREE.BoxGeometry(1, 1, 1), cylinder = new THREE.CylinderGeometry(1, 1, 1, 7), crown = crownGeometry(), detailedCrown = crownGeometry(true);
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  function mesh(group, name, geometry, count, color, inkClass) {
    // Leaf instances already carry a species tint; a second green material
    // would multiply it twice and make every crown unnaturally dark.
    const result = new THREE.InstancedMesh(geometry, inkClass===2?foliageMaterial('#ffffff'):new THREE.MeshStandardMaterial({ color, roughness: .93 }), Math.max(1, count));
    result.count = count; result.name = name; result.userData.inkClass = inkClass;
    result.userData.procedural = true; result.castShadow = Math.floor(inkClass) !== 3; result.receiveShadow = true;
    group.add(result); return result;
  }
  function transform(target, i, pos, scale, angle = 0, color = null) {
    dummy.position.set(...pos); dummy.rotation.set(0, angle, 0); dummy.scale.set(...scale); dummy.updateMatrix(); target.setMatrixAt(i, dummy.matrix);
    if (color) target.setColorAt(i, new THREE.Color(color));
  }
  function surfaceTransform(target,i,item,scale,offset) {
    const [gx,gz]=item.grade||[0,0];
    transform(target,i,[item.point[0],(item.baseY??.32)+offset,item.point[1]],scale,item.angle);
    // Vertical shear follows the road plane while preserving kerb/paint depth.
    // Tilting only the object's centre leaves its far edge cutting the ramp.
    const m=dummy.matrix.elements;
    for(const column of [0,4,8])m[column+1]+=gx*m[column]+gz*m[column+2];
    target.setMatrixAt(i,dummy.matrix);
  }
  function strut(target, i, a, b, radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    dummy.position.copy(start).add(end).multiplyScalar(.5); dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize()); dummy.scale.set(radius, direction.length(), radius); dummy.updateMatrix(); target.setMatrixAt(i, dummy.matrix);
  }
  const trunks = mesh(treeGroup, 'Trunks', cylinder, plan.trees.length, '#756650', 4);
  const far = mesh(treeGroup, 'Distant tree crowns', crown, plan.trees.length, '#81916b', 2);
  const maxDetailedTrees=TREE_LOD.maxTrees,clusters=TREE_LOD.clusters;
  const near = mesh(treeGroup, 'Nearby crown clusters', detailedCrown, Math.min(plan.trees.length, maxDetailedTrees) * clusters, '#81916b', 2);
  const branches = mesh(treeGroup, 'Nearby branching', cylinder, Math.min(plan.trees.length, maxDetailedTrees) * TREE_LOD.branches, '#756650', 4);
  near.instanceMatrix.setUsage(THREE.DynamicDrawUsage); far.instanceMatrix.setUsage(THREE.DynamicDrawUsage); branches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  plan.trees.forEach((tree, i) => transform(trunks, i, [tree.x, tree.h * .28 + .35, tree.z], [tree.h * .016, tree.h * .56, tree.h * .016]));
  const colors = ['#778865', '#8b9975', '#738568', '#94a079'];
  const baseShapes = plan.trees.map(crownBase), baseColors = plan.trees.map(tree => new THREE.Color(colors[Math.floor(tree.variation * colors.length)]));
  baseShapes.forEach((base, i) => transform(far, i, base.position, base.scale, base.angle, baseColors[i]));
  // This base remains present in every pass and at every distance. Its initial
  // bounding sphere is valid throughout LOD because it only shrinks in place.
  far.computeBoundingSphere();
  const profiles = new Map(), tint = new THREE.Color();
  const lodState = { weights: new Float32Array(plan.trees.length), active: [], radius: TREE_LOD.distance, fullDistance: TREE_LOD.nearDistance };
  let lastPosition = null, previousActive = new Set();
  function updateLOD(camera) {
    const { x, y, z } = camera.position;
    if (lastPosition && x === lastPosition[0] && y === lastPosition[1] && z === lastPosition[2]) return;
    lastPosition = [x, y, z];
    const next = treeLODWeights(plan.trees, camera.position), activeSet = new Set(next.active.map(item => item.index));
    for (const index of new Set([...previousActive, ...activeSet])) {
      const base = baseShapes[index], weight = crownMorphWeight(next.weights[index]);
      transform(far, index, base.position, [base.scale[0] * (1 - .26 * weight), base.scale[1] * (1 - .18 * weight), base.scale[2] * (1 - .26 * weight)], base.angle);
    }
    if (previousActive.size || activeSet.size) far.instanceMatrix.needsUpdate = true;
    let n = 0, b = 0;
    for (const { index, weight: selectionWeight } of next.active) {
      const weight = crownMorphWeight(selectionWeight);
      if (!profiles.has(index)) profiles.set(index, crownProfile(plan.trees[index]));
      const profile = profiles.get(index);
      for (const cluster of profile.clusters) {
        // Lobes emerge from inside the common crown. No alpha, dithering or
        // pass-specific discard is involved: color, depth, normal, ID and
        // shadow passes all consume the very same instance transforms.
        const position = cluster.position.map((v, axis) => cluster.anchor[axis] + (v - cluster.anchor[axis]) * weight);
        transform(near, n++, position, cluster.scale.map(v => v * weight), cluster.angle, tint.copy(baseColors[index]).multiplyScalar(cluster.tint));
      }
      for (const branch of profile.branches) strut(branches, b++, branch.a, branch.b.map((v, axis) => branch.a[axis] + (v - branch.a[axis]) * weight), branch.radius * weight);
    }
    for (const [target, count] of [[near, n], [branches, b]]) { target.count = count; target.instanceMatrix.needsUpdate = true; if (target.instanceColor) target.instanceColor.needsUpdate = true; target.computeBoundingSphere(); }
    // Limit CPU-side profiles as well; re-created profiles are exactly seeded.
    if (profiles.size > maxDetailedTrees * 2) for (const index of profiles.keys()) { if (!activeSet.has(index)) profiles.delete(index); if (profiles.size <= maxDetailedTrees * 2) break; }
    previousActive = activeSet; Object.assign(lodState, next);
    const triangles = geometry => (geometry.index?.count || geometry.attributes.position.count) / 3;
    Object.assign(plan.stats, { nearTrees: next.active.length, transitionTrees: next.active.filter(item => item.weight < .999).length, treeDetailRadius: next.radius,
      crownTriangles: far.count * triangles(crown) + near.count * triangles(detailedCrown),
      treeTriangles: far.count * triangles(crown) + near.count * triangles(detailedCrown) + (trunks.count + branches.count) * triangles(cylinder),
      maxCrownTriangles: plan.trees.length * triangles(crown) + Math.min(plan.trees.length, maxDetailedTrees) * clusters * triangles(detailedCrown) });
  }
  updateLOD({ position: new THREE.Vector3(0, 1000, 0) });
  const poles = mesh(streetGroup, 'Roadside lamp poles', cylinder, plan.lamps.length, '#718080', 4);
  const arms = mesh(streetGroup, 'Lamp arms', cylinder, plan.lamps.length, '#718080', 4);
  const lights = mesh(streetGroup, 'Lamp housings', box, plan.lamps.length, '#e0dfc8', 4);
  plan.lamps.forEach((lamp, i) => {
    const [x, z] = lamp.point, [dx, dz] = lamp.direction, baseY=lamp.baseY??.35,y = lamp.h + baseY;
    transform(poles, i, [x, lamp.h / 2 + baseY, z], [.09, lamp.h, .09]);
    strut(arms, i, [x, y - .5, z], [x + dx * 2.3, y, z + dz * 2.3], .065);
    transform(lights, i, [x + dx * 2.3, y, z + dz * 2.3], [.38, .14, .85], Math.atan2(dx, dz));
  });
  const curb = mesh(streetGroup, 'Raised road kerbs', box, plan.curbs.length, '#d9d9ce', 4);
  plan.curbs.forEach((item, i) => surfaceTransform(curb,i,item,[.2,.23,item.length+.015],.08));
  const stripes = [];
  for (const item of plan.crosswalks) {
    const dx = Math.sin(item.angle), dz = Math.cos(item.angle);
    for (let lateral = -item.width / 2 + .5; lateral < item.width / 2 - .2; lateral += 1.15) {
      const point=[item.point[0]+dz*lateral,item.point[1]-dx*lateral],[gx,gz]=item.grade||[0,0];
      stripes.push({point,angle:item.angle,grade:item.grade,baseY:(item.baseY??.32)+gx*(point[0]-item.point[0])+gz*(point[1]-item.point[1])});
    }
  }
  const zebra = mesh(streetGroup, 'Inferred zebra crossings', box, stripes.length, '#f5f3e6', 3.5);
  // Paint sits just above the .32m carriageway, not as raised paving blocks.
  stripes.forEach((item, i) => surfaceTransform(zebra,i,item,[.58,.006,3.6],.006));
  const signalPoles = mesh(streetGroup, 'Inferred traffic signals', cylinder, plan.signals.length, '#65716c', 4);
  const signalBoxes = mesh(streetGroup, 'Signal housings', box, plan.signals.length, '#303a36', 4);
  const signalLamp = mesh(streetGroup, 'Signal lights', box, plan.signals.length, '#a6b47a', 4);
  plan.signals.forEach((item, i) => {
    const [x, z] = item.point,baseY=item.baseY??.3;
    transform(signalPoles, i, [x, baseY+1.6, z], [.065, 3.2, .065]);
    transform(signalBoxes, i, [x, baseY+3, z], [.28, .82, .2], item.angle);
    transform(signalLamp, i, [x + Math.sin(item.angle) * .105, baseY+2.8, z + Math.cos(item.angle) * .105], [.16, .16, .025], item.angle);
  });
  const carBodies = mesh(streetGroup, 'Inferred parked vehicles', box, plan.cars.length, '#bdc8c6', 4);
  const carCabins = mesh(streetGroup, 'Vehicle glass', box, plan.cars.length, '#485c61', 4);
  const wheels = mesh(streetGroup, 'Vehicle wheels', box, plan.cars.length * 4, '#454b47', 4);
  plan.cars.forEach((car, i) => {
    const [x,z]=car.point,dx=Math.sin(car.angle),dz=Math.cos(car.angle),[gx,gz]=car.grade||[0,0];
    const normal=new THREE.Vector3(-gx,1,-gz).normalize(),forward=new THREE.Vector3(dx,gx*dx+gz*dz,dz).normalize(),right=normal.clone().cross(forward).normalize();
    const frame=new THREE.Matrix4().makeBasis(right,normal,forward).setPosition(x,car.baseY??.32,z);
    const place=(mesh,index,offset,scale,color)=>{
      const matrix=frame.clone().multiply(new THREE.Matrix4().makeTranslation(...offset)).scale(new THREE.Vector3(...scale));
      mesh.setMatrixAt(index,matrix);if(color)mesh.setColorAt(index,new THREE.Color(color));
    };
    place(carBodies,i,[0,.67,0],[1.75,.66,4.2],car.color);
    place(carCabins,i,[0,1.16,-.2],[1.54,.52,2.25]);
    for (let j = 0; j < 4; j++) {
      const side = j % 2 ? 1 : -1, longitudinal = j < 2 ? 1.24 : -1.24;
      place(wheels,i*4+j,[side*.86,.28,longitudinal],[.2,.56,.62]);
    }
  });
  const torsos = mesh(streetGroup, 'Inferred pedestrians', cylinder, plan.people.length, '#797b70', 4);
  const heads = mesh(streetGroup, 'Pedestrian heads', new THREE.SphereGeometry(1, 7, 5), plan.people.length, '#c3b19b', 4);
  const legs = mesh(streetGroup, 'Pedestrian legs', cylinder, plan.people.length * 2, '#56615e', 4);
  plan.people.forEach((person, i) => {
    const [x, z] = person.point, h = person.h, dx = Math.sin(person.angle), dz = Math.cos(person.angle),baseY=person.baseY??.35;
    transform(torsos, i, [x, baseY + h * .57, z], [.19, h * .39, .15], person.angle);
    transform(heads, i, [x, baseY + h * .89, z], [.14, .17, .14]);
    for (let j = 0; j < 2; j++) transform(legs, i * 2 + j, [x + dz * (j ? .09 : -.09), baseY + h * .21, z - dx * (j ? .09 : -.09)], [.065, h * .42, .065]);
  });
  for (const group of [treeGroup, streetGroup]) group.traverse(object => { if (object.isInstancedMesh) { object.instanceMatrix.needsUpdate = true; if (object.instanceColor) object.instanceColor.needsUpdate = true; object.computeBoundingSphere(); } });
  return {
    treeGroup, streetGroup, treeCount: plan.trees.length, generatedTrees: plan.stats.generatedTrees,
    stats: plan.stats, plan, lodState, updateLOD,
    dispose() { const geometries = new Set(), materials = new Set(); for (const group of [treeGroup, streetGroup]) group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); }); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
