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

  get vertexCount(): number {
    return this.position.length / 3;
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
    const facade = this.hasFacade
      ? {
          aFacade: new Float32Array(this.aFacade),
          aStyle: new Float32Array(this.aStyle),
          aLayout: new Float32Array(this.aLayout),
          aSurface: new Float32Array(this.aSurface),
        }
      : null;
    return {
      layer: this.layer,
      role: this.role,
      vertexCount: this.vertexCount,
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      color: new Float32Array(this.color),
      renderId: new Float32Array(this.renderId),
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
