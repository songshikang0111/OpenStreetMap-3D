// Material-group batches (decision E15). Vertices of several semantic roles share one batch per material group, and a
// per-vertex `roleIndex` tells the style which role each vertex has, so an L1 tile is a handful of draw calls
// (06 section 3: <= 12 per L1 tile, <= 4 per L0 tile). All arrays are typed arrays transferable out of a Worker.

import { BoxBlock } from './box-block.js';
import { FaceBlock, type FacadeAttributes } from './face-block.js';

/** Semantic roles written by generators, in roleIndex order (05 section 3). Append only. */
export const ROLE_LIST = [
  'wall',
  'glass',
  'roof',
  'structure',
  'facility',
  'road',
  'road.marking',
  'ground',
  'ground.pavement',
  'ground.plaza',
  'ground.green',
  'water',
  'landmark',
] as const;

/** Material group of a role: building (facade shader), structure, ground (polygon offset, no shadow casting), landmark.
 * Street furniture of the `detail` layer forms a fifth group, `detail`. */
export function groupOf(role: string): 'building' | 'structure' | 'ground' | 'landmark' {
  if (/^(wall|glass|roof)(\.|$)/.test(role)) return 'building';
  if (/^(road|ground|water)(\.|$)/.test(role)) return 'ground';
  if (role === 'landmark') return 'landmark';
  return 'structure';
}

export function roleIndexOf(role: string): number {
  let r = role;
  while (r) {
    const i = (ROLE_LIST as readonly string[]).indexOf(r);
    if (i >= 0) return i;
    const dot = r.lastIndexOf('.');
    r = dot > 0 ? r.slice(0, dot) : '';
  }
  return (ROLE_LIST as readonly string[]).indexOf('structure');
}

export interface MeshBatch {
  /** Material group: building, structure, ground or landmark. */
  layer: string;
  role: string;
  vertexCount: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Tile renderId of the owning feature, one per vertex (exact as float up to 2^24). */
  renderId: Float32Array;
  /** Index into ROLE_LIST, one per vertex. */
  roleIndex: Float32Array;
  /** Optional facade-v6 shader attributes (aFacade 4, aStyle 2, aLayout 4, aSurface 2). */
  facade: { aFacade: Float32Array; aStyle: Float32Array; aLayout: Float32Array; aSurface: Float32Array } | null;
  index: Uint32Array;
  /** Axis-aligned bounds [minX, minY, minZ, maxX, maxY, maxZ], computed in the worker. */
  bounds: [number, number, number, number, number, number];
}

/** The subset of the phase-one MeshWriter read by batches. */
export interface WriterLike {
  positions: number[];
  normals: number[];
  colors: number[];
  facades: number[];
  styles: number[];
  layouts: number[];
  surfaces: number[];
}

/** A growable typed array: amortised appends without number[] boxing or GC pressure (decision E5 follow-up). */
class Indices {
  private data = new Uint32Array(256);
  length = 0;
  private reserve(extra: number) {
    if (this.length + extra <= this.data.length) return;
    const next = new Uint32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }
  push3(a: number, b: number, c: number) {
    this.reserve(3);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  push(i: number) {
    this.reserve(1);
    this.data[this.length++] = i;
  }
  view() {
    return this.data.subarray(0, this.length);
  }
}

/** One material group's buffers. Direct vertices are indexed; phase-one writer runs are appended at build time. */
class GroupBuilder {
  private capacity = 0;
  pos = new Float32Array(0);
  nor = new Float32Array(0);
  col = new Float32Array(0);
  rid = new Float32Array(0);
  role = new Float32Array(0);
  readonly idx = new Indices();
  own = 0;
  readonly runs: (
    | FaceBlock
    | BoxBlock
    | {
        writer: WriterLike;
        start: number;
        count: number;
        renderId: number;
        yOffset: number;
        roleIndex: number;
      }
  )[] = [];
  runVertices = 0;
  constructor(readonly group: string) {}

  /** All direct attributes have the same vertex count. Grow and range-check them as one allocation. */
  nextVertex(): number {
    const v = this.own++;
    if (v === this.capacity) {
      const n = Math.max(256, v * 2);
      const block = new Float32Array(n * 11);
      const pos = block.subarray(0, n * 3),
        nor = block.subarray(n * 3, n * 6),
        col = block.subarray(n * 6, n * 9);
      const rid = block.subarray(n * 9, n * 10),
        role = block.subarray(n * 10, n * 11);
      pos.set(this.pos);
      nor.set(this.nor);
      col.set(this.col);
      rid.set(this.rid);
      role.set(this.role);
      this.pos = pos;
      this.nor = nor;
      this.col = col;
      this.rid = rid;
      this.role = role;
      this.capacity = n;
    }
    return v;
  }

