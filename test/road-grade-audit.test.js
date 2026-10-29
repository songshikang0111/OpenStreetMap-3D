import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOSM } from '../src/osm.js';
import { planRoadGrades } from '../src/road-grade.js';
import { planRoadSurface } from '../src/road-surface.js';
import { planRoadStructures } from '../src/road-structures.js';

// Acceptance checks deliberately use their own interpolation and polygon
// intersection instead of the production grade/crossing/clipping helpers.
const raw = JSON.parse(readFileSync(new URL('../public/data/beijing-cbd.json', import.meta.url)));
const data = parseOSM(raw);
const grades = planRoadGrades(data);
const walk = r => /^(footway|path|steps|pedestrian|cycleway)$/.test(r.type);
const nominal = r => r.bridge ? 7 * Math.max(1, r.layer || 1) : walk(r) && r.tags?.footway !== 'crossing' ? .47 : .32;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function progress(s, p) {
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
  return ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / (dx * dx + dz * dz);
}
function elevation(s, p) {
  const t = Math.max(0, Math.min(1, progress(s, p)));
  return s.yA + (s.yB - s.yA) * t + (s.heightOffset || 0);
}
const onLine = (s, p) => Math.abs(cross(s.a, s.b, p)) / dist(s.a, s.b) < 1e-5 && progress(s, p) > -1e-7 && progress(s, p) < 1 + 1e-7;
function strip(s) {
  const length = dist(s.a, s.b), nx = (s.a[1] - s.b[1]) / length * s.road.width / 2, nz = (s.b[0] - s.a[0]) / length * s.road.width / 2;
  return [[s.a[0] + nx, s.a[1] + nz], [s.a[0] - nx, s.a[1] - nz], [s.b[0] - nx, s.b[1] - nz], [s.b[0] + nx, s.b[1] + nz]];
}
function intersection(subject, clip) {
  let result = subject;
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], next = [];
    for (let j = 0; j < result.length; j++) {
      const p = result[j], q = result[(j + 1) % result.length], dp = cross(a, b, p), dq = cross(a, b, q);
      if (dp >= -1e-8) next.push(p);
      if ((dp < 0) !== (dq < 0)) {
        const t = dp / (dp - dq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    result = next;
  }
  return result;
}
const box = p => [Math.min(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[0])), Math.max(...p.map(v => v[1]))];
const overlaps = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
function crossingPoint(a, b) {
  const dx = a.b[0] - a.a[0], dz = a.b[1] - a.a[1], ex = b.b[0] - b.a[0], ez = b.b[1] - b.a[1], den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const qx = b.a[0] - a.a[0], qz = b.a[1] - a.a[1], t = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a.a[0] + dx * t, a.a[1] + dz * t] : null;
}
const sources = data.roads.flatMap(road => road.segments.map(([a, b], i) => ({ a, b, road, ids: road.segmentNodes[i] })));

test('actual Guomao shared OSM nodes are continuous after resampling and segment coalescing', () => {
  const nodes = new Map(), byRoad = new Map();
  for (const s of grades.segments) {
    if (!byRoad.has(s.road.id)) byRoad.set(s.road.id, []);
    byRoad.get(s.road.id).push(s);
  }
  for (const s of sources) for (let i = 0; i < 2; i++) {
    const id = s.ids[i];
    if (id == null) continue;
    if (!nodes.has(id)) nodes.set(id, { point: i ? s.b : s.a, roads: new Map() });
    nodes.get(id).roads.set(s.road.id, s.road);
  }
  let audited = 0;
  for (const [id, n] of nodes) {
    const values = [...n.roads.values()].map(nominal);
    if (Math.max(...values) - Math.min(...values) < 1) continue;
    const heights = [];
    for (const r of n.roads.values()) {
      const incident = byRoad.get(r.id).filter(s => onLine(s, n.point));
      assert(incident.length, `source node ${id} lost from way ${r.id}`);
      heights.push(...incident.map(s => elevation(s, n.point)));
    }
    assert(Math.max(...heights) - Math.min(...heights) < 1e-5, `node ${id} retains a vertical gap`);
    audited++;
  }
  assert.equal(audited, 78);
});

