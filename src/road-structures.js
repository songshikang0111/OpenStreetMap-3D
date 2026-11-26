import * as THREE from 'three';
import { inside } from './osm.js';
import { roadHeightAt } from './road-grade.js';

// Structural illustrations inferred from OSM centre lines and relative layers.
// Heights follow the connected grade solution; none are surveyed dimensions.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at = (s, t, offset = 0) => [
  s.a[0] + s.direction[0] * t - s.direction[1] * offset,
  s.a[1] + s.direction[1] * t + s.direction[0] * offset,
];
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
const inBounds = (p, b, padding = 0) =>
  p[0] >= b[0] + padding && p[1] >= b[1] + padding && p[0] <= b[2] - padding && p[1] <= b[3] - padding;
// Shared with vegetation clearance; these match the generated slab and the
// top faces of the pedestrian handrail / vehicle parapet, in metres.
export const roadStructureDimensions = (s) => ({
  thickness: s.stairFlight ? 0.24 : s.walk ? 0.38 : Math.max(0.65, Math.min(1.1, s.width * 0.065)),
  railTop: s.walk ? 1.1125 : 0.825,
});
const thickness = (s) => roadStructureDimensions(s).thickness;
const crosses = (a, b, c, d) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    ex = d[0] - c[0],
    ez = d[1] - c[1],
    den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return false;
  const x = c[0] - a[0],
    z = c[1] - a[1],
    t = (x * ez - z * ex) / den,
    u = (x * dz - z * dx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};
function entersDeck(a, b, deck) {
  const box = deck.bounds;
  if (
    Math.max(a[0], b[0]) < box[0] ||
    Math.min(a[0], b[0]) > box[2] ||
    Math.max(a[1], b[1]) < box[1] ||
    Math.min(a[1], b[1]) > box[3]
  )
    return false;
  return (
    inside(a, deck.polygon) ||
    inside(b, deck.polygon) ||
    deck.polygon.some((c, i) => crosses(a, b, c, deck.polygon[(i + 1) % deck.polygon.length]))
  );
}

export function supportClearance(point, radius, top, data, segments) {
  for (const s of segments) {
    if (roadHeightAt(s, point) >= top - 0.15) continue;
    if (segmentDistance(point, s.a, s.b) < s.width / 2 + radius + 0.8)
      return s.walk ? 'pedestrian-clearance' : 'traffic-clearance';
  }
  for (const b of data.buildings || []) {
    if (b.minHeight >= top || b.height <= 0.32) continue;
    const rings = [b.outer, ...(b.holes || [])];
    if (inside(point, b.outer) && !(b.holes || []).some((h) => inside(point, h))) return 'building-clearance';
    if (rings.some((r) => r.some((a, i) => segmentDistance(point, a, r[(i + 1) % r.length]) < radius + 0.45)))
      return 'building-clearance';
  }
  if ((data.water || []).some((w) => inside(point, w.outer) && !(w.holes || []).some((h) => inside(point, h))))
    return 'water';
  return null;
}

/** Uniform grid over item bounding boxes; queries return items in their original order (results stay identical). */
class BoxGrid {
  constructor(items, boxOf, size = 64) {
    this.items = items;
    this.size = size;
    this.cells = new Map();
    items.forEach((item, i) => {
      const [x0, z0, x1, z1] = boxOf(item);
      for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++)
        for (let z = Math.floor(z0 / size); z <= Math.floor(z1 / size); z++) {
          const k = x * 1048576 + z;
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
    });
  }
  query(x0, z0, x1, z1) {
    const found = new Set();
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++)
      for (let z = Math.floor(z0 / this.size); z <= Math.floor(z1 / this.size); z++)
        for (const i of this.cells.get(x * 1048576 + z) || []) found.add(i);
    return [...found].sort((a, b) => a - b).map((i) => this.items[i]);
  }
}
const ringBox = (ring) => {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
};

