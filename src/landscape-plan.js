import clipping from 'polygon-clipping';
import { area, inside, stableRandom } from './osm.js';

// Parameters are metres and counts. Aerial imagery can inform these regional
// proportions, but neither imagery nor a city's coordinates enter the planner.
export const LANDSCAPE_PROFILE = Object.freeze({
  buildingSetback: 3, accessWidth: 7, frontDepth: 29, maxFrontDepth: 43,
  roadSetback: 1.1, vergeDepth: 18, treeSpacing: 8.8,
  minSiteArea: 85, minPlantingArea: 22, maxSites: 540, maxTrees: 1200,
  maxProps: 260, maxSurfaces: 5200, maxCommons: 36, commonMinRadius: 20,
  commonMaxRadius: 65, commonSampling: 24, plantingInset: 2.6,
  forecourtApron: 4.2, gardenApron: 2.4, shrubWidth: 1.6,
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const bounds = ring => ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const intersects = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const open = ring => ring.length > 1 && dist(ring[0], ring.at(-1)) < 1e-7 ? ring.slice(0, -1) : ring;
// Joined road triangulation contains sub-millimetre slivers and repeated
// vertices. Quantise exclusion inputs to 1 mm before the boolean sweep; the
// separately reserved road margins are > 1 m, so this cannot consume access.
const snapPolygon = poly => {
  const rings = poly.map(raw => open(raw).map(p => p.map(n => Math.round(n * 1000) / 1000)).filter((p, i, a) => !i || dist(p, a[i - 1]) > 1e-7));
  const valid = ring => ring.length >= 3 && area(ring) > .00001;
  return !rings.length || !valid(rings[0]) ? [] : [rings[0], ...rings.slice(1).filter(valid)];
};
function boolean(operation, ...inputs) {
  const normalized = inputs.map(input => {
    const multi = typeof input[0]?.[0]?.[0] === 'number' ? [input] : input;
    return multi.map(snapPolygon).filter(p => p.length);
  });
  return clipping[operation](...normalized);
}
const geometry = p => [p.outer, ...(p.holes || [])];
const polygonArea = p => area(p[0]) - p.slice(1).reduce((sum, ring) => sum + area(ring), 0);
const totalArea = multi => multi.reduce((sum, p) => sum + polygonArea(p), 0);
const inPolygon = (p, polygon) => inside(p, polygon[0]) && !polygon.slice(1).some(h => inside(p, h));
const inMulti = (p, multi) => multi.some(poly => inPolygon(p, poly));

class Index {
  constructor(size = 64) { this.size = size; this.cells = new Map(); }
  keys(box) {
    const keys = [];
    for (let x = Math.floor(box[0] / this.size); x <= Math.floor(box[2] / this.size); x++)
      for (let z = Math.floor(box[1] / this.size); z <= Math.floor(box[3] / this.size); z++) keys.push(`${x},${z}`);
    return keys;
  }
  add(poly, source) {
    poly = snapPolygon(poly);
    if (!poly[0]?.length) return;
    const item = { polygon: poly, bounds: bounds(poly[0]), source };
    for (const key of this.keys(item.bounds)) {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(item);
    }
  }
  query(box) {
    const result = new Set();
    for (const key of this.keys(box)) for (const item of this.cells.get(key) || []) if (intersects(box, item.bounds)) result.add(item);
    return [...result];
  }
}

function strip(a, b, halfWidth, cap = 0) {
  const length = dist(a, b);
  if (length < .001) return null;
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], v = [-u[1], u[0]];
  const p = (t, n) => [a[0] + u[0] * t + v[0] * n, a[1] + u[1] * t + v[1] * n];
  return [[p(-cap, -halfWidth), p(length + cap, -halfWidth), p(length + cap, halfWidth), p(-cap, halfWidth)]];
}

function edgeBuffers(poly, padding) {
  if (!(padding > 0)) return [];
  const result = [];
  for (const raw of poly) {
    const ring = open(raw);
    for (let i = 0; i < ring.length; i++) {
      const piece = strip(ring[i], ring[(i + 1) % ring.length], padding, padding);
      if (piece) result.push(piece);
    }
  }
  return result;
}

function edgeDistance(point, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz));
  }
  return best;
}

function clearsBoundary(point, multi, radius) {
  return multi.some(poly => inPolygon(point, poly) && poly.every(ring => edgeDistance(point, open(ring)) >= radius));
}

