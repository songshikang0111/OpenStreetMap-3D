// Bridge decks, parapets, piers and stair flights from the `structure` layer (WP-C task C4). Parapet, pier and stair
// meshes are written by the phase-one modules (src/road-structures.js, src/road-stairs.js) so both paths share one
// implementation (decision E4); positions are converted between the phase-one 0.45 m slab and the tile ground.
import { HEIGHT_STEPS_PER_METER, readFeatureMetaAt } from '@city-ink/tiles';
import type { FeatureLayer } from '@city-ink/tiles';
import { writeRoadStructures } from '../../../src/road-structures.js';
import type { BridgePier, BridgeRail, PlainWriter } from '../../../src/road-structures.js';
import { writeRoadStairs } from '../../../src/road-stairs.js';
import type { StairFlight } from '../../../src/road-stairs.js';
import type { Point2 } from '../../../src/phase1-types.js';
import { BatchSet, hexToRgb } from './batch.js';
import type { BatchBuilder } from './batch.js';

const GROUND = 0.45;
const UP = [0, 1, 0];
const DOWN = [0, -1, 0];
const DECK_COLOR = hexToRgb('#b8b8ac');

interface Line {
  points: Point2[];
  heights: number[];
}

function lines(layer: FeatureLayer, i: number, step: number): Line[] {
  const out: Line[] = [];
  for (let p = layer.partStart[i]!; p < layer.partStart[i + 1]!; p++)
    for (let r = layer.ringStart[p]!; r < layer.ringStart[p + 1]!; r++) {
      const points: Point2[] = [];
      const heights: number[] = [];
      for (let v = layer.vertexStart[r]!; v < layer.vertexStart[r + 1]!; v++) {
        points.push([layer.positions[v * 2]! * step, layer.positions[v * 2 + 1]! * step]);
        heights.push(layer.elevation ? layer.baseElevation + layer.elevation[v]! / HEIGHT_STEPS_PER_METER : 0);
      }
      out.push({ points, heights });
    }
  return out;
}

/** Copies a phase-one plain writer into an indexed batch, moving it from the 0.45 m slab down to the tile ground. */
function appendPlain(batch: BatchBuilder, w: PlainWriter, renderId: number): number {
  const base = batch.vertexCount;
  const n = w.positions.length / 3;
  const p = [0, 0, 0],
    nn = [0, 0, 0],
    c = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const o = v * 3;
    p[0] = w.positions[o]!;
    p[1] = w.positions[o + 1]! - GROUND;
    p[2] = w.positions[o + 2]!;
    nn[0] = w.normals[o]!;
    nn[1] = w.normals[o + 1]!;
    nn[2] = w.normals[o + 2]!;
    c[0] = w.colors[o]!;
    c[1] = w.colors[o + 1]!;
    c[2] = w.colors[o + 2]!;
    batch.vertex(p, nn, c, renderId);
  }
  for (let v = 0; v < n; v += 3) batch.triangle(base + v, base + v + 1, base + v + 2);
  return n / 3;
}

/**
 * Joins consecutive parapet pieces that continue in the same direction and slope into one run, so a straight
 * parapet is one box instead of one per 3-7 m piece (same silhouette, far fewer triangles). Pedestrian handrails keep
 * a post at the start of every original piece.
 */
