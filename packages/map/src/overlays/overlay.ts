// GeoJSON and custom overlay layers (04 section 7.2). Geometry is built in metres relative to the layer origin and
// placed through a Mercator-scaled anchor, so it stays correct across floating-origin resets (AC505).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import type { Object3D } from 'three';
import { lngLatToMercator, metersPerMercatorUnit } from '@city-ink/tiles';
import type { LngLat } from '@city-ink/tiles';
import type { OverlayLayer } from '../types.js';
import { FeatureStateTexture, patchFeatureState } from '../picking/feature-state.js';

export interface OverlayFeature {
  id: string;
  properties: Record<string, unknown>;
  lngLat: LngLat;
}

export interface BuiltOverlay {
  id: string;
  type: OverlayLayer['type'];
  group: Group;
  origin: LngLat;
  /** Metres per Mercator unit at the origin latitude: the anchor scales by anchorScale / originScale. */
  originScale: number;
  features: OverlayFeature[];
  state: FeatureStateTexture;
  pickMeshes: Mesh[];
  /** Per-frame uniforms (resolution in drawing-buffer pixels). */
  update(resolution: Vector2, pixelRatio: number): void;
  dispose(): void;
}

interface GeoFeature {
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

const OVERLAY_ERROR = (message: string) =>
  Object.assign(new Error(message), { code: 'OVERLAY_DATA_INVALID', stage: 'overlay' });

/** Normalises FeatureCollection / Feature / bare geometry into features with ids. */
export function readGeoJSON(data: unknown): GeoFeature[] {
  const d = data as {
    type?: string;
    features?: unknown[];
    geometry?: unknown;
    properties?: unknown;
    id?: unknown;
    coordinates?: unknown;
  };
  if (!d || typeof d !== 'object') throw OVERLAY_ERROR('Overlay data must be GeoJSON.');
  const list =
    d.type === 'FeatureCollection'
      ? (d.features ?? [])
      : d.type === 'Feature'
        ? [d]
        : [{ type: 'Feature', geometry: d, properties: {} }];
  return list.map((f, i) => {
    const feature = f as {
      id?: unknown;
      properties?: Record<string, unknown> | null;
      geometry?: { type: string; coordinates: unknown };
    };
    if (!feature.geometry?.type) throw OVERLAY_ERROR(`Feature ${i} has no geometry.`);
    return {
      id: feature.id !== undefined ? String(feature.id) : String(i),
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    };
  });
}

function lines(g: GeoFeature['geometry']): LngLat[][] {
  if (g.type === 'LineString') return [g.coordinates as LngLat[]];
  if (g.type === 'MultiLineString') return g.coordinates as LngLat[][];
  if (g.type === 'Polygon') return g.coordinates as LngLat[][];
  if (g.type === 'MultiPolygon') return (g.coordinates as LngLat[][][]).flat();
  return [];
}

function polygons(g: GeoFeature['geometry']): LngLat[][][] {
  if (g.type === 'Polygon') return [g.coordinates as LngLat[][]];
  if (g.type === 'MultiPolygon') return g.coordinates as LngLat[][][];
  return [];
}

function points(g: GeoFeature['geometry']): LngLat[] {
  if (g.type === 'Point') return [g.coordinates as LngLat];
  if (g.type === 'MultiPoint') return g.coordinates as LngLat[];
  return [];
}

function firstCoordinate(features: GeoFeature[]): LngLat {
  for (const f of features) {
    const c = [...points(f.geometry), ...lines(f.geometry).flat()][0];
    if (c) return [c[0], c[1]];
  }
  throw OVERLAY_ERROR('Overlay data has no coordinates.');
}

class Local {
  readonly m0: [number, number];
  readonly scale: number;
  constructor(readonly origin: LngLat) {
    this.m0 = lngLatToMercator(origin);
    this.scale = metersPerMercatorUnit(origin[1]);
  }
  xz(p: LngLat): [number, number] {
    const [mx, my] = lngLatToMercator(p);
    return [(mx - this.m0[0]) * this.scale, (my - this.m0[1]) * this.scale];
  }
}

// ----------------------------------------------------------------------------------------------- line

const LINE_VERTEX = /* glsl */ `
attribute vec3 other;
attribute float side;
attribute float dirSign;
uniform vec2 resolution;
uniform float lineWidth;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
  vec2 sa = a.xy / a.w * resolution * 0.5;
  vec2 sb = b.xy / b.w * resolution * 0.5;
  vec2 dir = normalize((sb - sa) * dirSign + vec2(1e-9));
  vec2 normal = vec2(-dir.y, dir.x);
  a.xy += normal * side * lineWidth * 0.5 / (resolution * 0.5) * a.w;
  gl_Position = a;
}`;

const FLAT_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
void main() { gl_FragColor = vec4(color, opacity); }`;

function lineMaterial(paint: { color: string; width: number; opacity?: number }) {
  return new ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: FLAT_FRAGMENT,
    uniforms: {
      resolution: { value: new Vector2(1, 1) },
      lineWidth: { value: paint.width },
      color: { value: new Color(paint.color) },
      opacity: { value: paint.opacity ?? 1 },
    },
    transparent: (paint.opacity ?? 1) < 1,
    side: DoubleSide,
    depthWrite: (paint.opacity ?? 1) >= 1,
  });
}

function buildLine(features: GeoFeature[], local: Local, altitude: number) {
  let segments = 0;
  for (const f of features) for (const l of lines(f.geometry)) segments += Math.max(0, l.length - 1);
  const position = new Float32Array(segments * 4 * 3);
  const other = new Float32Array(segments * 4 * 3);
  const side = new Float32Array(segments * 4);
  const dirSign = new Float32Array(segments * 4);
  const renderId = new Float32Array(segments * 4);
  const index = new Uint32Array(segments * 6);
  let v = 0,
    k = 0;
  features.forEach((f, fi) => {
    for (const l of lines(f.geometry)) {
      const pts = l.map((p) => local.xz(p));
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i]!;
        const [bx, bz] = pts[i + 1]!;
        const quad: [number, number, number, number, number, number, number, number][] = [
          [ax, az, bx, bz, -1, 1, 0, 0],
          [ax, az, bx, bz, 1, 1, 0, 0],
          [bx, bz, ax, az, -1, -1, 0, 0],
          [bx, bz, ax, az, 1, -1, 0, 0],
        ];
        for (const [px, pz, ox, oz, s, d] of quad) {
          position.set([px, altitude, pz], v * 3);
          other.set([ox, altitude, oz], v * 3);
          side[v] = s;
          dirSign[v] = d;
          renderId[v] = fi + 1;
          v++;
        }
        const b = v - 4;
        index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], k);
        k += 6;
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('other', new BufferAttribute(other, 3));
  g.setAttribute('side', new BufferAttribute(side, 1));
  g.setAttribute('dirSign', new BufferAttribute(dirSign, 1));
  g.setAttribute('renderId', new BufferAttribute(renderId, 1));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

// ----------------------------------------------------------------------------------------------- polygons

function buildPolygons(
  features: GeoFeature[],
  local: Local,
  heightOf: (f: GeoFeature) => { base: number; top: number },
  walls: boolean,
) {
  const position: number[] = [];
  const normal: number[] = [];
  const renderId: number[] = [];
  const push = (p: number[], n: number[], id: number) => {
    position.push(...p);
    normal.push(...n);
    renderId.push(id);
  };
  features.forEach((f, fi) => {
    const id = fi + 1;
    const { base, top } = heightOf(f);
    for (const poly of polygons(f.geometry)) {
      const rings = poly.map((ring) => {
        const pts = ring.map((p) => local.xz(p)).map(([x, z]) => new Vector2(x, z));
        if (pts.length > 1 && pts[0]!.equals(pts.at(-1)!)) pts.pop();
        return pts;
      });
      if (!rings[0] || rings[0].length < 3) continue;
      const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const all = rings.flat();
      for (const face of faces) {
        const [a, b, c] = face.map((i) => all[i]!);
        const cross = (b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x);
        const tri = cross > 0 ? [a!, c!, b!] : [a!, b!, c!];
        for (const p of tri) push([p.x, top, p.y], [0, 1, 0], id);
      }
      if (!walls) continue;
      for (const [k, ring] of rings.entries()) {
        const ordered = ShapeUtils.isClockWise(ring) === (k === 0) ? ring : [...ring].reverse();
        for (let i = 0; i < ordered.length; i++) {
          const p = ordered[i]!,
            q = ordered[(i + 1) % ordered.length]!;
          const dx = q.x - p.x,
            dz = q.y - p.y,
            l = Math.hypot(dx, dz) || 1;
          const n = [-dz / l, 0, dx / l];
          const quad = [
            [p.x, base, p.y],
            [q.x, base, q.y],
            [q.x, top, q.y],
            [p.x, top, p.y],
          ];
          for (const ix of [0, 2, 1, 0, 3, 2]) push(quad[ix]!, n, id);
        }
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('renderId', new BufferAttribute(new Float32Array(renderId), 1));
  g.computeBoundingSphere();
  return g;
}

// ----------------------------------------------------------------------------------------------- circles

const CIRCLE_VERTEX = /* glsl */ `
attribute float instanceRenderId;
uniform vec2 resolution;
uniform float radius;
varying vec2 vCorner;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vCorner = position.xy * 2.0;
  c.xy += position.xy * 2.0 * radius / (resolution * 0.5) * c.w;
  gl_Position = c;
}`;

const CIRCLE_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
varying vec2 vCorner;
void main() { if (dot(vCorner, vCorner) > 1.0) discard; gl_FragColor = vec4(color, opacity); }`;

