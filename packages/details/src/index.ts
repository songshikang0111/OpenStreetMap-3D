// Optional decorations (01 section 4, 05 section 5 `details`): street furniture, parked cars, pedestrians, benches and
// inferred landscape surfaces. Placement and avoidance happen at build time with the phase-one rules
// (src/streetlife.js, src/landscape-plan.js); this package turns the planned `detail` and `landscape` layers into
// role batches at runtime. Shapes and colours follow phase-one buildStreetLife and buildLandscape.
import { ShapeUtils, Vector2 } from 'three';
import { readFeatureMetaAt } from '@city-ink/tiles';
import type { FeatureLayer } from '@city-ink/tiles';
import { hexToRgb, windQuad } from '@city-ink/generators';
import type { BatchBuilder, BatchSet } from '@city-ink/generators';

/** Package identity, used by diagnostics and tooling. */
export const PACKAGE_NAME = '@city-ink/details';

/** Detail kinds written by the builder (layer `detail`). */
export const DETAIL_KINDS = ['lamp', 'signal', 'crosswalk', 'curb', 'car', 'person', 'bench'] as const;

/** Tile ground lift of paved surfaces (generators LAYER_LIFT.ground); details stand on it. */
const GROUND_LIFT = 0.06;
const colorCache = new Map<string, number[]>();
const rgb = (hex: string) => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = hexToRgb(hex)));
  return c;
};

/** Box faces as [local normal, cyclic corner indices]; corner index bits: 1 = +x, 2 = +y, 4 = +z. */
const FACES: [number[], number[]][] = [
  [
    [1, 0, 0],
    [1, 3, 7, 5],
  ],
  [
    [-1, 0, 0],
    [0, 4, 6, 2],
  ],
  [
    [0, 1, 0],
    [2, 6, 7, 3],
  ],
  [
    [0, -1, 0],
    [0, 1, 5, 4],
  ],
  [
    [0, 0, 1],
    [4, 5, 7, 6],
  ],
  [
    [0, 0, -1],
    [0, 2, 3, 1],
  ],
];

/**
 * An oriented box: `angle` rotates about +y like Object3D.rotation.y; `grade` shears it to follow a sloped road
 * ([dy/dx, dy/dz] in world metres), as in phase-one surfaceTransform.
 */
function box(
  b: BatchBuilder,
  center: number[],
  size: number[],
  angle: number,
  color: number[],
  renderId: number,
  grade: number[] = [0, 0],
) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const corners: number[][] = [];
  for (let k = 0; k < 8; k++) {
    const lx = ((k & 1 ? 1 : -1) * size[0]!) / 2,
      ly = ((k & 2 ? 1 : -1) * size[1]!) / 2,
      lz = ((k & 4 ? 1 : -1) * size[2]!) / 2;
    const x = lx * c + lz * s,
      z = -lx * s + lz * c;
    corners.push([center[0]! + x, center[1]! + ly + grade[0]! * x + grade[1]! * z, center[2]! + z]);
  }
  for (const [n, quad] of FACES) {
    const normal = [n[0]! * c + n[2]! * s, n[1]!, -n[0]! * s + n[2]! * c];
    windQuad(
      b,
      quad.map((q) => corners[q]!),
      normal,
      color,
      renderId,
    );
  }
}

