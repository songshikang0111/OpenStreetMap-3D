import * as THREE from 'three';

// Local planar construction only. The source widths, topology and coordinates
// remain OSM-derived; pavement margins and paint are illustrative rules.
const EPS = 1e-7;
const WALK = /^(footway|path|steps|pedestrian|cycleway)$/;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const shift = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t];
const left = d => [-d[1], d[0]];
const area = p => p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]), 0) / 2;
const bounds = p => p.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);

function pavementSides(road) {
  const tags=road.tags||{},value=tags.sidewalk;
  if(road.bridge||tags.foot==='no'||/^(no|none|separate)$/.test(value||''))return [];
  if(value==='left')return [1];if(value==='right')return [-1];
  if(/^(yes|both)$/.test(value||''))return [-1,1];
  // No invented sidewalks along motorways, slip roads or service access lanes.
  return /^(primary|secondary|tertiary|residential|living_street|unclassified)$/.test(road.type)?[-1,1]:[];
}

function buildingPavementBlockers(data) {
  const result=[];
  for(const building of data.buildings||[]){
    if(building.minHeight>.47)continue;
    const ring=building.outer.map(p=>new THREE.Vector2(...p)),holes=(building.holes||[]).map(h=>h.map(p=>new THREE.Vector2(...p))),points=[...ring,...holes.flat()];
    for(const triangle of THREE.ShapeUtils.triangulateShape(ring,holes)){
      const polygon=cleanPolygon(triangle.map(i=>points[i].toArray()));
      if(polygon.length)result.push({polygon,bounds:bounds(polygon),level:'0.32'});
    }
  }
  return result;
}

function cleanPolygon(points) {
  let p = points.filter((q, i) => q.every(Number.isFinite) && (!i || distance(q, points[i - 1]) > EPS));
  if (p.length > 1 && distance(p[0], p.at(-1)) < EPS) p.pop();
  p = p.filter((q, i) => Math.abs(cross(sub(q, p[(i + p.length - 1) % p.length]), sub(p[(i + 1) % p.length], q))) > EPS);
  if (p.length < 3 || Math.abs(area(p)) < EPS) return [];
  return area(p) < 0 ? p.reverse() : p;
}

// Convex half-plane clipping. All strip/join primitives and their fragments are
// convex, so no polygon boolean dependency or raster approximation is needed.
function splitPolygon(poly, a, b) {
  const inner = [], outer = [], edge = sub(b, a), length = Math.hypot(...edge);
  if (length < EPS) return [poly, []];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    // Tolerance is a distance, not an unnormalised cross product. Tiny edges
    // otherwise produce centimetre-wide overlaps in long thin road fragments.
    const dp = cross(edge, sub(p, a)) / length, dq = cross(edge, sub(q, a)) / length;
    if (dp >= -EPS) inner.push(p);
    if (dp <= EPS) outer.push(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq), hit = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      inner.push(hit); outer.push(hit);
    }
  }
  return [cleanPolygon(inner), cleanPolygon(outer)];
}

/** Return non-overlapping convex fragments of subject minus convex clip. */
export function subtractConvex(subject, clip) {
  let inside = cleanPolygon(subject);
  const cutter = cleanPolygon(clip), outside = [];
  if (!cutter.length) return inside.length ? [inside] : [];
  for (let i = 0; i < cutter.length && inside.length; i++) {
    const [next, part] = splitPolygon(inside, cutter[i], cutter[(i + 1) % cutter.length]);
    if (part.length) outside.push(part);
    inside = next;
  }
  return outside;
}

function intersectConvex(subject, clip) {
  let p = subject;
  for (let i = 0; i < clip.length && p.length; i++) p = splitPolygon(p, clip[i], clip[(i + 1) % clip.length])[0];
  return p;
}

class Grid {
  constructor(size = 40) { this.size = size; this.cells = new Map(); }
  keys(b) {
    const result = [], s = this.size;
    for (let x = Math.floor(b[0] / s); x <= Math.floor(b[2] / s); x++)
      for (let z = Math.floor(b[1] / s); z <= Math.floor(b[3] / s); z++) result.push(`${x},${z}`);
    return result;
  }
  add(item, box) { for (const key of this.keys(box)) { if (!this.cells.has(key)) this.cells.set(key, []); this.cells.get(key).push(item); } }
  query(box) { const result = new Set(); for (const key of this.keys(box)) for (const item of this.cells.get(key) || []) result.add(item); return result; }
}