test('actual vehicle approaches do not introduce extreme slopes while joining bridge ends', () => {
  const failures = grades.segments.filter(s => !walk(s.road)).map(s => ({ id: s.road.id, slope: Math.abs(s.yB - s.yA) / dist(s.a, s.b) })).filter(s => s.slope > .15 + 1e-6);
  // 15% is an artifact regression ceiling, not a real road-design standard.
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 12)));
});

test('actual two-wing stairs reach both ground ends and the shared bridge platform', () => {
  for (const id of [115330813, 220881232, 115330839, 115330843]) {
    const r = data.roads.find(r => r.id === id), flights = grades.stairs.filter(s => s.roadIds.includes(id));
    assert.equal(flights.length, 2, `way ${id} must split into two flights at its middle platform`);
    const middle = r.segments[0][1];
    for (const flight of flights) {
      const head = dist(flight.points[0], middle) < 1e-5, tail = dist(flight.points.at(-1), middle) < 1e-5;
      assert(head || tail, `flight on ${id} misses its shared platform`);
      const upper = head ? flight.y0 : flight.y1, lower = head ? flight.y1 : flight.y0;
      assert(upper > lower + 4 && Math.abs(lower - .47) < 1e-5, `flight on ${id} does not descend to its mapped sidewalk`);
    }
  }
});

test('independent full-width intersections preserve layer order and actual deck-bottom clearance', () => {
  const surface = planRoadSurface(data), structures = planRoadStructures(data, surface);
  const decks = new Map(), lowSurfaces = new Map(), roadById = new Map(data.roads.map(r => [r.id, r]));
  const band = roadId => Math.round(nominal(roadById.get(roadId)) / 7);
  for (const d of structures.decks) {
    if (!decks.has(band(d.roadId))) decks.set(band(d.roadId), []);
    decks.get(band(d.roadId)).push(d);
  }
  for (const s of surface.surfaces.filter(s => s.kind !== 'paving' && !s.stairFlight)) {
    if (!lowSurfaces.has(band(s.roadId))) lowSurfaces.set(band(s.roadId), []);
    lowSurfaces.get(band(s.roadId)).push(s);
  }
  let pairs = 0, vertices = 0, minimum = Infinity;
  const failures = [];
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
    const a = sources[i], b = sources[j];
    if (a.road.type === 'steps' || b.road.type === 'steps' || Math.abs(nominal(a.road) - nominal(b.road)) < 1 || a.ids.some(id => id != null && b.ids.includes(id))) continue;
    if (!overlaps(box([a.a, a.b]), box([b.a, b.b])) || !crossingPoint(a, b)) continue;
    const [upper, lower] = nominal(a.road) > nominal(b.road) ? [a, b] : [b, a];
    const footprint = intersection(strip(upper), strip(lower)), bounds = box(footprint);
    if (footprint.length < 3) continue;
    let checked = 0;
    // Planar union may assign an overlap to the neighbouring way. Audit the
    // actual visible surface at that original layer, irrespective of owner ID.
    for (const deck of decks.get(band(upper.road.id)) || []) {
      if (!overlaps(deck.bounds, bounds)) continue;
      const topPart = intersection(deck.polygon, footprint);
      if (topPart.length < 3) continue;
      for (const lowerSurface of lowSurfaces.get(band(lower.road.id)) || []) {
        if (!overlaps(lowerSurface.bounds, bounds)) continue;
        const shared = intersection(topPart, lowerSurface.polygon);
        for (const point of shared) {
          const gap = elevation(deck, point) - deck.thickness - elevation(lowerSurface, point);
          minimum = Math.min(minimum, gap); vertices++; checked++;
          if (gap < 4.8 - 1e-5) failures.push({ upper: upper.road.id, lower: lower.road.id, gap, point });
        }
      }
    }
    assert(checked, `no actual surface overlap found at ${upper.road.id}/${lower.road.id}`);
    pairs++;
  }
  assert(pairs > 150 && vertices > 500, 'audit must cover the whole extract');
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 10)));
  console.log('Independent full-width clearance audit:', { pairs, vertices, minimum });
});