function usablePlanting(poly, minimum) {
  const a = polygonArea(poly);
  if (a < minimum) return false;
  const ring = open(poly[0]), perimeter = ring.reduce((sum, p, i) => sum + dist(p, ring[(i + 1) % ring.length]), 0);
  // Reject razor-thin remnants of clipped templates. area/perimeter remains
  // meaningful under rotation, unlike an axis-aligned bounding box width.
  return 2 * a / perimeter >= 1.3;
}

function cleanMulti(multi, minimum = 2) {
  return multi.filter(p => polygonArea(p) >= minimum).map(p => p.map(open));
}

function balancedObjects(objects, budget) {
  const byTemplate = new Map();
  for (const item of objects) {
    if (!byTemplate.has(item.template)) byTemplate.set(item.template, new Map());
    const group = byTemplate.get(item.template);
    if (!group.has(item.siteKey)) group.set(item.siteKey, []);
    group.get(item.siteKey).push(item);
  }
  const queues = new Map();
  for (const [template, groups] of byTemplate) {
    const sites = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items);
    const queue = [];
    for (let rank = 0; sites.some(items => rank < items.length); rank++) for (const items of sites) if (items[rank]) queue.push(items[rank]);
    queues.set(template, queue);
  }
  // Residential courts receive two shares; each other template receives one.
  // Empty shares automatically flow to populated categories on later passes.
  const cycle = ['forecourt', 'garden-court', 'garden-court', 'verge', 'pocket-common'], selected = [];
  const indices = new Map();
  while (selected.length < budget) {
    let added = false;
    for (const template of cycle) {
      const queue = queues.get(template), index = indices.get(template) || 0;
      if (!queue || index >= queue.length || selected.length >= budget) continue;
      selected.push(queue[index]); indices.set(template, index + 1); added = true;
    }
    if (!added) break;
  }
  return selected;
}

const KNOWN_PRIORITY = { parking: 0, sport: 1, construction: 2, soil: 3, plaza: 4, lawn: 5, garden: 6, wood: 7, park: 8 };

/**
 * Resolve observed ground uses, then design conservative illustrative courts
 * in the remaining space. This is a ground-only layout: it does not infer
 * building entrances, property boundaries, rooftop gardens or satellite masks.
 */