  build(): MeshBatch {
    const own = this.own;
    const n = own + this.runVertices;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const renderId = new Float32Array(n);
    const roleIndex = new Float32Array(n);
    position.set(this.pos.subarray(0, own * 3));
    normal.set(this.nor.subarray(0, own * 3));
    color.set(this.col.subarray(0, own * 3));
    renderId.set(this.rid.subarray(0, own));
    roleIndex.set(this.role.subarray(0, own));
    const facade = this.runs.length
      ? {
          aFacade: new Float32Array(n * 4),
          aStyle: new Float32Array(n * 2),
          aLayout: new Float32Array(n * 4),
          aSurface: new Float32Array(n * 2),
        }
      : null;
    // Direct vertices carry the neutral facade defaults (no windows).
    if (facade) for (let v = 0; v < own; v++) facade.aSurface[v * 2 + 1] = 1;
    const index = new Uint32Array(this.idx.length + this.runVertices);
    index.set(this.idx.view());
    let k = this.idx.length;
    let v = own;
    for (const run of this.runs) {
      if (run instanceof BoxBlock) {
        run.copyTo(v, position, normal, color, renderId, roleIndex, facade!);
        for (let end = v + run.count * 36; v < end; v++) index[k++] = v;
        continue;
      }
      if (run instanceof FaceBlock) {
        const count = run.count;
        position.set(run.positions.subarray(0, count * 3), v * 3);
        color.set(run.colors.subarray(0, count * 3), v * 3);
        normal.set(run.normals.subarray(0, count * 3), v * 3);
        roleIndex.set(run.roles.subarray(0, count), v);
        renderId.set(run.renderIds.subarray(0, count), v);
        facade!.aFacade.set(run.facades.subarray(0, count * 4), v * 4);
        facade!.aLayout.set(run.layouts.subarray(0, count * 4), v * 4);
        facade!.aStyle.set(run.styles.subarray(0, count * 2), v * 2);
        facade!.aSurface.set(run.surfaces.subarray(0, count * 2), v * 2);
        for (let end = v + count; v < end; v++) index[k++] = v;
        continue;
      }
      const w = run.writer;
      for (let i = run.start, end = run.start + run.count; i < end; i++, v++) {
        const s3 = i * 3,
          d3 = v * 3;
        position[d3] = w.positions[s3]!;
        position[d3 + 1] = w.positions[s3 + 1]! - run.yOffset;
        position[d3 + 2] = w.positions[s3 + 2]!;
        normal[d3] = w.normals[s3]!;
        normal[d3 + 1] = w.normals[s3 + 1]!;
        normal[d3 + 2] = w.normals[s3 + 2]!;
        color[d3] = w.colors[s3]!;
        color[d3 + 1] = w.colors[s3 + 1]!;
        color[d3 + 2] = w.colors[s3 + 2]!;
        renderId[v] = run.renderId;
        roleIndex[v] = run.roleIndex;
        const f = facade!;
        for (let q = 0; q < 4; q++) {
          f.aFacade[v * 4 + q] = w.facades[i * 4 + q]!;
          f.aLayout[v * 4 + q] = w.layouts[i * 4 + q]!;
        }
        f.aStyle[v * 2] = w.styles[i * 2]!;
        f.aStyle[v * 2 + 1] = w.styles[i * 2 + 1]!;
        f.aSurface[v * 2] = w.surfaces[i * 2]!;
        f.aSurface[v * 2 + 1] = w.surfaces[i * 2 + 1]!;
        index[k++] = v;
      }
    }
    const bounds: MeshBatch['bounds'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i += 3) {
      const x = position[i]!,
        y = position[i + 1]!,
        z = position[i + 2]!;
      if (x < bounds[0]) bounds[0] = x;
      if (y < bounds[1]) bounds[1] = y;
      if (z < bounds[2]) bounds[2] = z;
      if (x > bounds[3]) bounds[3] = x;
      if (y > bounds[4]) bounds[4] = y;
      if (z > bounds[5]) bounds[5] = z;
    }
    return {
      bounds,
      layer: this.group,
      role: this.group,
      vertexCount: n,
      position,
      normal,
      color,
      renderId,
      roleIndex,
      facade,
      index,
    };
  }
}

/** A writer for one semantic role inside its material group (the interface generators use). */
export class BatchBuilder {
  readonly roleIndex: number;
  constructor(
    private readonly g: GroupBuilder,
    readonly layer: string,
    readonly role: string,
  ) {
    this.roleIndex = roleIndexOf(role);
  }

