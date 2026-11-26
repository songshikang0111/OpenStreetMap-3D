import * as THREE from 'three';

// Parsed colours by CSS string or hex number; THREE.Color parsing is deterministic, so caching keeps values identical.
const colorCache = new Map();
function parsedColor(value) {
  let color = colorCache.get(value);
  if (!color) {
    color = new THREE.Color(value);
    if (colorCache.size < 4096) colorCache.set(value, color);
  }
  return color;
}

export class MeshWriter {
  constructor() {
    this.materialRuns = [];
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.facades = [];
    this.ids = [];
    this.styles = [];
    this.style = 0;
    this.variant = 0;
    this.layouts = [];
    this.layout = [0, 0, 0, 0];
    this.surfaces = [];
    this.surface = [0, 1];
  }
  get positionLength() {
    return this.positions.length;
  }
  triangle(a, b, c, normal, color, id = 0, uv = null) {
    // Same arithmetic as Vector3.subVectors/cross/dot, without per-triangle allocations.
    const abx = b[0] - a[0],
      aby = b[1] - a[1],
      abz = b[2] - a[2],
      acx = c[0] - a[0],
      acy = c[1] - a[1],
      acz = c[2] - a[2];
    const cx = aby * acz - abz * acy,
      cy = abz * acx - abx * acz,
      cz = abx * acy - aby * acx;
    if (cx * normal[0] + cy * normal[1] + cz * normal[2] < 0) {
      [b, c] = [c, b];
      if (uv) uv = [uv[0], uv[2], uv[1]];
    }
    const role =
      this.materialRole ||
      (this.style > 0 ? ([1, 5, 6].includes(this.style) ? 'glass' : 'wall') : normal[1] > 0.7 ? 'roof' : 'structure');
    const col = color.isColor ? color : parsedColor(color);
    this.writeFace(a, b, c, normal, col, id, uv, role);
  }
  /** Final oriented triangle. Tile writers override the storage step, sharing all geometry rules and winding. */
  writeFace(a, b, c, normal, col, id, uv, role) {
    const run = this.materialRuns.at(-1);
    if (run?.role === role) run.count += 3;
    else this.materialRuns.push({ start: this.positions.length / 3, count: 3, role });
    const c0 = (id & 255) / 255,
      c1 = ((id >> 8) & 255) / 255,
      c2 = ((id >> 16) & 255) / 255;
    const layout = this.layout,
      surface = this.surface;
    for (let i = 0; i < 3; i++) {
      const p = i === 0 ? a : i === 1 ? b : c;
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(col.r, col.g, col.b);
      this.ids.push(c0, c1, c2);
      if (uv) this.facades.push(uv[i][0], uv[i][1], uv[i][2], uv[i][3]);
      else this.facades.push(0, 0, 0, 0);
      this.styles.push(this.style, this.variant);
      this.layouts.push(layout[0], layout[1], layout[2], layout[3]);
      this.surfaces.push(surface[0], surface[1]);
    }
  }
  quad(points, normal, color, id = 0, uv = null) {
    this.triangle(points[0], points[1], points[2], normal, color, id, uv && [uv[0], uv[1], uv[2]]);
    this.triangle(points[0], points[2], points[3], normal, color, id, uv && [uv[0], uv[2], uv[3]]);
  }
  geometry({ groupRoles = false } = {}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facades, 4));
    geo.setAttribute('objectId', new THREE.Float32BufferAttribute(this.ids, 3));
    geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 2));
    geo.setAttribute('aLayout', new THREE.Float32BufferAttribute(this.layouts, 4));
    geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surfaces, 2));
    geo.userData.city = {
      schemaVersion: 1,
      shaderAttributes: ['aFacade', 'aStyle', 'aLayout', 'aSurface', 'objectId'],
    };
    if (groupRoles) {
      const roles = [...new Set(this.materialRuns.map((r) => r.role))];
      let cursor = 0;
      const order = [];
      for (const role of roles) {
        const start = cursor;
        for (const run of this.materialRuns)
          if (run.role === role)
            for (let v = run.start; v < run.start + run.count; v++) {
              order.push(v);
              cursor++;
            }
        geo.addGroup(start, cursor - start, roles.indexOf(role));
      }
      for (const attr of Object.values(geo.attributes)) {
        const sorted = new Float32Array(attr.array.length);
        for (let v = 0; v < order.length; v++)
          for (let k = 0; k < attr.itemSize; k++)
            sorted[v * attr.itemSize + k] = attr.array[order[v] * attr.itemSize + k];
        attr.array = sorted;
      }
      geo.userData.city.materialRoles = roles;
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
  mesh(material, name, options) {
    const mesh = new THREE.Mesh(this.geometry(options), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
}

export function normalizedRing(ring, clockwise = false) {
  const points = ring.map((p) => new THREE.Vector2(...p));
  if (THREE.ShapeUtils.isClockWise(points) !== clockwise) points.reverse();
  return points.map((p) => p.toArray());
}

export function polygon(writer, feature, y, color, id = 0, normal = [0, 1, 0]) {
  const outer = feature.outer.map((p) => new THREE.Vector2(...p));
  const holes = (feature.holes || []).map((h) => h.map((p) => new THREE.Vector2(...p)));
  // triangulateShape removes repeated closing vertices in-place. Build its
  // index lookup afterwards, including for closed boolean-clipping results.
  const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = [...outer, ...holes.flat()];
  for (const t of triangles) writer.triangle(...t.map((i) => [all[i].x, y, all[i].y]), normal, color, id);
}

const BOX_CORNERS = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];
// Four corner indices, the outward normal axis and its sign.
const BOX_FACES = [
  [0, 1, 2, 3, 2, -1],
  [4, 7, 6, 5, 2, 1],
  [0, 4, 5, 1, 1, -1],
  [3, 2, 6, 7, 1, 1],
  [0, 3, 7, 4, 0, -1],
  [1, 5, 6, 2, 0, 1],
];

function orientedBox(writer, center, axes, dimensions, color, id = 0) {
  const old = writer.style,
    oldRole = writer.materialRole;
  writer.style = 0;
  writer.materialRole = 'structure';
  const halfAxes = axes.map((axis, i) => axis.map((component) => (component * dimensions[i]) / 2));
  const points = BOX_CORNERS.map(([sx, sy, sz]) => [
    center[0] + sx * halfAxes[0][0] + sy * halfAxes[1][0] + sz * halfAxes[2][0],
    center[1] + sx * halfAxes[0][1] + sy * halfAxes[1][1] + sz * halfAxes[2][1],
    center[2] + sx * halfAxes[0][2] + sy * halfAxes[1][2] + sz * halfAxes[2][2],
  ]);
  for (const [a, b, c, d, axis, sign] of BOX_FACES) {
    const n = axes[axis],
      normal = [n[0] * sign, n[1] * sign, n[2] * sign];
    writer.triangle(points[a], points[b], points[c], normal, color, id);
    writer.triangle(points[a], points[c], points[d], normal, color, id);
  }
  writer.style = old;
  writer.materialRole = oldRole;
}
export function addBox(writer, center, dimensions, color, id = 0, angle = 0) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  orientedBox(
    writer,
    center,
    [
      [c, 0, -s],
      [0, 1, 0],
      [s, 0, c],
    ],
    dimensions,
    color,
    id,
  );
}
export function addBeam(writer, a, b, width, color, id = 0) {
  const y = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)),
    length = y.length();
  if (length < 0.001) return;
  y.normalize();
  const ref = Math.abs(y.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0),
    x = new THREE.Vector3().crossVectors(y, ref).normalize(),
    z = new THREE.Vector3().crossVectors(x, y).normalize();
  orientedBox(
    writer,
    a.map((v, i) => (v + b[i]) / 2),
    [x.toArray(), y.toArray(), z.toArray()],
    [width, length, width],
    color,
    id,
  );
}