function strip(a, b, width) {
  const len = distance(a, b), n = [(a[1] - b[1]) / len, (b[0] - a[0]) / len];
  return cleanPolygon([shift(a, n, width / 2), shift(a, n, -width / 2), shift(b, n, -width / 2), shift(b, n, width / 2)]);
}

function intersection(a, b) {
  const d = cross(a.direction, b.direction);
  if (Math.abs(d) < 1e-6) return null;
  const offset = sub(b.a, a.a), t = cross(offset, b.direction) / d, u = cross(offset, a.direction) / d;
  if (t < -EPS || t > a.length + EPS || u < -EPS || u > b.length + EPS) return null;
  return shift(a.a, a.direction, t);
}

function joinPrimitive(p, incoming, outgoing, firstWidth, secondWidth, miterLimit) {
  const turn = cross(incoming, outgoing);
  if (Math.abs(turn) < 1e-6 || dot(incoming, outgoing) < -.999) return null;
  const side = turn > 0 ? -1 : 1;
  const a = shift(p, left(incoming), side * firstWidth / 2), b = shift(p, left(outgoing), side * secondWidth / 2);
  const t = cross(sub(b, a), outgoing) / turn, miter = shift(a, incoming, t);
  const useMiter = distance(miter, p) <= Math.max(firstWidth, secondWidth) / 2 * miterLimit;
  return { polygon: cleanPolygon(useMiter ? [p, a, miter, b] : [p, a, b]), type: useMiter ? 'miter' : 'bevel' };
}

function segmentProjection(point, seg) {
  const t = Math.max(0, Math.min(seg.length, dot(sub(point, seg.a), seg.direction)));
  const p = shift(seg.a, seg.direction, t);
  return { t, point: p, distance: distance(point, p) };
}

function uniqueUnion(primitives, blockers, stats) {
  const index = new Grid(), result = [];
  for (const p of blockers) index.add(p, p.bounds);
  for (const primitive of primitives) {
    let pieces = [primitive.polygon];
    for (const previous of index.query(primitive.bounds)) {
      if (previous.level !== primitive.level) continue;
      const [a, b, c, d] = previous.bounds, [e, f, g, h] = primitive.bounds;
      if (c <= e + EPS || g <= a + EPS || d <= f + EPS || h <= b + EPS) continue;
      const before = pieces.reduce((s, p) => s + area(p), 0);
      pieces = pieces.flatMap(p => subtractConvex(p, previous.polygon));
      if (before - pieces.reduce((s, p) => s + area(p), 0) > 1e-5) stats.clippedOverlaps++;
      if (!pieces.length) break;
    }
    for (const polygon of pieces) result.push({ ...primitive, polygon, bounds: bounds(polygon) });
    // An original primitive covers exactly its accepted pieces plus previously
    // covered areas. Keeping it in the index avoids fragment growth in lookups.
    index.add(primitive, primitive.bounds);
  }
  return result;
}

