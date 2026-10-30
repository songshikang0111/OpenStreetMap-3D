import { classifyLandscape, classifyLandscapeContext, isSurfaceLandscape } from './landscape-tags.js';

// All coordinates are local metres, x = east, z = south. No GCJ-02 offset.
export function projection(lat, lon) {
  const north = 111132.92 - 559.82 * Math.cos(2 * lat * Math.PI / 180);
  const east = 111412.84 * Math.cos(lat * Math.PI / 180) - 93.5 * Math.cos(3 * lat * Math.PI / 180);
  return {
    point: p => [(p.lon - lon) * east, -(p.lat - lat) * north],
    inverse: ([x, z]) => [lat - z / north, lon + x / east],
  };
}

export function area(ring) {
  return Math.abs(ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
}

export function inside(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

export function stableRandom(key) {
  let n = 0x811c9dc5;
  for (const c of String(key)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return (n >>> 0) / 4294967296; };
}

export function metres(value) {
  if (value === undefined || value === null) return NaN;
  const text = String(value).trim();
  const valueNumber = parseFloat(text);
  return /ft|feet|'/.test(text) ? valueNumber * .3048 : valueNumber;
}

export function heightInfo(tags, footprintArea, id, seed = 1) {
  const random = stableRandom(`${id}:${seed}`);
  const type = tags.building || tags['building:part'] || 'yes';
  const levelHeight = /office|commercial|retail/.test(type) ? 3.8 : 3.1;
  const levels = Number(tags['building:levels']);
  let height = metres(tags.height), source = 'height';
  if (!(height > 0)) {
    if (levels > 0) { height = levels * levelHeight; source = 'levels'; }
    else {
      source = 'estimated';
      let guessedFloors;
      if (/garage|shed|roof|service/.test(type)) guessedFloors = 1;
      else if (/house|detached/.test(type)) guessedFloors = 1 + Math.floor(random() * 2);
      else if (/industrial|warehouse/.test(type)) guessedFloors = 2;
      else if (/office|commercial/.test(type)) guessedFloors = 8 + Math.floor(random() * 15);
      else if (/apartments|residential/.test(type)) guessedFloors = 5 + Math.floor(random() * 9);
      else guessedFloors = footprintArea > 900 ? 5 + Math.floor(random() * 8) : 2 + Math.floor(random() * 5);
      height = guessedFloors * levelHeight;
    }
  }
  height = Math.max(1, Math.min(650, height));
  const minHeight = Math.max(0, metres(tags.min_height) || (Number(tags['building:min_level']) || 0) * levelHeight);
  return { height: Math.max(height, minHeight + .5), minHeight, levels: levels > 0 ? levels : Math.max(1, Math.round(height / levelHeight)), source };
}

const equalPoint = (a, b) => a && b && Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon) < 1e-8;
export function stitchRings(segments) {
  const pending = segments.filter(s => s?.length >= 2).map(s => [...s]);
  const rings = [];
  while (pending.length) {
    let ring = pending.pop(), changed = true;
    while (!equalPoint(ring[0], ring.at(-1)) && changed) {
      changed = false;
      for (let i = 0; i < pending.length; i++) {
        let segment = pending[i];
        if (equalPoint(ring.at(-1), segment.at(-1))) segment = [...segment].reverse();
        if (equalPoint(ring.at(-1), segment[0])) {
          ring.push(...segment.slice(1)); pending.splice(i, 1); changed = true; break;
        }
        if (equalPoint(ring[0], segment[0])) segment = [...segment].reverse();
        if (equalPoint(ring[0], segment.at(-1))) {
          ring = [...segment.slice(0, -1), ...ring]; pending.splice(i, 1); changed = true; break;
        }
      }
    }
    if (ring.length >= 4 && equalPoint(ring[0], ring.at(-1))) rings.push(ring.slice(0, -1));
  }
  return rings;
}

export function clipSegment(a, b, bounds) {
  const [xmin, zmin, xmax, zmax] = bounds;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz], q = [a[0] - xmin, xmax - a[0], a[1] - zmin, zmax - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-10) { if (q[i] < 0) return null; }
    else { const r = q[i] / p[i]; if (p[i] < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r); }
    if (t0 > t1) return null;
  }
  return [[a[0] + dx * t0, a[1] + dz * t0], [a[0] + dx * t1, a[1] + dz * t1]];
}

export function mergeOSMOverlay(raw, overlay, name) {
  const seen = new Set(raw.elements.map(e => `${e.type}:${e.id}`));
  for (const element of overlay.elements || []) {
    const key = `${element.type}:${element.id}`;
    if (!seen.has(key)) { raw.elements.push(element); seen.add(key); }
  }
  raw.metadata[name] = overlay.metadata;
  return raw;
}