function mergeRails(rails: BridgeRail[]): { runs: BridgeRail[]; posts: BridgeRail[] } {
  const runs: BridgeRail[] = [];
  const posts: BridgeRail[] = [];
  for (const r of rails) {
    const last = runs.at(-1);
    if (last) {
      const lx = last.b[0] - last.a[0],
        lz = last.b[1] - last.a[1],
        rx = r.b[0] - r.a[0],
        rz = r.b[1] - r.a[1];
      const ll = Math.hypot(lx, lz),
        rl = Math.hypot(rx, rz);
      const joined = Math.hypot(r.a[0] - last.b[0], r.a[1] - last.b[1]) < 0.02 && Math.abs(r.yA - last.yB) < 0.02;
      const straight = ll > 0 && rl > 0 && Math.abs((lx * rz - lz * rx) / (ll * rl)) < 0.02 && lx * rx + lz * rz > 0;
      const sameSlope = Math.abs((last.yB - last.yA) / ll - (r.yB - r.yA) / rl) < 0.01;
      if (joined && straight && sameSlope) {
        last.b = r.b;
        last.yB = r.yB;
        last.y = (last.yA + last.yB) / 2;
        if (r.walk) posts.push(r);
        continue;
      }
    }
    runs.push({ ...r, a: [...r.a] as Point2, b: [...r.b] as Point2 });
  }
  return { runs, posts };
}

const POST_COLOR = hexToRgb('#82908a');

/** Quad with the winding chosen so that its front face points along `n` (back faces are culled). */
export function quad(batch: BatchBuilder, pts: number[][], n: number[], color: number[], renderId: number) {
  const b = batch.vertexCount;
  for (const q of pts) batch.vertex(q, n, color, renderId);
  const [a, c, d] = [pts[0]!, pts[1]!, pts[2]!];
  const ux = c[0]! - a[0]!,
    uy = c[1]! - a[1]!,
    uz = c[2]! - a[2]!,
    vx = d[0]! - a[0]!,
    vy = d[1]! - a[1]!,
    vz = d[2]! - a[2]!;
  const dot = (uy * vz - uz * vy) * n[0]! + (uz * vx - ux * vz) * n[1]! + (ux * vy - uy * vx) * n[2]!;
  if (dot >= 0) {
    batch.triangle(b, b + 1, b + 2);
    batch.triangle(b, b + 2, b + 3);
  } else {
    batch.triangle(b, b + 2, b + 1);
    batch.triangle(b, b + 3, b + 2);
  }
}

/** A deck: carriageway-width band with underside and sides (the road surface owns the top). */
function writeDeck(batch: BatchBuilder, line: Line, halfWidth: number, thickness: number, renderId: number): number {
  let triangles = 0;
  for (let v = 0; v + 1 < line.points.length; v++) {
    const [x0, z0] = line.points[v]!,
      [x1, z1] = line.points[v + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-3) continue;
    const nx = (-(z1 - z0) / len) * halfWidth,
      nz = ((x1 - x0) / len) * halfWidth;
    const y0 = line.heights[v]!,
      y1 = line.heights[v + 1]!;
    const top = [
      [x0 + nx, y0, z0 + nz],
      [x0 - nx, y0, z0 - nz],
      [x1 - nx, y1, z1 - nz],
      [x1 + nx, y1, z1 + nz],
    ];
    const bottom = top.map(([x, y, z]) => [x!, y! - thickness, z!]);
    quad(batch, top, UP, DECK_COLOR, renderId);
    quad(batch, bottom, DOWN, hexToRgb('#969c97'), renderId);
    const side = (i0: number, i1: number, sign: number) => {
      const l = halfWidth || 1;
      quad(
        batch,
        [bottom[i0]!, bottom[i1]!, top[i1]!, top[i0]!],
        [(sign * nx) / l, 0, (sign * nz) / l],
        DECK_COLOR,
        renderId,
      );
    };
    side(0, 3, 1);
    side(1, 2, -1);
    triangles += 8;
  }
  return triangles;
}

