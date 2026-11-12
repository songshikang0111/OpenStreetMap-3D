// Role-batched, non-indexed or indexed triangle buffers. One batch per material role keeps a tile within its draw-call
// budget (06 section 3). All arrays are plain typed arrays so they can be transferred out of a Worker.

export interface MeshBatch {
  layer: string;
  role: string;
  vertexCount: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Tile renderId of the owning feature, one per vertex (exact as float up to 2^24). */
  renderId: Float32Array;
  /** Optional facade-v6 shader attributes (aFacade 4, aStyle 2, aLayout 4, aSurface 2). */
  facade: { aFacade: Float32Array; aStyle: Float32Array; aLayout: Float32Array; aSurface: Float32Array } | null;
  index: Uint32Array | null;
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

export class BatchBuilder {
  private readonly pos = new Grow(f32);
  private readonly nor = new Grow(f32);
  private readonly col = new Grow(f32);
  private readonly rid = new Grow(f32);
  private readonly idx = new Grow(u32);
  /** Vertices written through vertex() (before writer runs). */
  private own = 0;
  hasFacade = false;
  constructor(
    readonly layer: string,
    readonly role: string,
    readonly indexed = false,
  ) {}

  /** Vertex ranges of phase-one MeshWriters, copied once into the final typed arrays (non-indexed batches only). */
  readonly runs: { writer: WriterLike; start: number; count: number; renderId: number; yOffset: number }[] = [];
  private runVertices = 0;

  get vertexCount(): number {
    return this.own + this.runVertices;
  }

  /** Index buffer appender (indexed batches). */
  readonly index = { push: (i: number) => this.idx.push(i) };

  addWriterRun(writer: WriterLike, start: number, count: number, renderId: number, yOffset: number) {
    if (this.indexed) throw new Error('Writer runs require a non-indexed batch.');
    if (this.own) throw new Error('Writer runs must precede direct vertices in a facade batch.');
    this.hasFacade = true;
    this.runs.push({ writer, start, count, renderId, yOffset });
    this.runVertices += count;
  }

  vertex(p: ArrayLike<number>, n: ArrayLike<number>, c: ArrayLike<number>, renderId: number): number {
    if (this.hasFacade) throw new Error('Direct vertices are not supported in a facade batch.');
    this.pos.push3(p[0]!, p[1]!, p[2]!);
    this.nor.push3(n[0]!, n[1]!, n[2]!);
    this.col.push3(c[0]!, c[1]!, c[2]!);
    this.rid.push(renderId);
    return this.own++;
  }

  triangle(a: number, b: number, c: number) {
    this.idx.push3(a, b, c);
  }

  build(): MeshBatch {
    const n = this.vertexCount;
    let position: Float32Array, normal: Float32Array, color: Float32Array, renderId: Float32Array;
    if (!this.runs.length) {
      position = this.pos.view().slice();
      normal = this.nor.view().slice();
      color = this.col.view().slice();
      renderId = this.rid.view().slice();
    } else {
      position = new Float32Array(n * 3);
      normal = new Float32Array(n * 3);
      color = new Float32Array(n * 3);
      renderId = new Float32Array(n);
    }
    const facade = this.hasFacade
      ? {
          aFacade: new Float32Array(n * 4),
          aStyle: new Float32Array(n * 2),
          aLayout: new Float32Array(n * 4),
          aSurface: new Float32Array(n * 2),
        }
      : null;
    let v = 0;
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
        const f = facade!;
        for (let k = 0; k < 4; k++) {
          f.aFacade[v * 4 + k] = w.facades[i * 4 + k]!;
          f.aLayout[v * 4 + k] = w.layouts[i * 4 + k]!;
        }
        f.aStyle[v * 2] = w.styles[i * 2]!;
        f.aStyle[v * 2 + 1] = w.styles[i * 2 + 1]!;
        f.aSurface[v * 2] = w.surfaces[i * 2]!;
        f.aSurface[v * 2 + 1] = w.surfaces[i * 2 + 1]!;
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
      layer: this.layer,
      role: this.role,
      vertexCount: n,
      position,
      normal,
      color,
      renderId,
      facade,
      index: this.indexed ? this.idx.view().slice() : null,
    };
  }
}

export class BatchSet {
  private readonly map = new Map<string, BatchBuilder>();
  get(layer: string, role: string, indexed = false): BatchBuilder {
    const key = `${layer}:${role}`;
    let b = this.map.get(key);
    if (!b) {
      b = new BatchBuilder(layer, role, indexed);
      this.map.set(key, b);
    }
    return b;
  }
  build(): MeshBatch[] {
    return [...this.map.keys()]
      .sort()
      .map((k) => this.map.get(k)!.build())
      .filter((b) => b.vertexCount > 0);
  }
}

export function triangleCount(batch: MeshBatch): number {
  return (batch.index ? batch.index.length : batch.vertexCount) / 3;
}

/** Transferable buffers of a batch list, for postMessage. */
export function batchTransferables(batches: MeshBatch[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const b of batches) {
    for (const a of [b.position, b.normal, b.color, b.renderId, b.index]) if (a) out.add(a.buffer as ArrayBuffer);
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