export function planRoadStructures(data, roadPlan) {
  const b = data.bounds || [-1e8, -1e8, 1e8, 1e8],
    bridges = roadPlan.segments.filter(
      (s) => !s.stairFlight && (s.road.bridge || Math.max(s.yA ?? s.y, s.yB ?? s.y) > 0.65),
    );
  const deckSurfaces = roadPlan.surfaces.filter(
    (s) => !s.stairFlight && s.kind !== 'paving' && (s.bridge || Math.max(s.yA ?? s.y, s.yB ?? s.y) > 0.65),
  );
  // Spatial indexes: whole-city inputs have thousands of decks, segments and buildings (results are unchanged).
  const deckGrid = new BoxGrid(deckSurfaces, (d) => d.bounds);
  const segmentGrid = new BoxGrid(roadPlan.segments, (s) => [
    Math.min(s.a[0], s.b[0]),
    Math.min(s.a[1], s.b[1]),
    Math.max(s.a[0], s.b[0]),
    Math.max(s.a[1], s.b[1]),
  ]);
  const buildingGrid = new BoxGrid(data.buildings || [], (b) => ringBox(b.outer));
  const segmentsByRoad = new Map();
  for (const s of bridges) {
    if (!segmentsByRoad.has(s.road.id)) segmentsByRoad.set(s.road.id, []);
    segmentsByRoad.get(s.road.id).push(s);
  }
  const stats = {
    bridgeWays: segmentsByRoad.size,
    bridgeSegments: bridges.length,
    bridgeDecks: deckSurfaces.length,
    bridgePiers: 0,
    bridgeSupportCandidates: 0,
    bridgeGuardrailSegments: 0,
    bridgeRailInteriorSkipped: 0,
    bridgeRejectedSupports: {},
    unsupportedBridgeWays: 0,
    bridgeHeightSource: 'inferred-layer-times-7m',
    bridgeGradeConnectionsUnresolved: 0,
  };
  const reject = (reason) => (stats.bridgeRejectedSupports[reason] = (stats.bridgeRejectedSupports[reason] || 0) + 1);
  const decks = deckSurfaces.map((s) => {
    const seg = segmentsByRoad.get(s.roadId)[0];
    return { ...s, thickness: thickness(seg), source: 'inferred-deck-depth' };
  });
  const rails = [],
    piers = [],
    pierRoads = new Set();
  for (const s of bridges) {
    const step = s.walk ? 3 : 7,
      railWidth = s.walk ? 0.1 : 0.28;
    for (const side of [-1, 1])
      for (let start = 0; start < s.length - 0.1; start += step) {
        const end = Math.min(start + step, s.length),
          offset = side * (s.width / 2 - railWidth / 2 - 0.025);
        const a = at(s, start, offset),
          c = at(s, end, offset);
        if (!inBounds(a, b, 0.2) || !inBounds(c, b, 0.2)) continue;
        // Suppress barriers inside same-level junctions/overlapping bridge decks.
        const probeA = at(s, start + 0.01, side * (s.width / 2 + 0.12)),
          probeB = at(s, end - 0.01, side * (s.width / 2 + 0.12));
        const near = deckGrid.query(
          Math.min(probeA[0], probeB[0]) - 0.5,
          Math.min(probeA[1], probeB[1]) - 0.5,
          Math.max(probeA[0], probeB[0]) + 0.5,
          Math.max(probeA[1], probeB[1]) + 0.5,
        );
        const interior = near.some(
          (d) => Math.abs(roadHeightAt(d, probeA) - roadHeightAt(s, probeA)) < 0.12 && entersDeck(probeA, probeB, d),
        );
        if (interior) {
          stats.bridgeRailInteriorSkipped++;
          continue;
        }
        rails.push({
          a,
          b: c,
          y: s.y,
          yA: roadHeightAt(s, a),
          yB: roadHeightAt(s, c),
          width: railWidth,
          walk: s.walk,
          roadId: s.road.id,
          source: 'inferred-bridge-edge',
        });
      }
    const spacing = s.walk ? 22 : 36,
      first = spacing / 2 + Math.ceil((s.run - spacing / 2) / spacing) * spacing - s.run;
    for (let t = Math.max(1, first); t < s.length - 1; t += spacing) {
      const point = at(s, t),
        radius = s.walk ? 0.32 : Math.min(0.95, Math.max(0.55, s.width * 0.055)),
        deckY = roadHeightAt(s, point),
        top = deckY - thickness(s) - 0.35;
      if (top < 0.85) continue;
      stats.bridgeSupportCandidates++;
      const capRadius = Math.hypot(radius * 1.15, Math.max(radius * 2, Math.min(s.width * 0.7, 9)) / 2);
      if (!inBounds(point, b, capRadius + 0.2)) {
        reject('extract-boundary');
        continue;
      }
      if (piers.some((p) => dist(p.point, point) < Math.max(4, p.radius + radius + 1))) {
        reject('near-existing-support');
        continue;
      }
      // Candidates near the support only: segment half-widths are at most 25 m, clearances a few metres.
      const reach = 30 + capRadius;
      const nearSegments = segmentGrid.query(point[0] - reach, point[1] - reach, point[0] + reach, point[1] + reach);
      const nearBuildings = buildingGrid.query(
        point[0] - capRadius - 1,
        point[1] - capRadius - 1,
        point[0] + capRadius + 1,
        point[1] + capRadius + 1,
      );
      const blocked =
        supportClearance(point, radius, top, { buildings: nearBuildings, water: data.water }, nearSegments) ||
        supportClearance(
          point,
          capRadius,
          deckY - thickness(s),
          { buildings: nearBuildings.filter((b) => b.height > top), water: [] },
          nearSegments.filter((lower) => roadHeightAt(lower, point) + 4.8 > top),
        );
      if (blocked) {
        reject(blocked);
        continue;
      }
      if (!decks.some((d) => Math.abs(roadHeightAt(d, point) - deckY) < 0.01 && inside(point, d.polygon))) {
        reject('outside-deck');
        continue;
      }
      piers.push({
        point,
        radius,
        top,
        deckBottom: deckY - thickness(s),
        width: s.width,
        angle: Math.atan2(-s.direction[1], s.direction[0]),
        slope: (s.yB - s.yA) / s.length || 0,
        roadId: s.road.id,
        walk: s.walk,
        source: 'inferred-clearance-checked-support',
      });
      pierRoads.add(s.road.id);
    }
  }
  // Record actual endpoint continuity independently of nominal layer tags.
  const endpoints = new Map();
  for (const s of roadPlan.segments)
    for (const [p, key] of [
      [s.a, s.nodeA],
      [s.b, s.nodeB],
    ]) {
      if (!endpoints.has(key)) endpoints.set(key, new Set());
      endpoints.get(key).add(roadHeightAt(s, p).toFixed(5));
    }
  stats.bridgeGradeConnectionsUnresolved = [...endpoints.values()].filter((v) => v.size > 1).length;
  stats.bridgeGuardrailSegments = rails.length;
  stats.bridgePiers = piers.length;
  stats.unsupportedBridgeWays = [...segmentsByRoad.keys()].filter((id) => !pierRoads.has(id)).length;
  return { decks, rails, piers, stats };
}