  /** Index of the next vertex in the group (indices passed to triangle() are group-wide). */
  get vertexCount(): number {
    return this.g.own;
  }

  readonly index = { push: (i: number) => this.g.idx.push(i) };

  addWriterRun(writer: WriterLike, start: number, count: number, renderId: number, yOffset: number) {
    this.g.runs.push({ writer, start, count, renderId, yOffset, roleIndex: this.roleIndex });
    this.g.runVertices += count;
  }

  writeBox(
    points: number[][],
    axes: number[][],
    color: { r: number; g: number; b: number },
    id: number,
    yOffset: number,
    attributes: FacadeAttributes,
  ) {
    const runs = this.g.runs;
    let block = runs[runs.length - 1];
    if (!(block instanceof BoxBlock) || block.count === block.capacity) {
      block = new BoxBlock();
      runs.push(block);
    }
    block.write(points, axes, color, id, this.roleIndex, yOffset, attributes);
    this.g.runVertices += 36;
  }

  writeBuildingFace(
    a: number[],
    b: number[],
    c: number[],
    normal: number[],
    color: { r: number; g: number; b: number },
    id: number,
    yOffset: number,
    uv: number[][] | null,
    attributes: FacadeAttributes,
  ) {
    const runs = this.g.runs;
    let block = runs[runs.length - 1];
    if (!(block instanceof FaceBlock) || block.count === block.capacity) {
      block = new FaceBlock();
      runs.push(block);
    }
    block.write(a, b, c, normal, color, id, this.roleIndex, yOffset, uv, attributes);
    this.g.runVertices += 3;
  }

  vertex(p: ArrayLike<number>, n: ArrayLike<number>, c: ArrayLike<number>, renderId: number): number {
    return this.vertexCoordinates(p[0]!, p[1]!, p[2]!, n[0]!, n[1]!, n[2]!, c[0]!, c[1]!, c[2]!, renderId);
  }

  vertexCoordinates(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    renderId: number,
  ) {
    const group = this.g;
    const v = group.nextVertex(),
      i = v * 3;
    group.pos[i] = x;
    group.pos[i + 1] = y;
    group.pos[i + 2] = z;
    group.nor[i] = nx;
    group.nor[i + 1] = ny;
    group.nor[i + 2] = nz;
    group.col[i] = r;
    group.col[i + 1] = g;
    group.col[i + 2] = b;
    group.rid[v] = renderId;
    group.role[v] = this.roleIndex;
    return v;
  }

  triangle(a: number, b: number, c: number) {
    this.g.idx.push3(a, b, c);
  }
}

export class BatchSet {
  private readonly groups = new Map<string, GroupBuilder>();
  private readonly writers = new Map<string, BatchBuilder>();
  get(layer: string, role: string, _indexed = false): BatchBuilder {
    const key = `${layer}:${role}`;
    let w = this.writers.get(key);
    if (!w) {
      // Street details get their own group so that budget tiers can drop roof plant and trims without them.
      const materialGroup = groupOf(role);
      const group = layer === 'detail' && materialGroup === 'structure' ? 'detail' : materialGroup;
      let g = this.groups.get(group);
      if (!g) this.groups.set(group, (g = new GroupBuilder(group)));
      w = new BatchBuilder(g, layer, role);
      this.writers.set(key, w);
    }
    return w;
  }
  build(): MeshBatch[] {
    return [...this.groups.keys()]
      .sort()
      .map((k) => this.groups.get(k)!.build())
      .filter((b) => b.vertexCount > 0);
  }
}

export function triangleCount(batch: MeshBatch): number {
  return batch.index.length / 3;
}

/** Transferable buffers of a batch list, for postMessage. */
export function batchTransferables(batches: MeshBatch[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const b of batches) {
    for (const a of [b.position, b.normal, b.color, b.renderId, b.roleIndex, b.index]) out.add(a.buffer as ArrayBuffer);
    if (b.facade) for (const a of Object.values(b.facade)) out.add(a.buffer as ArrayBuffer);
  }
  return [...out];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.8, 0.8, 0.8];
  const v = parseInt(m[1]!, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