/** Generates the `detail` layer of a tile (furniture and people as `facility`, crossing paint as `road.marking`). */
export function generateDetails(layer: FeatureLayer, step: number, batches: BatchSet): number {
  const facility = batches.get('detail', 'facility', true);
  const paint = batches.get('detail', 'road.marking', true);
  const before = facility.vertexCount + paint.vertexCount;
  for (let i = 0; i < layer.featureCount; i++) {
    const p = readFeatureMetaAt(layer, i).properties ?? {};
    const v = layer.vertexStart[layer.ringStart[layer.partStart[i]!]!]!;
    const x = layer.positions[v * 2]! * step,
      z = layer.positions[v * 2 + 1]! * step;
    const a = Number(p.angle ?? 0),
      size = Number(p.size ?? 1),
      base = Number(p.y ?? 0) + GROUND_LIFT;
    const grade = [Number(p.gradeX ?? 0), Number(p.gradeZ ?? 0)];
    const rid = layer.renderId[i]!;
    const dx = Math.sin(a),
      dz = Math.cos(a);
    switch (p.kind) {
      case 'lamp': {
        const h = size;
        box(facility, [x, base + h / 2, z], [0.16, h, 0.16], 0, rgb('#718080'), rid);
        box(facility, [x + dx * 1.15, base + h - 0.25, z + dz * 1.15], [0.11, 0.11, 2.4], a, rgb('#718080'), rid);
        box(facility, [x + dx * 2.3, base + h, z + dz * 2.3], [0.38, 0.14, 0.85], a, rgb('#e0dfc8'), rid);
        break;
      }
      case 'signal':
        box(facility, [x, base + 1.6, z], [0.13, 3.2, 0.13], 0, rgb('#65716c'), rid);
        box(facility, [x, base + 3, z], [0.28, 0.82, 0.2], a, rgb('#303a36'), rid);
        box(facility, [x + dx * 0.105, base + 2.8, z + dz * 0.105], [0.16, 0.16, 0.025], a, rgb('#a6b47a'), rid);
        break;
      case 'crosswalk':
        for (let lateral = -size / 2 + 0.5; lateral < size / 2 - 0.2; lateral += 1.15) {
          const px = x + dz * lateral,
            pz = z - dx * lateral;
          const y = base + 0.02 + grade[0]! * (px - x) + grade[1]! * (pz - z);
          box(paint, [px, y, pz], [0.58, 0.012, 3.6], a, rgb('#f5f3e6'), rid, grade);
        }
        break;
      case 'curb':
        box(facility, [x, base + 0.08, z], [0.2, 0.23, size + 0.015], a, rgb('#d9d9ce'), rid, grade);
        break;
      case 'car': {
        const local = (ox: number, oy: number, oz: number) => [x + ox * dz + oz * dx, base + oy, z - ox * dx + oz * dz];
        box(facility, local(0, 0.67, 0), [1.75, 0.66, 4.2], a, rgb(String(p.color ?? '#bdc8c6')), rid);
        box(facility, local(0, 1.16, -0.2), [1.54, 0.52, 2.25], a, rgb('#485c61'), rid);
        for (let j = 0; j < 4; j++)
          box(
            facility,
            local(j % 2 ? 0.86 : -0.86, 0.28, j < 2 ? 1.24 : -1.24),
            [0.2, 0.56, 0.62],
            a,
            rgb('#454b47'),
            rid,
          );
        break;
      }
      case 'person': {
        const h = size;
        box(facility, [x, base + h * 0.57, z], [0.36, h * 0.39, 0.28], a, rgb('#797b70'), rid);
        box(facility, [x, base + h * 0.89, z], [0.26, 0.32, 0.26], a, rgb('#c3b19b'), rid);
        for (const side of [-1, 1])
          box(
            facility,
            [x + dz * 0.09 * side, base + h * 0.21, z - dx * 0.09 * side],
            [0.12, h * 0.42, 0.12],
            a,
            rgb('#56615e'),
            rid,
          );
        break;
      }
      case 'bench':
        box(facility, [x, base + 0.48, z], [0.65, 0.15, 2], a, rgb('#9a8b72'), rid);
        box(facility, [x, base + 0.25, z], [0.42, 0.4, 2], a, rgb('#9a8b72'), rid);
        break;
      default:
        break;
    }
  }
  return (facility.vertexCount + paint.vertexCount - before) / 2;
}

/** Phase-one landscape surface colours (src/landscape.js). */
const LANDSCAPE_COLORS: Record<string, string> = {
  paving: '#d2cdbf',
  plaza: '#c9c5b9',
  lawn: '#a6b789',
  park: '#a9b992',
  wood: '#8fa17e',
  garden: '#96aa7c',
  shrub: '#788e63',
  parking: '#929893',
  sport: '#9eaf9b',
  construction: '#c0b09a',
  soil: '#baaf94',
  marking: '#e9e6d7',
};
const GREEN_KINDS = /^(lawn|park|wood|garden|shrub|sport)$/;

/** Generates inferred landscape surfaces (layer `landscape`) as flat polygons just above observed greens. */
export function generateLandscape(layer: FeatureLayer, step: number, batches: BatchSet): number {
  let triangles = 0;
  for (let i = 0; i < layer.featureCount; i++) {
    const kind = String(readFeatureMetaAt(layer, i).properties?.kind ?? 'soil');
    const role = kind === 'marking' ? 'road.marking' : GREEN_KINDS.test(kind) ? 'ground.green' : 'ground.plaza';
    const batch = batches.get('landscape', role, true);
    const color = rgb(LANDSCAPE_COLORS[kind] ?? LANDSCAPE_COLORS.soil!);
    const y = kind === 'marking' ? 0.045 : kind === 'shrub' ? 0.05 : 0.03;
    const rid = layer.renderId[i]!;
    for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++) {
      const rings: Vector2[][] = [];
      for (let r = layer.ringStart[p]!; r < layer.ringStart[p + 1]!; r++) {
        const ring: Vector2[] = [];
        for (let v = layer.vertexStart[r]!; v < layer.vertexStart[r + 1]!; v++)
          ring.push(new Vector2(layer.positions[v * 2]! * step, layer.positions[v * 2 + 1]! * step));
        rings.push(ring);
      }
      if (!rings[0] || rings[0].length < 3) continue;
      const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const all = rings.flat();
      const base = batch.vertexCount;
      for (const pt of all) batch.vertex([pt.x, y, pt.y], [0, 1, 0], color, rid);
      for (const [a, b, c] of faces as [number, number, number][]) {
        const cross =
          (all[b]!.x - all[a]!.x) * (all[c]!.y - all[a]!.y) - (all[b]!.y - all[a]!.y) * (all[c]!.x - all[a]!.x);
        if (cross > 0) batch.triangle(base + a, base + c, base + b);
        else batch.triangle(base + a, base + b, base + c);
        triangles++;
      }
    }
  }
  return triangles;
}

/** Layer generators to pass to generateTile's `layerGenerators` (the map worker registers these). */
export const DETAIL_GENERATORS = { detail: generateDetails, landscape: generateLandscape };