/** Generates every structure feature of a tile into the `structure` batch. */
export function generateStructures(layer: FeatureLayer, step: number, batches: BatchSet): number {
  let triangles = 0;
  const batch = batches.get('structure', 'structure', true);
  const col = (name: string) => layer.attributes.find((a) => a.name === name);
  const width = col('width');
  const thickness = col('thickness');
  for (let i = 0; i < layer.featureCount; i++) {
    const kind = String(readFeatureMetaAt(layer, i).properties?.kind ?? 'deck');
    const renderId = layer.renderId[i]!;
    const w = Number(width?.values[i]);
    const t = Number(thickness?.values[i]);
    const parts = lines(layer, i, step);
    if (kind === 'rail' || kind === 'rail.walk') {
      const rails: BridgeRail[] = [];
      for (const { points, heights } of parts)
        for (let v = 0; v + 1 < points.length; v++)
          rails.push({
            a: points[v]!,
            b: points[v + 1]!,
            y: heights[v]! + GROUND,
            yA: heights[v]! + GROUND,
            yB: heights[v + 1]! + GROUND,
            width: Number.isFinite(w) ? w : 0.28,
            walk: kind === 'rail.walk',
            roadId: 0,
            source: 'tile',
          });
      const { runs, posts } = mergeRails(rails);
      triangles += appendPlain(batch, writeRoadStructures({ decks: [], rails: runs, piers: [] }).rail, renderId);
      for (const p of posts) {
        // the phase-one handrail post at a piece start: 0.065 m square, 1.1 m tall
        const [x, z] = p.a,
          y0 = p.yA - GROUND,
          h = 0.0325;
        const box = [
          [x - h, y0, z - h],
          [x + h, y0, z - h],
          [x + h, y0, z + h],
          [x - h, y0, z + h],
        ];
        const top = box.map(([bx, by, bz]) => [bx!, by! + 1.1, bz!]);
        for (const [i, j, n] of [
          [0, 1, [0, 0, -1]],
          [1, 2, [1, 0, 0]],
          [2, 3, [0, 0, 1]],
          [3, 0, [-1, 0, 0]],
        ] as [number, number, number[]][])
          quad(batch, [box[i]!, box[j]!, top[j]!, top[i]!], n, POST_COLOR, renderId);
        quad(batch, top, UP, POST_COLOR, renderId);
        triangles += 10;
      }
    } else if (kind === 'pier') {
      const piers: BridgePier[] = [];
      for (const { points, heights } of parts) {
        if (points.length < 3) continue;
        const [p, q] = [points[0]!, points[2]!];
        const dx = q[0] - p[0],
          dz = q[1] - p[1];
        const len = Math.hypot(dx, dz) || 1;
        piers.push({
          point: p,
          radius: Number.isFinite(t) ? t : 0.6,
          top: heights[0]! + GROUND,
          deckBottom: heights[1]! + GROUND,
          width: Number.isFinite(w) ? w : 8,
          angle: Math.atan2(-dz / len, dx / len),
          slope: Math.abs((heights[2]! - heights[1]!) / (len / 2)) < 0.03 ? 0 : (heights[2]! - heights[1]!) / (len / 2),
          roadId: 0,
          walk: false,
          source: 'tile',
        });
      }
      // Phase-one piers start 0.32 m above its slab; extend them to the tile ground.
      const writer = writeRoadStructures({ decks: [], rails: [], piers: piers.map((p) => ({ ...p })) }).pier;
      for (let v = 1; v < writer.positions.length; v += 3)
        if (Math.abs(writer.positions[v]! - 0.32) < 1e-6) writer.positions[v] = GROUND;
      triangles += appendPlain(batch, writer, renderId);
    } else if (kind === 'stairs') {
      for (const { points, heights } of parts) {
        const flight: StairFlight = {
          key: String(renderId),
          points,
          y0: heights[0]! + GROUND,
          y1: heights.at(-1)! + GROUND,
          width: Number.isFinite(w) ? w : 2,
        };
        const out = writeRoadStairs([flight]);
        for (const writer of [out.treads, out.shell, out.rails]) triangles += appendPlain(batch, writer, renderId);
      }
    } else {
      const half = Math.max(0.5, Number.isFinite(w) ? w : 6) / 2;
      const depth = Math.max(0.2, Number.isFinite(t) ? t : 1);
      for (const line of parts) triangles += writeDeck(batch, line, half, depth, renderId);
    }
  }
  return triangles;
}