export function parseOSM(raw, seed = 1) {
  if (!raw?.metadata?.bbox || !Array.isArray(raw.elements)) throw new Error('需要包含 metadata.bbox 和 elements 的 Overpass 数据文件。');
  const [south, west, north, east] = raw.metadata.bbox;
  const center = raw.metadata.center || [(south + north) / 2, (west + east) / 2];
  const project = projection(...center);
  const nw = project.point({ lat: north, lon: west }), se = project.point({ lat: south, lon: east });
  const bounds = [...nw, ...se];
  const contains = p => p[0] >= nw[0] && p[0] <= se[0] && p[1] >= nw[1] && p[1] <= se[1];
  const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const ways = new Map(raw.elements.filter(e => e.type === 'way').map(e => [e.id, e]));
  const geometry = e => e.geometry || (e.nodes || []).map(id => nodes.get(id)).filter(Boolean);
  const polygons = [], relationMembers = new Set();
  let invalidRings = 0;
  for (const e of raw.elements.filter(e => e.type === 'relation')) {
    if (e.tags?.type !== 'multipolygon') continue;
    const members = e.members || [];
    const outer = stitchRings(members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => m.geometry || geometry(ways.get(m.ref) || {})));
    const holes = stitchRings(members.filter(m => m.type === 'way' && m.role === 'inner').map(m => m.geometry || geometry(ways.get(m.ref) || {}))).map(r => r.map(project.point));
    if (!outer.length) { invalidRings++; continue; }
    for (const member of members) if (member.type === 'way') relationMembers.add(member.ref);
    outer.forEach((r, i) => {
      const ring = r.map(project.point);
      polygons.push({ id: `r${e.id}-${i}`, osmType: 'relation', osmId: e.id, outer: ring, holes: holes.filter(h => inside(h[0], ring)), tags: e.tags || {} });
    });
  }
  for (const e of ways.values()) {
    if (relationMembers.has(e.id)) continue;
    const g = geometry(e);
    if (g.length >= 4 && equalPoint(g[0], g.at(-1))) polygons.push({ id: `w${e.id}`, osmType: 'way', osmId: e.id, outer: g.slice(0, -1).map(project.point), holes: [], tags: e.tags || {} });
  }
  let buildings = [], greens = [], water = [], landscapes = [], landscapeContexts = [];
  for (const p of polygons) {
    const extent = p.outer.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    p.center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
    p.area = area(p.outer) - p.holes.reduce((s, h) => s + area(h), 0);
    if (p.area < 4 || extent[2] < bounds[0] || extent[0] > bounds[2] || extent[3] < bounds[1] || extent[1] > bounds[3]) continue;
    if ((p.tags.building && p.tags.building !== 'no') || (p.tags['building:part'] && p.tags['building:part'] !== 'no')) {
      if (!contains(p.center)) continue;
      if (p.tags.location === 'underground' || Number(p.tags.level) < 0) continue;
      Object.assign(p, heightInfo(p.tags, p.area, p.id, seed));
      p.part = Boolean(p.tags['building:part'] && p.tags['building:part'] !== 'no');
      buildings.push(p);
    } else {
      if (!isSurfaceLandscape(p.tags)) continue;
      if (p.tags.natural === 'water' || p.tags.amenity === 'fountain') { water.push(p); continue; }
      const kind = classifyLandscape(p.tags);
      if (kind) {
        landscapes.push({ ...p, kind, source: 'osm' });
        if (['lawn', 'wood', 'garden', 'park'].includes(kind)) greens.push(p);
      }
      const context = classifyLandscapeContext(p.tags);
      if (context) landscapeContexts.push({ ...p, context, source: 'osm' });
    }
  }
  // A fully represented building outline must not overlap its 3D parts.
  const parts = buildings.filter(b => b.part);
  let suppressed = 0;
  buildings = buildings.filter(b => {
    if (b.part) return true;
    const children = parts.filter(p => p.area < b.area * 1.05 && inside(p.center, b.outer));
    if (children.length && children.reduce((s, p) => s + p.area, 0) > b.area * .65) { suppressed++; return false; }
    return true;
  });
  const widths = { motorway: 16, trunk: 15, primary: 13, secondary: 10, tertiary: 8, residential: 6, service: 4, pedestrian: 5, footway: 2, cycleway: 2.5, path: 1.5, steps: 2 };
  const roads = [];
  for (const e of ways.values()) {
    const t = e.tags || {};
    if (!t.highway || t.area === 'yes' || t.tunnel === 'yes' || Number(t.layer) < 0 || t.highway === 'construction') continue;
    const points = geometry(e).map(project.point);
    const segments = [], segmentNodes = [];
    for (let i = 1; i < points.length; i++) {
      const clipped = clipSegment(points[i - 1], points[i], bounds);
      if (!clipped) continue;
      segments.push(clipped);
      // A cropped endpoint is not the original OSM node. Preserve the mapping
      // alongside each surviving segment, including internal/shared nodes.
      segmentNodes.push(clipped.map((p,j)=>Math.hypot(p[0]-points[i-1+j][0],p[1]-points[i-1+j][1])<1e-5 ? e.nodes?.[i-1+j]??null : null));
    }
    if (segments.length) roads.push({ id: e.id, name: t.name || '', type: t.highway, tags:t, nodes:e.nodes || [], segments, segmentNodes, width: Math.min(50, Math.max(1, metres(t.width) || Number(t.lanes) * 3.2 || widths[t.highway] || 6)), bridge: t.bridge === 'yes', layer: Number(t.layer) || 0 });
  }
  const trees = raw.elements.filter(e => e.type === 'node' && e.tags?.natural === 'tree').map(e => ({ point: project.point(e), id: e.id, height: metres(e.tags.height) || 7, tags: { ...e.tags } })).filter(e => contains(e.point));
  const streetNodes=raw.elements.filter(e=>e.type==='node' && /^(crossing|traffic_signals|street_lamp|bus_stop)$/.test(e.tags?.highway||'')).map(e=>({id:e.id,point:project.point(e),kind:e.tags.highway,tags:e.tags})).filter(e=>contains(e.point));
  const treeRows=raw.elements.filter(e=>e.type==='way' && e.tags?.natural==='tree_row').map(e=>({id:e.id,points:geometry(e).map(project.point),tags:e.tags}));
  return { buildings, roads, greens, water, landscapes, landscapeContexts, trees, streetNodes, treeRows, bounds, project, seed, metadata: raw.metadata, stats: { invalidRings, suppressed, landscapePolygons: landscapes.length } };
}
