// Flat or graded polygons (water, green, ground), polyline bands (roads, structures) and massing prisms.
import { ShapeUtils, Vector2 } from 'three';
import { HEIGHT_STEPS_PER_METER } from '@city-ink/tiles';
import type { FeatureLayer } from '@city-ink/tiles';
import { BatchSet, hexToRgb } from './batch.js';
import { quad as windQuad } from './structures.js';
import { phase1Building } from './building.js';
import { buildingStyle } from '../../../src/building-rules.js';
import { facadeLayout } from '../../../src/facade-layout.js';
import { MeshWriter, normalizedRing, polygon } from '../../../src/generators/mesh-tools.js';

const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

/** Small vertical offsets that order coplanar layers without z-fighting (metres). */
export const LAYER_LIFT: Record<string, number> = { green: 0.02, water: 0.04, ground: 0.06, road: 0.08 };

/** Default per-kind colours; the style layer may recolour by role. */
const KIND_COLORS: Record<string, string> = {
  water: '#a9c8e6',
  park: '#cfe3c0',
  grass: '#cfe3c0',
  lawn: '#cfe3c0',
  wood: '#9cc48a',
  garden: '#cfe3c0',
  pavement: '#d7d6d2',
  sidewalk: '#dddcd7',
  plaza: '#e3e0d8',
  road: '#c9ccd1',
  drive: '#c9ccd1',
};

export function roleFor(layer: string, kind: string | null): string {
  if (layer === 'water') return 'water';
  if (layer === 'green') return 'ground.green';
  if (layer === 'ground')
    return kind === 'drive' || kind === 'road'
      ? 'road'
      : kind === 'marking'
        ? 'road.marking'
        : kind === 'plaza'
          ? 'ground.plaza'
          : 'ground.pavement';
  if (layer === 'road') return 'road';
  if (layer === 'structure') return 'structure';
  return layer;
}

function vertexHeight(layer: FeatureLayer, v: number): number {
  return layer.elevation ? layer.baseElevation + layer.elevation[v]! / HEIGHT_STEPS_PER_METER : 0;
}

/** Triangulates every polygon feature of a layer into one batch per role. */
export function generatePolygons(layer: FeatureLayer, name: string, step: number, batches: BatchSet): number {
  let triangles = 0;
  const lift = LAYER_LIFT[name] ?? 0;
  const kindColumn = layer.attributes.find((a) => a.name === 'kind');
  for (let i = 0; i < layer.featureCount; i++) {
    const kindIndex = kindColumn?.values[i];
    const kind = kindIndex !== undefined && kindIndex !== 0xffffffff ? layer.strings[kindIndex]! : null;
    const role = roleFor(name, kind);
    const color = hexToRgb(KIND_COLORS[kind ?? name] ?? KIND_COLORS[name] ?? '#d8d8d4');
    const batch = batches.get(name, role, true);
    const renderId = layer.renderId[i]!;
    for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++) {
      const rings: Vector2[][] = [];
      const heights: number[] = [];
      for (let r = layer.ringStart[p]!; r < layer.ringStart[p + 1]!; r++) {
        const ring: Vector2[] = [];
        for (let v = layer.vertexStart[r]!; v < layer.vertexStart[r + 1]!; v++) {
          ring.push(new Vector2(layer.positions[v * 2]! * step, layer.positions[v * 2 + 1]! * step));
          heights.push(vertexHeight(layer, v));
        }
        rings.push(ring);
      }
      if (!rings[0] || rings[0].length < 3) continue;
      const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const all = rings.flat();
      const base = batch.vertexCount;
      all.forEach((pt, k) => batch.vertex([pt.x, heights[k]! + lift, pt.y], UP, color, renderId));
      for (const face of faces) {
        const [a, b, c] = face as [number, number, number];
        // x east, z south: counter-clockwise when viewed from +y needs the (a, c, b) order for a clockwise 2D face.
        const ax = all[a]!,
          bx = all[b]!,
          cx = all[c]!;
        const cross = (bx.x - ax.x) * (cx.y - ax.y) - (bx.y - ax.y) * (cx.x - ax.x);
        if (cross > 0) batch.triangle(base + a, base + c, base + b);
        else batch.triangle(base + a, base + b, base + c);
        triangles++;
      }
    }
  }
  return triangles;
}

