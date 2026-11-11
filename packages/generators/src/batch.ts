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

export class BatchBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly renderId: number[] = [];
  readonly aFacade: number[] = [];
  readonly aStyle: number[] = [];
  readonly aLayout: number[] = [];
  readonly aSurface: number[] = [];
  readonly index: number[] = [];
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
    return this.position.length / 3 + this.runVertices;
  }

  addWriterRun(writer: WriterLike, start: number, count: number, renderId: number, yOffset: number) {
    if (this.indexed) throw new Error('Writer runs require a non-indexed batch.');
    this.hasFacade = true;
    this.runs.push({ writer, start, count, renderId, yOffset });
    this.runVertices += count;
  }

  vertex(p: ArrayLike<number>, n: ArrayLike<number>, c: ArrayLike<number>, renderId: number): number {
    this.position.push(p[0]!, p[1]!, p[2]!);
    this.normal.push(n[0]!, n[1]!, n[2]!);
    this.color.push(c[0]!, c[1]!, c[2]!);
    this.renderId.push(renderId);
    if (this.hasFacade) {
      this.aFacade.push(0, 0, 0, 0);
      this.aStyle.push(0, 0);
      this.aLayout.push(0, 0, 0, 0);
      this.aSurface.push(0, 1);
    }
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number) {
    this.index.push(a, b, c);
  }

  build(): MeshBatch {
    const n = this.vertexCount;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const renderId = new Float32Array(n);
    position.set(this.position);
    normal.set(this.normal);
    color.set(this.color);
    renderId.set(this.renderId);
    const facade = this.hasFacade
      ? {
          aFacade: new Float32Array(n * 4),
          aStyle: new Float32Array(n * 2),
          aLayout: new Float32Array(n * 4),
          aSurface: new Float32Array(n * 2),
        }
      : null;
    if (facade) {
      facade.aFacade.set(this.aFacade);
      facade.aStyle.set(this.aStyle);
      facade.aLayout.set(this.aLayout);
      facade.aSurface.set(this.aSurface);
    }
    let v = this.position.length / 3;
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
    return {
      layer: this.layer,
      role: this.role,
      vertexCount: n,
      position,
      normal,
      color,
      renderId,
      facade,
      index: this.indexed ? new Uint32Array(this.index) : null,
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