/** Picking variant of a screen-space overlay shader: same vertex expansion, id-encoding fragment. */
function pickVariant(
  vertex: string,
  idAttribute: 'renderId' | 'instanceRenderId',
  uniforms: ShaderMaterial['uniforms'],
) {
  const declared = idAttribute === 'renderId' ? 'attribute float renderId;\n' : '';
  return new ShaderMaterial({
    vertexShader: `${declared}varying float vId;\n${vertex.replace('void main() {', `void main() {\n  vId = ${idAttribute};`)}`,
    fragmentShader: `uniform float slot;\nvarying float vId;\nvoid main() {\n  int id = int(vId + 0.5);\n  gl_FragColor = vec4(float(id % 256), float((id / 256) % 256), float((id / 65536) % 256), slot) / 255.0;\n}`,
    // The pick pass zooms the projection to one pixel, so pixel sizes are expressed against a 1×1 viewport.
    uniforms: { ...uniforms, resolution: { value: new Vector2(1, 1) }, slot: { value: 0 } },
    side: DoubleSide,
  });
}

// ----------------------------------------------------------------------------------------------- build

export function buildOverlay(layer: OverlayLayer): BuiltOverlay {
  const group = new Group();
  group.name = `overlay:${layer.id}`;
  const disposables: { dispose(): void }[] = [];
  const pickMeshes: Mesh[] = [];
  const uniformsWithResolution: {
    resolution: { value: Vector2 };
    scale?: { value: number };
    px?: number;
    key: 'lineWidth' | 'radius';
  }[] = [];

  if (layer.type === 'custom') {
    const state = new FeatureStateTexture(1);
    group.add(layer.object as Object3D);
    (layer.object as Object3D).traverse((o) => {
      if ((o as Mesh).isMesh) pickMeshes.push(o as Mesh);
    });
    return {
      id: layer.id,
      type: 'custom',
      group,
      origin: layer.lngLat,
      originScale: 0, // custom objects are authored in metres: no Mercator rescaling
      features: [{ id: layer.id, properties: {}, lngLat: layer.lngLat }],
      state,
      pickMeshes,
      update() {},
      dispose() {
        group.remove(layer.object as Object3D);
        state.dispose();
      },
    };
  }

  const features = readGeoJSON(layer.data);
  const origin = firstCoordinate(features);
  const local = new Local(origin);
  const state = new FeatureStateTexture(features.length + 1);
  const overlayFeatures: OverlayFeature[] = features.map((f) => {
    const c = [...points(f.geometry), ...lines(f.geometry).flat()][0] ?? origin;
    return { id: f.id, properties: f.properties, lngLat: [c[0], c[1]] };
  });
  const add = (mesh: Mesh) => {
    mesh.userData.overlay = layer.id;
    group.add(mesh);
    pickMeshes.push(mesh);
    disposables.push(mesh.geometry, mesh.material as ShaderMaterial);
  };

  if (layer.type === 'line') {
    const material = lineMaterial(layer.paint);
    const mesh = new Mesh(buildLine(features, local, layer.altitude ?? 0.5), material);
    mesh.userData.pickMaterial = pickVariant(LINE_VERTEX, 'renderId', material.uniforms);
    disposables.push(mesh.userData.pickMaterial as ShaderMaterial);
    add(mesh);
    uniformsWithResolution.push({
      resolution: material.uniforms.resolution as { value: Vector2 },
      px: layer.paint.width,
      key: 'lineWidth',
    });
    (group.children[0] as Mesh).userData.widthUniform = material.uniforms.lineWidth;
  } else if (layer.type === 'fill') {
    const material = new MeshStandardMaterial({
      color: layer.paint.color,
      transparent: (layer.paint.opacity ?? 1) < 1,
      opacity: layer.paint.opacity ?? 1,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: (layer.paint.opacity ?? 1) >= 1,
    });
    patchFeatureState(material, state.texture);
    const alt = layer.altitude ?? 0.3;
    add(
      new Mesh(
        buildPolygons(features, local, () => ({ base: alt, top: alt }), false),
        material,
      ),
    );
  } else if (layer.type === 'extrusion') {
    const paint = layer.paint;
    const value = (f: GeoFeature, v: number | string | undefined, fallback: number) =>
      typeof v === 'number' ? v : typeof v === 'string' ? Number(f.properties[v] ?? fallback) || fallback : fallback;
    const material = new MeshStandardMaterial({
      color: paint.color,
      transparent: (paint.opacity ?? 1) < 1,
      opacity: paint.opacity ?? 1,
      roughness: 0.8,
    });
    patchFeatureState(material, state.texture);
    add(
      new Mesh(
        buildPolygons(
          features,
          local,
          (f) => ({ base: value(f, paint.base, 0), top: value(f, paint.height, 10) }),
          true,
        ),
        material,
      ),
    );
  } else if (layer.type === 'circle') {
    const pts: { p: [number, number]; id: number }[] = [];
    features.forEach((f, fi) => points(f.geometry).forEach((p) => pts.push({ p: local.xz(p), id: fi + 1 })));
    const material = new ShaderMaterial({
      vertexShader: CIRCLE_VERTEX,
      fragmentShader: CIRCLE_FRAGMENT,
      uniforms: {
        resolution: { value: new Vector2(1, 1) },
        radius: { value: layer.paint.radius },
        color: { value: new Color(layer.paint.color) },
        opacity: { value: 1 },
      },
      depthTest: true,
    });
    const quad = new PlaneGeometry(1, 1);
    const mesh = new InstancedMesh(quad, material, Math.max(1, pts.length));
    mesh.count = pts.length;
    const ids = new Float32Array(Math.max(1, pts.length));
    const m = new Matrix4();
    pts.forEach(({ p, id }, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(p[0], 1, p[1]));
      ids[i] = id;
    });
    quad.setAttribute('instanceRenderId', new InstancedBufferAttribute(ids, 1));
    mesh.frustumCulled = false;
    mesh.userData.pickMaterial = pickVariant(CIRCLE_VERTEX, 'instanceRenderId', material.uniforms);
    disposables.push(mesh.userData.pickMaterial as ShaderMaterial);
    add(mesh);
    uniformsWithResolution.push({
      resolution: material.uniforms.resolution as { value: Vector2 },
      px: layer.paint.radius,
      key: 'radius',
    });
    mesh.userData.widthUniform = material.uniforms.radius;
  } else
    throw Object.assign(new Error(`Unknown overlay type ${(layer as { type: string }).type}.`), {
      code: 'OVERLAY_TYPE_UNKNOWN',
    });

  return {
    id: layer.id,
    type: layer.type,
    group,
    origin,
    originScale: local.scale,
    features: overlayFeatures,
    state,
    pickMeshes,
    update(resolution: Vector2, pixelRatio: number) {
      for (const u of uniformsWithResolution) u.resolution.value.copy(resolution);
      for (const mesh of pickMeshes) {
        const w = mesh.userData.widthUniform as { value: number } | undefined;
        const base = layer.type === 'line' ? layer.paint.width : layer.type === 'circle' ? layer.paint.radius : 0;
        if (w) w.value = base * pixelRatio;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      state.dispose();
      group.clear();
    },
  };
}