/** Clip a line to the exterior of convex exclusion polygons. Distances in metres. */
export function clipPaintSegment(a, b, zones, minimumLength = 1) {
  const length = distance(a, b);
  if (length < EPS) return [];
  const d = sub(b, a), intervals = [];
  for (const zone of zones) {
    const poly = zone.polygon || zone;
    let lo = 0, hi = 1, hit = true;
    for (let i = 0; i < poly.length; i++) {
      const edge = sub(poly[(i + 1) % poly.length], poly[i]), start = cross(edge, sub(a, poly[i])), rate = cross(edge, d);
      if (Math.abs(rate) < EPS) { if (start < -EPS) { hit = false; break; } }
      else if (rate > 0) lo = Math.max(lo, -start / rate);
      else hi = Math.min(hi, -start / rate);
      if (lo > hi + EPS) { hit = false; break; }
    }
    if (hit && hi >= 0 && lo <= 1) intervals.push([Math.max(0, lo), Math.min(1, hi)]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const remaining = []; let t = 0;
  for (const [lo, hi] of intervals) { if (lo > t + EPS) remaining.push([t, lo]); t = Math.max(t, hi); }
  if (t < 1 - EPS) remaining.push([t, 1]);
  return remaining.filter(([u, v]) => (v - u) * length >= minimumLength - EPS).map(([u, v]) => [shift(a, d, u), shift(a, d, v)]);
}

/** Pure, deterministic plan; all polygons are disjoint within each level/layer. */
export function planRoadSurface(data, { pavementWidth = 1.75, miterLimit = 2.5, junctionClearance = 2.5, stopLines = true } = {}) {
  const stats = { sourceRoads: data.roads.length, segments: 0, driveSegments: 0, walkSegments: 0, miterJoins: 0, bevelJoins: 0, duplicateSegments: 0, clippedOverlaps: 0, junctions: 0, crossingExclusions: 0, dashes: 0, stopLines: 0 };
  const segments = [], drive = [], walks = [], paving = [], segmentKeys = new Set();
  const edgeIndex = new Grid(), endpoints = new Map();
  const [x0, z0, x1, z1] = data.bounds || [-1e8, -1e8, 1e8, 1e8];
  const frame = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const add = (target, polygon, seg, kind) => {
    polygon = intersectConvex(polygon, frame);
    const raised=!seg.road.bridge&&(kind==='paving'||kind==='walk'&&seg.road.tags?.footway!=='crossing');
    if (polygon.length) target.push({ polygon, bounds: bounds(polygon), level: seg.level, y: seg.y+(raised?.15:0), roadId: seg.road.id, kind, source:kind==='paving'?'inferred-roadside-margin':'osm-highway-centerline', bridge:seg.road.bridge, atGradeCrossing:seg.road.tags?.footway==='crossing' });
  };
  const ordered = [...data.roads].sort((a, b) => b.width - a.width || String(a.id).localeCompare(String(b.id)));
  for (const road of ordered) {
    if (!(road.width > 0) || !Number.isFinite(road.width) || road.tags?.tunnel === 'yes' || road.layer < 0) continue;
    let run = 0;
    for (const [a, b] of road.segments) {
      const length = distance(a, b);
      if (!a.every(Number.isFinite) || !b.every(Number.isFinite) || length < .01) continue;
      const walk = WALK.test(road.type), y = road.bridge ? 7 * Math.max(1, road.layer || 1) : .32, level = `${y}`;
      const keyPoint = p => p.map(v => v.toFixed(4)).join(',');
      const key = `${level}:${walk}:${road.width}:${[keyPoint(a), keyPoint(b)].sort().join('|')}`;
      if (segmentKeys.has(key)) { stats.duplicateSegments++; run += length; continue; } segmentKeys.add(key);
      const seg = { a: [...a], b: [...b], length, direction: sub(b, a).map(v => v / length), width: road.width, walk, y, level, road, run, id: segments.length, pavementSides:pavementSides(road) };
      run += length; segments.push(seg); edgeIndex.add(seg, bounds([a, b]));
      add(walk ? walks : drive, strip(a, b, road.width), seg, walk ? 'walk' : 'drive');
      if (!walk) for(const side of seg.pavementSides){
        const offset=side*(road.width+pavementWidth)/2,n=left(seg.direction);
        add(paving,strip(shift(a,n,offset),shift(b,n,offset),pavementWidth),seg,'paving');
      }
      for (const [point, direction] of [[a, seg.direction], [b, seg.direction.map(v => -v)]]) {
        const k = `${level}:${walk}:${keyPoint(point)}`;
        if (!endpoints.has(k)) endpoints.set(k, []);
        endpoints.get(k).push({ seg, point, away: direction });
      }
    }
  }
  for (const ends of endpoints.values()) {
    if (ends.length !== 2) continue;
    const [a, b] = ends, incoming = a.away.map(v => -v), outgoing = b.away;
    const join = joinPrimitive(a.point, incoming, outgoing, a.seg.width, b.seg.width, miterLimit);
    if (!join) continue;
    stats[join.type === 'miter' ? 'miterJoins' : 'bevelJoins']++;
    add(a.seg.walk ? walks : drive, join.polygon, a.seg, a.seg.walk ? 'walk' : 'drive');
    if (!a.seg.walk&&a.seg.pavementSides.length===2&&b.seg.pavementSides.length===2) {
      const outer = joinPrimitive(a.point, incoming, outgoing, a.seg.width + pavementWidth * 2, b.seg.width + pavementWidth * 2, miterLimit);
      if (outer) add(paving, outer.polygon, a.seg, 'paving');
    }
  }

  const junctionMap = new Map();
  for (const seg of segments.filter(s => !s.walk)) {
    for (const other of edgeIndex.query(bounds([seg.a, seg.b]))) {
      if (other.walk || other.id <= seg.id || other.level !== seg.level) continue;
      const point = intersection(seg, other);
      if (!point) continue;
      const key = `${seg.level}:${point.map(v => Math.round(v * 100)).join(',')}`;
      if (!junctionMap.has(key)) junctionMap.set(key, { point, level: seg.level, y: seg.y, segments: new Set() });
      junctionMap.get(key).segments.add(seg); junctionMap.get(key).segments.add(other);
    }
  }
  const junctions = [], exclusionZones = [];
  for (const j of junctionMap.values()) {
    // Include parallel continuations meeting the same node as a side street.
    for (const s of edgeIndex.query([j.point[0] - .02, j.point[1] - .02, j.point[0] + .02, j.point[1] + .02]))
      if (!s.walk && s.level === j.level && segmentProjection(j.point, s).distance < .02) j.segments.add(s);
    const branches = [];
    for (const s of j.segments) for (const endpoint of [s.a, s.b]) {
      const length = distance(j.point, endpoint);
      if (length < .02) continue;
      const direction = sub(endpoint, j.point).map(v => v / length);
      const prior = branches.find(b => dot(b.direction, direction) > .985);
      if (prior) prior.width = Math.max(prior.width, s.width);
      else branches.push({ direction, width: s.width, roadId: s.road.id });
    }
    if (branches.length < 3) continue; // A bend is not a junction.
    const zones = [];
    for (const branch of branches) {
      let reach = 0;
      for (const other of branches) {
        const sine = Math.abs(cross(branch.direction, other.direction));
        if (sine > .12) reach = Math.max(reach, (other.width / 2 + .2) / sine + junctionClearance);
      }
      const polygon = strip(shift(j.point, branch.direction, -reach), shift(j.point, branch.direction, reach), branch.width + .6);
      if (polygon.length) zones.push({ polygon, bounds: bounds(polygon), level: j.level, kind: 'junction' });
    }
    const radius = Math.max(...zones.flatMap(z => z.polygon.map(p => distance(p, j.point))));
    junctions.push({ point: j.point, level: j.level, y: j.y, radius, branches, zones }); exclusionZones.push(...zones);
  }

  const crossings = [], drivable = segments.filter(s => !s.walk);
  for (const node of data.streetNodes || []) {
    if (node.kind !== 'crossing' || /^(no|unmarked)$/.test(node.tags?.crossing || '')) continue;
    let nearest = null;
    for (const seg of drivable) {
      if (seg.road.bridge || /motorway|trunk.*link/.test(seg.road.type)) continue;
      const p = segmentProjection(node.point, seg);
      if (p.distance <= seg.width / 2 + 2.5 && (!nearest || p.distance < nearest.distance)) nearest = { ...p, seg };
    }
    if (!nearest || nearest.seg.width < 4 || crossings.some(c => distance(c.point, nearest.point) < 8)) continue;
    const { seg, point } = nearest;
    const polygon = strip(shift(point, seg.direction, -2.6), shift(point, seg.direction, 2.6), seg.width + .6);
    crossings.push({ point, seg, node });
    exclusionZones.push({ polygon, bounds: bounds(polygon), level: seg.level, kind: 'crossing', osmId: node.id });
  }

  const zonesIndex = new Grid(); for (const z of exclusionZones) zonesIndex.add(z, z.bounds);
  let markings = [];
  const clearLine = (a, b, level, minimum = 1) => clipPaintSegment(a, b, [...zonesIndex.query(bounds([a, b]))].filter(z => z.level === level), minimum);
  const markingKeys = new Set();
  for (const seg of drivable) {
    if (seg.width < 7) continue;
    // Phase follows cumulative way distance, including its very short segments.
    for (let t = 4 + Math.ceil((seg.run - 8) / 11) * 11 - seg.run; t < seg.length; t += 11) {
      const start = Math.max(0, t), end = Math.min(t + 4, seg.length);
      if (end - start < .1) continue;
      for (const [a, b] of clearLine(shift(seg.a, seg.direction, start), shift(seg.a, seg.direction, end), seg.level, .75)) {
        const key = `${seg.level}:${[a, b].map(p => p.map(v => v.toFixed(2)).join(',')).sort().join('|')}`;
        if (markingKeys.has(key)) continue; markingKeys.add(key);
        markings.push({ a, b, width: .18, y: seg.y + .018, level: seg.level, kind: 'dash', roadId: seg.road.id, source: 'inferred-lane-paint' });
      }
    }
  }
  if (stopLines) for (const { point, seg, node } of crossings) {
    const controlled = /traffic_signals|yes/.test(node.tags?.['crossing:signals'] || '') || node.tags?.crossing === 'traffic_signals' || (data.streetNodes || []).some(n => n.kind === 'traffic_signals' && distance(n.point, point) < 16);
    if (!controlled || seg.width < 7) continue;
    const junction = junctions.filter(j => j.level === seg.level && distance(j.point, point) < 45).sort((a, b) => distance(a.point, point) - distance(b.point, point))[0];
    if (!junction) continue;
    const sign = dot(sub(junction.point, point), seg.direction) >= 0 ? 1 : -1, toward = seg.direction.map(v => v * sign);
    const oneway = seg.road.tags?.oneway;
    if ((/^(yes|1|true)$/.test(oneway || '') && sign < 0) || (oneway === '-1' && sign > 0)) continue;
    const center = shift(point, toward, -3.8), right = left(toward);
    if (segmentProjection(center, seg).distance > .02) continue;
    const whole = /^(yes|1|true|-1)$/.test(oneway || ''), a = shift(center, right, whole ? -seg.width / 2 + .55 : .35), b = shift(center, right, seg.width / 2 - .55);
    // Stop lines are permitted only outside both the junction and zebra zones.
    const clear = clearLine(a, b, seg.level, 1);
    if (clear.length !== 1 || distance(clear[0][0], a) > .01 || distance(clear[0][1], b) > .01) continue;
    const polygon = strip(a, b, .4);
    if (exclusionZones.some(z => z.level === seg.level && intersectConvex(polygon, z.polygon).length)) continue;
    markings.push({ a, b, width: .4, y: seg.y + .02, level: seg.level, kind: 'stop', roadId: seg.road.id, source: 'inferred-from-osm-controlled-crossing', osmId: node.id });
  }

  // Also clip the *paint area*, not just its centre line: an oblique junction
  // must not retain a triangular corner of white paint inside the clear zone.
  const stopZones = markings.filter(m => m.kind === 'stop').map(m => {
    const polygon = strip(m.a, m.b, 1.2);
    return { polygon, bounds: bounds(polygon), level: m.level, kind: 'stop-clearance' };
  });
  for (const z of stopZones) zonesIndex.add(z, z.bounds);
  markings = markings.flatMap(m => {
    const clipped = intersectConvex(strip(m.a, m.b, m.width), frame);
    if (!clipped.length) return [];
    let fragments = [clipped];
    if (m.kind === 'dash') for (const zone of zonesIndex.query(bounds(fragments[0]))) {
      if (zone.level !== m.level) continue;
      fragments = fragments.flatMap(p => subtractConvex(p, zone.polygon));
      if (!fragments.length) break;
    }
    return fragments.filter(p => area(p) > .02).map(polygon => ({ ...m, polygon }));
  });

  // Vehicle surface owns shared ground. Pedestrian paths and pavement are cut
  // around it rather than covering a road with a differently coloured plane.
  const drivePolygons = uniqueUnion(drive, [], stats);
  // Observed crossing approaches own shared pedestrian ground, so a raised
  // sidewalk cannot fill back in the level crossing corridor.
  const walkPolygons = uniqueUnion([...walks].sort((a,b)=>Number(b.atGradeCrossing)-Number(a.atGradeCrossing)), drive, stats);
  const buildingBlockers=buildingPavementBlockers(data);
  // Same logical ground level despite the physical 15 cm curb step.
  const pavingPolygons = uniqueUnion(paving, [...drive, ...walks,...buildingBlockers], stats);
  const surfaces = [...drivePolygons, ...walkPolygons, ...pavingPolygons];
  Object.assign(stats, { segments: segments.length, driveSegments: drivable.length, walkSegments: segments.length - drivable.length, junctions: junctions.length, crossingExclusions: crossings.length, dashes: markings.filter(m => m.kind === 'dash').length, stopLines: markings.filter(m => m.kind === 'stop').length, drivePolygons: drivePolygons.length, walkPolygons: walkPolygons.length, pavingPolygons: pavingPolygons.length, surfaceTriangles: surfaces.reduce((s, p) => s + p.polygon.length - 2, 0), roadArea: drivePolygons.reduce((s, p) => s + area(p.polygon), 0), pavementArea: [...walkPolygons, ...pavingPolygons].reduce((s, p) => s + area(p.polygon), 0) });
  stats.observedSidewalkWays=data.roads.filter(r=>r.tags?.footway==='sidewalk').length;
  stats.observedCrossingWays=data.roads.filter(r=>r.tags?.footway==='crossing').length;
  stats.inferredMarginWays=new Set(paving.map(p=>p.roadId)).size;
  stats.pavementBuildingBlockers=buildingBlockers.length;
  return { surfaces, markings, junctions, exclusionZones, stopZones, segments, stats };
}

/** Minimal integration: replace old road/paving/paint meshes with this group. */
export function buildRoadSurface(data, options = {}) {
  const plan = planRoadSurface(data, options), group = new THREE.Group();
  group.name = 'Joined road surfaces and junction-aware markings';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
  function mesh(items, name, color, objectId) {
    if (!items.length) return;
    const positions = [], normals = [], colors = [], ids = [], c = new THREE.Color(color);
    for (const item of items) {
      const p = item.polygon || strip(item.a, item.b, item.width);
      for (let i = 1; i < p.length - 1; i++) {
        let triangle = [p[0], p[i + 1], p[i]].map(point => point.map(Math.fround));
        const signed = cross(sub(triangle[2], triangle[0]), sub(triangle[1], triangle[0]));
        const longest = Math.max(distance(triangle[0], triangle[1]), distance(triangle[1], triangle[2]), distance(triangle[2], triangle[0]));
        // Float32 cannot retain sub-millimetre slivers at kilometre coordinates.
        // Drop only triangles thinner than 0.15 mm to avoid flipped coplanar dust.
        if (Math.abs(signed) < longest * .00015) { plan.stats.discardedMicroTriangles = (plan.stats.discardedMicroTriangles || 0) + 1; continue; }
        if (signed < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
        for (const point of triangle) {
          positions.push(point[0], item.y, point[1]); normals.push(0, 1, 0); colors.push(c.r, c.g, c.b);
          ids.push((objectId & 255) / 255, ((objectId >> 8) & 255) / 255, ((objectId >> 16) & 255) / 255);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [key, values] of [['position', positions], ['normal', normals], ['color', colors], ['objectId', ids]]) geometry.setAttribute(key, new THREE.Float32BufferAttribute(values, 3));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const result = new THREE.Mesh(geometry, material); result.name = name;
    result.userData.inkClass = objectId===60004?3.5:objectId===60002?3.2:3; result.userData.procedural = true; result.userData.roadSurface=true; result.receiveShadow = true; result.castShadow = false;
    group.add(result);
  }
  mesh(plan.surfaces.filter(p => p.kind === 'drive'), 'Continuous carriageways', '#777e7c', 60003);
  mesh(plan.surfaces.filter(p => p.kind === 'walk'), 'OSM pedestrian paths and at-grade crossings', '#d0c9b9', 60002);
  mesh(plan.surfaces.filter(p => p.kind === 'paving'), 'Inferred roadside margins clipped at buildings', '#ddd7c8', 60002);
  mesh(plan.markings, 'Junction-aware lane paint and inferred stop lines', '#f9f6e9', 60004);
  plan.stats.renderedTriangles = group.children.reduce((n, mesh) => n + mesh.geometry.attributes.position.count / 3, 0);
  return { group, plan, stats: plan.stats, dispose() { group.traverse(o => o.geometry?.dispose()); material.dispose(); } };
}