const colorCache = new Map();
function cachedColor(value) {
  let c = colorCache.get(value);
  if (!c) colorCache.set(value, (c = new THREE.Color(value)));
  return c;
}

class StructureWriter {
  constructor(emitFace) {
    this.emitFace = emitFace;
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }
  triangle(a, b, c, color) {
    // Same arithmetic as Vector3 subVectors/cross/normalize, without per-triangle allocations.
    const abx = b[0] - a[0],
      aby = b[1] - a[1],
      abz = b[2] - a[2],
      acx = c[0] - a[0],
      acy = c[1] - a[1],
      acz = c[2] - a[2];
    let nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    const rgb = cachedColor(color);
    if (this.emitFace) {
      this.emitFace(a, b, c, nx, ny, nz, rgb);
      return;
    }
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(rgb.r, rgb.g, rgb.b);
    }
  }
  quad(a, b, c, d, color) {
    this.triangle(a, b, c, color);
    this.triangle(a, c, d, color);
  }
  box(center, size, angle, color, slope = 0) {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      p = ([x, y, z]) => [
        center[0] + (x * size[0] * c) / 2 + (z * size[2] * s) / 2,
        center[1] + (y * size[1]) / 2 + (x * size[0] * slope) / 2,
        center[2] - (x * size[0] * s) / 2 + (z * size[2] * c) / 2,
      ];
    const v = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map(p);
    for (const face of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
    ])
      this.quad(...face.map((i) => v[i]), color);
  }
  mesh(name, material, id) {
    const geometry = new THREE.BufferGeometry(),
      ids = [];
    for (let i = 0; i < this.positions.length / 3; i++)
      ids.push((id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255);
    for (const [key, array] of [
      ['position', this.positions],
      ['normal', this.normals],
      ['color', this.colors],
      ['objectId', ids],
    ])
      geometry.setAttribute(key, new THREE.Float32BufferAttribute(array, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.inkClass = 4;
    mesh.userData.roadStructure = true;
    mesh.userData.procedural = true;
    return mesh;
  }
}

/**
 * Writes deck sides and soffits, parapets and piers of a structure plan into plain position/normal/colour arrays.
 * Renderer-free: shared by the phase-one scene path below and the phase-two tile generators (piers, rails and decks
 * planned at build time, written in a Worker).
 */
export function writeRoadStructures(plan, emitFace) {
  const deckWriter = new StructureWriter(emitFace),
    railWriter = new StructureWriter(emitFace),
    pierWriter = new StructureWriter(emitFace);
  for (const d of plan.decks) {
    const top = (q) => roadHeightAt(d, q),
      bottom = (q) => Math.max(0.18, roadHeightAt(d, q) - d.thickness),
      p = d.polygon;
    for (let i = 1; i < p.length - 1; i++) {
      // The carriageway owns the deck top. A second cap 18 mm below it was
      // z-fighting at distance; keep only the structural sides and underside.
      deckWriter.triangle(
        [p[0][0], bottom(p[0]), p[0][1]],
        [p[i][0], bottom(p[i]), p[i][1]],
        [p[i + 1][0], bottom(p[i + 1]), p[i + 1][1]],
        '#969c97',
      );
    }
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        c = p[(i + 1) % p.length];
      deckWriter.quad(
        [a[0], bottom(a), a[1]],
        [a[0], top(a), a[1]],
        [c[0], top(c), c[1]],
        [c[0], bottom(c), c[1]],
        '#b8b8ac',
      );
    }
  }
  for (const r of plan.rails) {
    const length = dist(r.a, r.b),
      angle = Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]),
      center = [(r.a[0] + r.b[0]) / 2, 0, (r.a[1] + r.b[1]) / 2],
      y = (r.yA + r.yB) / 2,
      slope = (r.yB - r.yA) / length;
    if (r.walk) {
      for (const offset of [0.55, 1.08])
        railWriter.box([center[0], y + offset, center[2]], [length, 0.065, 0.065], angle, '#7d8986', slope);
      railWriter.box([r.a[0], r.yA + 0.55, r.a[1]], [0.065, 1.1, 0.065], angle, '#82908a');
      railWriter.box([center[0], y + 0.08, center[2]], [length, 0.16, 0.14], angle, '#c9c8b9', slope);
    } else {
      railWriter.box([center[0], y + 0.38, center[2]], [length, 0.76, r.width], angle, '#c4c5b8', slope);
      railWriter.box([center[0], y + 0.79, center[2]], [length, 0.07, r.width + 0.05], angle, '#d7d8ce', slope);
    }
  }
  for (const p of plan.piers) {
    const ground = 0.32,
      height = p.top - ground;
    pierWriter.box(
      [p.point[0], ground + height / 2, p.point[1]],
      [p.radius * 1.4, height, p.radius * 1.4],
      p.angle,
      '#b9b9aa',
    );
    pierWriter.box(
      [p.point[0], (p.top + p.deckBottom) / 2, p.point[1]],
      [p.radius * 2.3, p.deckBottom - p.top, Math.max(p.radius * 2, Math.min(p.width * 0.7, 9))],
      p.angle,
      '#bfc0b4',
      p.slope,
    );
  }
  return { deck: deckWriter, rail: railWriter, pier: pierWriter };
}

export function buildRoadStructures(data, roadPlan) {
  const plan = planRoadStructures(data, roadPlan),
    group = new THREE.Group();
  group.name = 'Inferred bridge decks, guards and clearance-checked supports';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  const { deck: deckWriter, rail: railWriter, pier: pierWriter } = writeRoadStructures(plan);
  for (const [writer, name, id] of [
    [deckWriter, 'Bridge deck thickness and soffits', 61001],
    [railWriter, 'Bridge parapets and pedestrian guardrails', 61002],
    [pierWriter, 'Inferred bridge piers outside lower routes', 61003],
  ])
    if (writer.positions.length) group.add(writer.mesh(name, material, id));
  plan.stats.bridgeStructureTriangles = group.children.reduce(
    (n, m) => n + m.geometry.attributes.position.count / 3,
    0,
  );
  return {
    group,
    plan,
    stats: plan.stats,
    dispose() {
      group.traverse((m) => m.geometry?.dispose());
      material.dispose();
    },
  };
}
