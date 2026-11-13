// Material-group batches (decision E15). Vertices of several semantic roles share one batch per material group, and a
// per-vertex `roleIndex` tells the style which role each vertex has, so an L1 tile is a handful of draw calls
// (06 section 3: <= 12 per L1 tile, <= 4 per L0 tile). All arrays are typed arrays transferable out of a Worker.

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

/** Material group of a role: building (facade shader), structure, ground (polygon offset, no shadow casting), landmark. */
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
class Grow<T extends Float32Array | Uint32Array> {
  data: T;
  length = 0;
  constructor(
    private readonly make: (n: number) => T,
    capacity = 256,
  ) {
    this.data = make(capacity);
  }
  reserve(extra: number) {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < need) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push3(a: number, b: number, c: number) {
    this.reserve(3);
    const d = this.data,
      n = this.length;
    d[n] = a;
    d[n + 1] = b;
    d[n + 2] = c;
    this.length = n + 3;
  }
  push(v: number) {
    this.reserve(1);
    this.data[this.length++] = v;
  }
  view(): T {
    return this.data.subarray(0, this.length) as T;
  }
}
const f32 = (n: number) => new Float32Array(n);
const u32 = (n: number) => new Uint32Array(n);

/** One material group's buffers. Direct vertices are indexed; phase-one writer runs are appended at build time. */
class GroupBuilder {
  readonly pos = new Grow(f32);
  readonly nor = new Grow(f32);
  readonly col = new Grow(f32);
  readonly rid = new Grow(f32);
  readonly role = new Grow(f32);
  readonly idx = new Grow(u32);
  own = 0;
  readonly runs: {
    writer: WriterLike;
    start: number;
    count: number;
    renderId: number;
    yOffset: number;
    roleIndex: number;
  }[] = [];
  runVertices = 0;
  constructor(readonly group: string) {}

  build(): MeshBatch {
    const own = this.own;
    const n = own + this.runVertices;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const renderId = new Float32Array(n);
    const roleIndex = new Float32Array(n);
    position.set(this.pos.view());
    normal.set(this.nor.view());
    color.set(this.col.view());
    renderId.set(this.rid.view());
    roleIndex.set(this.role.view());
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

  vertex(p: ArrayLike<number>, n: ArrayLike<number>, c: ArrayLike<number>, renderId: number): number {
    const g = this.g;
    g.pos.push3(p[0]!, p[1]!, p[2]!);
    g.nor.push3(n[0]!, n[1]!, n[2]!);
    g.col.push3(c[0]!, c[1]!, c[2]!);
    g.rid.push(renderId);
    g.role.push(this.roleIndex);
    return g.own++;
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
      const group = groupOf(role);
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