export function planLandscape(data, { roadPlan = null, seed = 1, profile = {} } = {}) {
  const settings = { ...LANDSCAPE_PROFILE };
  for (const key of Object.keys(settings)) if (Number.isFinite(profile[key])) settings[key] = profile[key];
  for (const key of ['buildingSetback', 'accessWidth', 'frontDepth', 'maxFrontDepth', 'roadSetback', 'vergeDepth', 'treeSpacing', 'minSiteArea', 'minPlantingArea', 'commonMinRadius', 'commonMaxRadius', 'commonSampling']) settings[key] = Math.max(LANDSCAPE_PROFILE[key] * .5, settings[key]);
  for (const key of ['maxSites', 'maxTrees', 'maxProps', 'maxSurfaces', 'maxCommons']) settings[key] = Math.max(0, Math.floor(settings[key]));
  for (const key of ['plantingInset', 'forecourtApron', 'gardenApron', 'shrubWidth']) settings[key] = clamp(settings[key], .5, 12);
  settings.maxFrontDepth = Math.max(settings.frontDepth, settings.maxFrontDepth);
  settings.commonMaxRadius = Math.max(settings.commonMinRadius, settings.commonMaxRadius);
  const [x0, z0, x1, z1] = data.bounds;
  const frame = [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
  const ground = new Index(), exclusions = new Index(), occupied = new Index(), knownOccupied = new Index();
  const surfaces = [], trees = [], props = [], sites = [];
  const stats = { observedFeatures: 0, observedSurfaceArea: 0, inferredSites: 0, inferredPavedArea: 0, inferredPlantedArea: 0, rejectedCandidates: 0, rejectedGeometry: 0, templates: {}, layouts: {}, kindAreas: {}, source: 'OSM tagged ground polygons + constrained illustrative site templates; no imagery-derived masks' };

  for (const building of data.buildings || []) {
    const poly = geometry(building);
    ground.add(poly, 'building');
    exclusions.add(poly, 'building');
    for (const buffer of edgeBuffers(poly, settings.buildingSetback)) exclusions.add(buffer, 'building-clearance');
  }
  // Preserve the actual joined surface footprints, including raised decks and
  // stairs, so inferred vegetation cannot occupy their landings or supports.
  if (roadPlan?.surfaces?.length) {
    for (const item of roadPlan.surfaces) {
      const poly = [item.polygon];
      ground.add(poly, 'road'); exclusions.add(poly, 'road');
    }
  }
  for (const road of data.roads || []) for (const [a, b] of road.segments || []) {
    const walk = /^(footway|path|steps|pedestrian|cycleway|corridor)$/.test(road.type);
    const sidewalk = /^(primary|secondary|tertiary|residential|living_street|unclassified)$/.test(road.type) ? 1.75 : 0;
    const poly = strip(a, b, road.width / 2 + (walk ? .5 : sidewalk) + settings.roadSetback, settings.roadSetback);
    if (poly) { ground.add(poly, 'road-clearance'); exclusions.add(poly, 'road-clearance'); }
  }
  for (const water of data.water || []) {
    const poly = geometry(water); ground.add(poly, 'water'); exclusions.add(poly, 'water');
    for (const buffer of edgeBuffers(poly, 1)) exclusions.add(buffer, 'water-margin');
  }
  const observed = [...(data.landscapes || [])];
  const observedIds = new Set(observed.map(f => f.id));
  // Backward compatible with extracts parsed before the landscape vocabulary.
  for (const green of data.greens || []) if (!observedIds.has(green.id)) observed.push({ ...green, kind: /wood|forest/.test(green.tags?.natural || green.tags?.landuse || '') ? 'wood' : green.tags?.leisure === 'park' ? 'park' : green.tags?.leisure === 'garden' ? 'garden' : 'lawn' });
  for (const feature of observed) {
    const poly = geometry(feature); exclusions.add(poly, 'osm-landscape');
    for (const buffer of edgeBuffers(poly, .02)) exclusions.add(buffer, 'osm-landscape-margin');
  }
  // Industrial/railway yards are not ordinary public open space. A broad
  // commercial/residential polygon, by contrast, is only neighbourhood context.
  for (const context of data.landscapeContexts || []) if (/^(railway|industrial)$/.test(context.kind || context.context || context.tags?.landuse || '')) {
    exclusions.add(geometry(context), 'restricted-context');
  }

  const clip = (poly, index, other = null) => {
    const box = bounds(poly[0]);
    poly = snapPolygon(poly);
    if (!poly.length) return [];
    let result = boolean('intersection', poly, frame);
    if (!result.length) return [];
    const cutters = [...index.query(box), ...(other ? other.query(box) : [])].map(item => item.polygon);
    if (cutters.length) result = boolean('difference', result, ...cutters);
    return cleanMulti(result);
  };
  const emit = (multi, attributes) => {
    for (const poly of multi) {
      const surface = { ...attributes, outer: open(poly[0]), holes: poly.slice(1).map(open), area: polygonArea(poly) };
      surfaces.push(surface);
      stats.kindAreas[surface.kind] = (stats.kindAreas[surface.kind] || 0) + surface.area;
    }
  };
  for (const feature of observed.sort((a, b) => (KNOWN_PRIORITY[a.kind] ?? 20) - (KNOWN_PRIORITY[b.kind] ?? 20) || String(a.id).localeCompare(String(b.id)))) {
    let pieces;
    try { pieces = clip(geometry(feature), ground, knownOccupied); }
    catch { stats.rejectedGeometry++; continue; } // Still excluded from inference.
    if (!pieces.length) continue;
    emit(pieces, { id: `osm:${feature.id}`, kind: feature.kind || 'soil', source: 'osm', osmId: feature.osmId, tags: feature.tags, template: 'observed-ground' });
    for (const poly of pieces) knownOccupied.add(poly, 'observed');
    stats.observedFeatures++; stats.observedSurfaceArea += totalArea(pieces);
  }

  function safeDesignSite(candidate) {
    // Imported maps can contain invalid/self-touching geometry. Reject only
    // that speculative site; never recover by ignoring an exclusion polygon.
    try { designSite(candidate); }
    catch { stats.rejectedGeometry++; }
  }

  function designSite({ key, origin, u, v, width, depth, start, template }) {
    const siteLimit = template === 'verge' ? Math.floor(settings.maxSites * .9) : Math.ceil(settings.maxSites * .7);
    if (sites.length >= siteLimit || surfaces.length >= settings.maxSurfaces) return;
    const point = (a, b) => [origin[0] + u[0] * a + v[0] * b, origin[1] + u[1] * a + v[1] * b];
    const rect = (a, b, c, d) => [[point(a, c), point(b, c), point(b, d), point(a, d)]];
    const candidate = rect(-width / 2, width / 2, start, depth);
    const pieces = clip(candidate, exclusions, occupied).filter(p => polygonArea(p) >= 28);
    const available = totalArea(pieces);
    if (available < settings.minSiteArea || available < width * (depth - start) * .19) { stats.rejectedCandidates++; return; }
    const rng = stableRandom(`site:${key}:${seed}`), access = Math.min(width * .28, settings.accessWidth) / 2;
    const inset = settings.plantingInset, first = start + (template === 'forecourt' ? settings.forecourtApron : settings.gardenApron), last = depth - inset;
    // Low-frequency asymmetry is stable for the site's identity. Rerolling
    // trees does not move access routes or reconfigure the whole ground plan.
    const layoutRandom=stableRandom(`site-layout:${key}`), choice=layoutRandom();
    const layout=template==='verge'||choice<.5?'paired':choice<.75?'single':'offset',singleSide=layoutRandom()<.5?0:1;
    let planting = [];
    // Two generous planting panels flank an unobstructed route. Each remains
    // continuous even when the original boundary is irregular or has holes.
    if (last - first >= 3.6 && width > access * 2 + inset * 4) {
      for (const [panel,[a, b]] of [[-width / 2 + inset, -access - 1.1], [access + 1.1, width / 2 - inset]].entries()) {
        if(layout==='single'&&panel!==singleSide)continue;
        if (b - a < 4) continue;
        const lo=layout==='offset'&&panel===1?first+(last-first)*.24:first;
        const hi=layout==='offset'&&panel===0?last-(last-first)*.30:last;
        const cut = boolean('intersection', pieces, rect(a, b, lo, hi));
        planting.push(...cut.filter(p => usablePlanting(p, settings.minPlantingArea)));
      }
    }
    const paved = planting.length ? cleanMulti(boolean('difference', pieces, planting), 2) : pieces;
    // Do not retain large speculative paving-only courts. Small entry aprons
    // remain useful, but broad blank hardstanding would just move the problem.
    if (!planting.length && available > 900) { stats.rejectedCandidates++; return; }
    const attributes = { id: key, source: 'inferred-landscape', template, layout };
    const shrub = planting.length && last - first >= 7 ? cleanMulti(boolean('intersection', planting, rect(-width / 2, width / 2, Math.max(first,last - settings.shrubWidth), last)), 6) : [];
    const lawns = shrub.length ? cleanMulti(boolean('difference', planting, shrub)) : cleanMulti(planting);
    if (surfaces.length + paved.length + lawns.length + shrub.length > settings.maxSurfaces) { stats.rejectedCandidates++; return; }
    emit(paved, { ...attributes, kind: 'paving' });
    emit(lawns, { ...attributes, kind: template === 'verge' ? 'garden' : 'lawn' });
    emit(shrub, { ...attributes, kind: 'shrub' });
    for (const poly of pieces) occupied.add(poly, key);
    stats.inferredPavedArea += totalArea(paved); stats.inferredPlantedArea += totalArea(planting);
    stats.templates[template] = (stats.templates[template] || 0) + 1;
    stats.layouts[layout]=(stats.layouts[layout]||0)+1;
    sites.push({ key, template, layout, origin, u, v, width, start, depth, accessWidth: access * 2, area: available });

    // Mature crowns share an avenue-like rhythm. Wider panels receive a
    // staggered second rank, keeping their middle access axis entirely clear.
    const spacing = settings.treeSpacing, rowDepths = [first + Math.min(4.4, (last-first)*.5)];
    if (last-first >= 12.5) rowDepths.push(Math.min(last-3.1, rowDepths[0]+6.7));
    let localSerial=0;
    for (const [row,b] of rowDepths.entries()) for (let a=-width/2+5+(row%2)*spacing*.5; a<width/2-3; a+=spacing) {
      if (Math.abs(a)<access+3.8) continue;
      const across=a+(rng()-.5)*.8, q=point(across,b+(rng()-.5)*.8);
      if(!clearsBoundary(q,planting,2.35))continue;
      const h=(template==='verge'?8.1:8.5)+rng()*2,choice=rng();
      trees.push({point:q,key:`${key}:tree:${localSerial++}`,siteKey:key,template,height:h,shape:choice<.25?'round':choice<.6?'vase':'spreading',source:'inferred-landscape'});
    }
    if (width > 30 && planting.length) {
      const along = Math.min(depth - 3.5, start + 9), across = access + .55;
      const q = point(across, along), footprint = [[-.325,-1],[.325,-1],[.325,1],[-.325,1]].map(([a,b]) => point(across + a, along + b));
      if (footprint.every(p => inMulti(p, paved)) && totalArea(boolean('difference',[footprint],paved))<.002) props.push({ point: q, angle: Math.atan2(v[0], v[1]), width: .65, length: 2, kind: 'bench', siteKey: key, template, source: 'inferred-landscape', key: `${key}:bench` });
    }
  }

  // Large buildings anchor their surroundings first. Outward normals are
  // determined geometrically, so rotated/non-Beijing footprints behave alike.
  const buildings = [...(data.buildings || [])].filter(b => area(b.outer) >= 95 && !(b.minHeight > 3));
  buildings.sort((a, b) => area(b.outer) - area(a.outer) || String(a.id).localeCompare(String(b.id)));
  for (const building of profile.enabled === false ? [] : buildings) {
    const ring = open(building.outer), edges = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], length = dist(a, b);
      if (length < 17) continue;
      const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], origin = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let v = [-u[1], u[0]];
      if (inside([origin[0] + v[0] * .1, origin[1] + v[1] * .1], ring)) v = v.map(n => -n);
      edges.push({ index: i, length, u, v, origin });
    }
    edges.sort((a, b) => b.length - a.length || a.index - b.index);
    for (const edge of edges.slice(0, 4)) {
      const depth = clamp(settings.frontDepth + (building.height || 18) * .055, settings.frontDepth, settings.maxFrontDepth);
      safeDesignSite({ key: `court:${building.id}:${edge.index}`, ...edge, width: Math.min(240, edge.length), depth, start: settings.buildingSetback, template: building.height >= 45 ? 'forecourt' : 'garden-court' });
    }
  }
  // Residual road-edge land is a shallower planted margin with a longitudinal
  // walking strip. It never grants a whole unmapped block park status.
  const roads = [...(data.roads || [])].filter(r => !r.bridge && !r.tunnel && !/^(motorway|trunk|.*link|service|steps|footway|path|cycleway)$/.test(r.type) && r.width >= 6);
  roads.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const road of profile.enabled === false ? [] : roads) for (let i = 0; i < road.segments.length; i++) {
    const [a, b] = road.segments[i], length = dist(a, b);
    if (length < 38) continue;
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], origin = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const side of [-1, 1]) {
      const start = road.width / 2 + 3.2;
      safeDesignSite({ key: `verge:${road.id}:${i}:${side}`, origin, u, v: [-u[1] * side, u[0] * side], width: Math.max(10, length - 12), start, depth: start + settings.vergeDepth, template: 'verge' });
    }
  }

  // A coarse distance field locates deep residual voids. Cells are never drawn:
  // accepted maxima become a few large, chamfered commons aligned to nearby
  // streets/architecture, with irregular three-part lawns and generous paving.
  const anchors = new Index();
  for (const road of data.roads || []) for (const [a,b] of road.segments || []) {
    if (/^(motorway|trunk|.*link)$/.test(road.type)) continue;
    const length = dist(a,b); if (length < 12) continue;
    anchors.add(strip(a,b,.1), { a, b, u: [(b[0]-a[0])/length,(b[1]-a[1])/length] });
  }
  for (const building of buildings) for (let i=0;i<building.outer.length;i++) {
    const a=building.outer[i],b=building.outer[(i+1)%building.outer.length],length=dist(a,b); if(length<20)continue;
    anchors.add(strip(a,b,.1),{a,b,u:[(b[0]-a[0])/length,(b[1]-a[1])/length]});
  }
  const distanceToOccupied = point => {
    const reach=settings.commonMaxRadius, box=[point[0]-reach,point[1]-reach,point[0]+reach,point[1]+reach];
    let clearance=Math.min(point[0]-x0,x1-point[0],point[1]-z0,z1-point[1],reach);
    for(const item of [...exclusions.query(box),...occupied.query(box)]) {
      if(inPolygon(point,item.polygon))return 0;
      for(const ring of item.polygon)clearance=Math.min(clearance,edgeDistance(point,open(ring)));
      if(clearance<settings.commonMinRadius)return clearance;
    }
    return clearance;
  };
  const commonCandidates=[];
  if(profile.enabled!==false&&settings.maxCommons>0) {
    const step=Math.max(settings.commonSampling,Math.sqrt((x1-x0)*(z1-z0)/10000));
    for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step) {
      const point=[x,z],clearance=distanceToOccupied(point);if(clearance<settings.commonMinRadius)continue;
      let nearest=null,best=150;
      for(const item of anchors.query([x-150,z-150,x+150,z+150])) {
        const d=edgeDistance(point,[item.source.a,item.source.b]);
        if(d<best){nearest=item.source;best=d;}
      }
      if(nearest)commonCandidates.push({point,clearance,u:nearest.u,key:`common:${Math.round((x-x0)/step)}:${Math.round((z-z0)/step)}`});
    }
    commonCandidates.sort((a,b)=>b.clearance-a.clearance||a.key.localeCompare(b.key));
  }
  let commonCount=0;
  function designCommon(candidate) {
    if(commonCount>=settings.maxCommons||sites.length>=settings.maxSites)return;
    const clearance=distanceToOccupied(candidate.point);if(clearance<settings.commonMinRadius)return;
    const radius=clamp(clearance*1.65,settings.commonMinRadius,settings.commonMaxRadius);
    const {point:origin,u,key}=candidate,v=[-u[1],u[0]],halfW=radius*1.08,halfD=radius*.88;
    const point=(a,b)=>[origin[0]+u[0]*a+v[0]*b,origin[1]+u[1]*a+v[1]*b];
    const octagon=(w,d)=>[[-w*.72,-d],[w*.66,-d],[w,-d*.58],[w,d*.65],[w*.64,d],[-w*.7,d],[-w,d*.55],[-w,-d*.57]].map(([a,b])=>point(a,b));
    const candidatePoly=[octagon(halfW,halfD)],pieces=clip(candidatePoly,exclusions,occupied),available=totalArea(pieces);
    if(available<1600||available<polygonArea(candidatePoly)*.48)return;
    const access=Math.max(8,settings.accessWidth),central=strip(point(0,-halfD-2),point(0,halfD+2),access/2);
    const diagonal=strip(point(-halfW-2,-halfD*.26),point(0,halfD*.34),3.4);
    const plaza=[Array.from({length:12},(_,i)=>point(Math.cos(i*Math.PI/6)*11,Math.sin(i*Math.PI/6)*11))];
    let planting=boolean('intersection',pieces,[octagon(halfW*.79,halfD*.77)]);
    planting=boolean('difference',planting,central,diagonal,plaza);
    // When a candidate is clipped against an existing court, retain an extra
    // walkable seam along that *new* boundary too. Old entry routes never end
    // directly in a hedge even when the common expands beyond its empty centre.
    const box=bounds(candidatePoly[0]),buffers=[];
    for(const item of occupied.query(box))buffers.push(...edgeBuffers(item.polygon,3));
    if(buffers.length&&planting.length)planting=boolean('difference',planting,...buffers);
    planting=cleanMulti(planting.filter(p=>usablePlanting(p,75)),75);
    if(!planting.length)return;
    const paved=cleanMulti(boolean('difference',pieces,planting));
    if(surfaces.length+paved.length+planting.length>settings.maxSurfaces)return;
    const attributes={id:key,source:'inferred-landscape',template:'pocket-common'};
    emit(paved,{...attributes,kind:'paving'});emit(planting,{...attributes,kind:'lawn'});
    for(const poly of pieces)occupied.add(poly,key);
    stats.inferredPavedArea+=totalArea(paved);stats.inferredPlantedArea+=totalArea(planting);
    stats.templates['pocket-common']=(stats.templates['pocket-common']||0)+1;
    sites.push({key,template:'pocket-common',origin,u,v,width:halfW*2,start:-halfD,depth:halfD,accessWidth:access,area:available,radius,openEdgeMargin:3});commonCount++;
    const rng=stableRandom(`site:${key}:${seed}`),localTrees=[];
    const target=Math.min(24,Math.max(8,Math.round(available/400)));
    for(let i=0;i<160&&localTrees.length<target;i++) {
      const a=(rng()*2-1)*halfW*.78,b=(rng()*2-1)*halfD*.77,angle=rng()*Math.PI*2;
      // Plant little 2–3 tree groups along the open lawn's margins. A random
      // anchor alone produces isolated dots; companions create linked crowns.
      for(let member=0;member<3&&localTrees.length<target;member++) {
        const offset=member===0?0:6.6,azimuth=angle+(member-1)*2.1;
        const q=point(a+Math.cos(azimuth)*offset,b+Math.sin(azimuth)*offset);
        if(!clearsBoundary(q,planting,2.8)||localTrees.some(t=>dist(q,t.point)<6.1))continue;
        if(Math.min(...planting.filter(p=>inPolygon(q,p)).flatMap(p=>p.map(r=>edgeDistance(q,open(r)))))>11)continue;
        const tree={point:q,key:`${key}:tree:${localTrees.length}`,siteKey:key,template:'pocket-common',height:8.2+rng()*2.6,shape:rng()<.3?'round':'spreading',source:'inferred-landscape'};
        localTrees.push(tree);trees.push(tree);
      }
    }
    for(const side of [-1,1]) {
      const across=side*(access/2+.55),along=side*3,q=point(across,along);
      const footprint=[[-.325,-1],[.325,-1],[.325,1],[-.325,1]].map(([a,b])=>point(across+a,along+b));
      if(footprint.every(p=>inMulti(p,paved))&&totalArea(boolean('difference',[footprint],paved))<.002)props.push({point:q,angle:Math.atan2(v[0],v[1]),width:.65,length:2,kind:'bench',siteKey:key,template:'pocket-common',source:'inferred-landscape',key:`${key}:bench:${side}`});
    }
  }
  for(const candidate of commonCandidates) {
    if(commonCount>=settings.maxCommons||sites.length>=settings.maxSites)break;
    try{designCommon(candidate);}catch{stats.rejectedGeometry++;}
  }
  const selectedTrees=balancedObjects(trees,settings.maxTrees),selectedProps=balancedObjects(props,settings.maxProps);
  stats.availableTreeCandidates=trees.length;stats.availablePropCandidates=props.length;
  trees.splice(0,trees.length,...selectedTrees);props.splice(0,props.length,...selectedProps);
  stats.treesByTemplate={};for(const tree of trees)stats.treesByTemplate[tree.template]=(stats.treesByTemplate[tree.template]||0)+1;
  stats.commonCandidates=commonCandidates.length;
  stats.inferredSites = sites.length; stats.treeCandidates = trees.length; stats.props = props.length;
  stats.surfaces = surfaces.length; stats.inferredArea = stats.inferredPavedArea + stats.inferredPlantedArea;
  stats.inferredFraction = stats.inferredArea / ((x1 - x0) * (z1 - z0));
  stats.knownGroundFraction = stats.observedSurfaceArea / ((x1 - x0) * (z1 - z0));
  // Report remaining unmodelled ground honestly. This bounded sampling is a
  // coverage diagnostic, never the geometry generator, and uses local cells
  // only for measurement. It includes buildings, water and all road surfaces.
  const sampleStep = Math.max(12, Math.sqrt((x1 - x0) * (z1 - z0) / 24000));
  let total = 0, blankBefore = 0, blankAfter = 0;
  const occupiedAt = (p, index) => index.query([p[0] - .001, p[1] - .001, p[0] + .001, p[1] + .001]).some(item => inPolygon(p, item.polygon));
  for (let x = x0 + sampleStep / 2; x < x1; x += sampleStep) for (let z = z0 + sampleStep / 2; z < z1; z += sampleStep) {
    const p = [x, z]; total++;
    if (occupiedAt(p, ground) || occupiedAt(p, knownOccupied)) continue;
    blankBefore++;
    if (!occupiedAt(p, occupied)) blankAfter++;
  }
  stats.unfilledBeforeFraction = total ? blankBefore / total : 0;
  stats.unfilledAfterFraction = total ? blankAfter / total : 0;
  stats.coverageSampleSpacing = sampleStep; stats.coverageSamples = total;
  return { surfaces, trees, props, sites, stats, profile: { ...settings, enabled: profile.enabled !== false } };
}




