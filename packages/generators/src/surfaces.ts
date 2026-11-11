// Flat or graded polygons (water, green, ground), polyline bands (roads, structures) and massing prisms.
import { ShapeUtils, Vector2 } from 'three';
import { HEIGHT_STEPS_PER_METER, readFeatureMetaAt } from '@city-ink/tiles';
import type { FeatureLayer } from '@city-ink/tiles';
import { BatchSet, hexToRgb } from './batch.js';

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
    return kind === 'drive' || kind === 'road' ? 'road' : kind === 'plaza' ? 'ground.plaza' : 'ground.pavement';
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
          const quad = (pts: number[][], n: number[]) => {
            const b = batch.vertexCount;
            for (const q of pts) batch.vertex(q, n, color, renderId);
            batch.triangle(b, b + 1, b + 2);
            batch.triangle(b, b + 2, b + 3);
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

/** L0 massing: simple prisms (walls and flat roof) from footprint polygons and their height attributes. */
export function generateMassing(layer: FeatureLayer, name: string, step: number, batches: BatchSet): number {
  let triangles = 0;
  const wall = batches.get(name, 'wall', true);
  const roof = batches.get(name, 'roof', true);
  const wallColor = hexToRgb('#e9e6e1');
  const roofColor = hexToRgb('#d6d2cb');
  for (let i = 0; i < layer.featureCount; i++) {
    const props = readFeatureMetaAt(layer, i).properties ?? {};
    const top = Number(props.height ?? 3);
    const bottom = Number(props.minHeight ?? 0);
    const renderId = layer.renderId[i]!;
    for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++) {
      const rings: Vector2[][] = [];
      for (let r = layer.ringStart[p]!; r < layer.ringStart[p + 1]!; r++) {
        const ring: Vector2[] = [];
        for (let v = layer.vertexStart[r]!; v < layer.vertexStart[r + 1]!; v++)
          ring.push(new Vector2(layer.positions[v * 2]! * step, layer.positions[v * 2 + 1]! * step));
        rings.push(ring);
      }
      if (!rings[0] || rings[0].length < 3) continue;
      rings.forEach((ring, k) => {
        // outer ring walls face outward, holes inward
        const clockwise = ShapeUtils.isClockWise(ring);
        const ordered = clockwise === (k === 0) ? ring : [...ring].reverse();
        for (let v = 0; v < ordered.length; v++) {
          const a = ordered[v]!,
            b = ordered[(v + 1) % ordered.length]!;
          const dx = b.x - a.x,
            dz = b.y - a.y,
            l = Math.hypot(dx, dz);
          if (l < 1e-3) continue;
          const n = [-dz / l, 0, dx / l];
          const base = wall.vertexCount;
          wall.vertex([a.x, bottom, a.y], n, wallColor, renderId);
          wall.vertex([b.x, bottom, b.y], n, wallColor, renderId);
          wall.vertex([b.x, top, b.y], n, wallColor, renderId);
          wall.vertex([a.x, top, a.y], n, wallColor, renderId);
          wall.triangle(base, base + 2, base + 1);
          wall.triangle(base, base + 3, base + 2);
          triangles += 2;
        }
      });
      const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const all = rings.flat();
      const base = roof.vertexCount;
      for (const pt of all) roof.vertex([pt.x, top, pt.y], UP, roofColor, renderId);
      for (const face of faces) {
        const [a, b, c] = face as [number, number, number];
        const ax = all[a]!,
          bx = all[b]!,
          cx = all[c]!;
        const cross = (bx.x - ax.x) * (cx.y - ax.y) - (bx.y - ax.y) * (cx.x - ax.x);
        if (cross > 0) roof.triangle(base + a, base + c, base + b);
        else roof.triangle(base + a, base + b, base + c);
        triangles++;
      }
    }
  }
  return triangles;
}