/** Extrudes polylines into bands of their `width` attribute (roads at L0, structure decks with thickness). */
export function generateBands(layer: FeatureLayer, name: string, step: number, batches: BatchSet): number {
  let triangles = 0;
  const width = layer.attributes.find((a) => a.name === 'width');
  const thickness = layer.attributes.find((a) => a.name === 'thickness');
  const role = roleFor(name, null);
  const batch = batches.get(name, role, true);
  const color = hexToRgb(name === 'structure' ? '#bdbdbd' : '#c9ccd1');
  const lift = LAYER_LIFT[name] ?? 0;
  for (let i = 0; i < layer.featureCount; i++) {
    const w = Math.max(0.5, Number(width?.values[i]) || 6) / 2;
    const t = name === 'structure' ? Math.max(0.2, Number(thickness?.values[i]) || 1) : 0;
    const renderId = layer.renderId[i]!;
    for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++)
      for (let r = layer.ringStart[p]!; r < layer.ringStart[p + 1]!; r++) {
        const a0 = layer.vertexStart[r]!;
        const a1 = layer.vertexStart[r + 1]!;
        for (let v = a0; v + 1 < a1; v++) {
          const x0 = layer.positions[v * 2]! * step,
            z0 = layer.positions[v * 2 + 1]! * step,
            x1 = layer.positions[v * 2 + 2]! * step,
            z1 = layer.positions[v * 2 + 3]! * step;
          const len = Math.hypot(x1 - x0, z1 - z0);
          if (len < 1e-3) continue;
          const nx = (-(z1 - z0) / len) * w,
            nz = ((x1 - x0) / len) * w;
          const y0 = vertexHeight(layer, v) + lift,
            y1 = vertexHeight(layer, v + 1) + lift;
          const top = [
            [x0 + nx, y0, z0 + nz],
            [x0 - nx, y0, z0 - nz],
            [x1 - nx, y1, z1 - nz],
            [x1 + nx, y1, z1 + nz],
          ];
          // Front faces must point along n: the top of a band previously faced down and was culled, which hid every
          // L0 road and the top of every deck.
          const quad = (pts: number[][], n: number[]) => {
            windQuad(batch, pts, n, color, renderId);
            triangles += 2;
          };
          quad(top, UP);
          if (t > 0) {
            const bottom = top.map(([x, y, z]) => [x!, y! - t, z!]);
            quad([bottom[3]!, bottom[2]!, bottom[1]!, bottom[0]!], DOWN);
            const side = (i0: number, i1: number) => {
              const dx = top[i1]![0]! - top[i0]![0]!,
                dz = top[i1]![2]! - top[i0]![2]!;
              const l = Math.hypot(dx, dz) || 1;
              quad([bottom[i0]!, bottom[i1]!, top[i1]!, top[i0]!], [dz / l, 0, -dx / l]);
            };
            side(0, 3);
            side(2, 1);
          }
        }
      }
  }
  return triangles;
}

/**
 * L0 massing: simple prisms from footprint polygons and their height attributes. Walls use the same phase-one style,
 * colour, facade attributes and material roles as the L1 building of the same id (buildingStyle is a pure function of
 * id, tags, height, levels and area, all kept at L0), so the two levels do not change colour at the L0/L1 seam and the
 * facade shader draws the same window grid on both.
 */
export function generateMassing(layer: FeatureLayer, name: string, step: number, batches: BatchSet, seed = 1): number {
  let triangles = 0;
  for (let i = 0; i < layer.featureCount; i++) {
    const building = phase1Building(layer, i, step);
    const top = building.height;
    const bottom = building.minHeight;
    if (!(top > bottom)) continue;
    const style = buildingStyle(building, seed);
    const renderId = layer.renderId[i]!;
    const writer = new MeshWriter();
    writer.style = style.code;
    writer.variant = style.variant as number;
    writer.surface = [style.surface as number, style.surfaceScale as number];
    const floor = style.floor;
    const rings = [normalizedRing(building.outer), ...building.holes.map((h) => normalizedRing(h, true))];
    for (const ring of rings)
      for (let v = 0; v < ring.length; v++) {
        const a = ring[v]!,
          b = ring[(v + 1) % ring.length]!;
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          len = Math.hypot(dx, dz);
        if (len < 0.03) continue;
        writer.layout = facadeLayout(len, top - bottom, style).attributes;
        writer.quad(
          [
            [a[0], bottom, a[1]],
            [b[0], bottom, b[1]],
            [b[0], top, b[1]],
            [a[0], top, a[1]],
          ],
          [dz / len, 0, -dx / len],
          style.color,
          renderId,
          [
            [0, 0, len, floor],
            [len, 0, len, floor],
            [len, top - bottom, len, floor],
            [0, top - bottom, len, floor],
          ],
        );
      }
    writer.style = 0;
    writer.materialRole = 'roof';
    polygon(writer, { outer: building.outer, holes: building.holes }, top, ROOF_COLOR, renderId);
    for (const run of writer.materialRuns) {
      batches.get(name, run.role).addWriterRun(writer, run.start, run.count, renderId, 0);
      triangles += run.count / 3;
    }
  }
  return triangles;
}

/** Flat roof colour of phase-one buildings without a supported roof shape (src/building-mesh.js). */
const ROOF_COLOR = '#e1e3dd';
