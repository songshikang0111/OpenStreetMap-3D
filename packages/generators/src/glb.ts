// Binary glTF 2.0. Geometry is emitted immediately so a full-city Node export can spool the BIN chunk to disk.
import type { BufferGeometry } from 'three';
import type { LngLat, Tileset } from '@city-ink/tiles';

type Data = Float32Array | Uint32Array | Uint16Array;
type Node = {
  name: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  scale?: number[];
};
interface Geometry {
  position: Float32Array;
  normal?: Float32Array;
  color?: Float32Array;
  index?: Uint16Array | Uint32Array;
}

export function geometryArrays(geometry: BufferGeometry): Geometry {
  // Map tile objects have tightly packed float attributes and unsigned 16/32-bit indices.
  return {
    position: geometry.getAttribute('position').array as Float32Array,
    normal: geometry.getAttribute('normal')?.array as Float32Array | undefined,
    color: geometry.getAttribute('color')?.array as Float32Array | undefined,
    index: geometry.index?.array as Uint16Array | Uint32Array | undefined,
  };
}

export class TileGlb {
  private readonly nodes: Node[] = [];
  private readonly roots: number[] = [];
  private readonly meshes: { name: string; primitives: object[] }[] = [];
  private readonly materials: object[] = [];
  private readonly accessors: object[] = [];
  private readonly views: object[] = [];
  private length = 0;

  constructor(
    private readonly tileset: Tileset,
    private readonly origin: LngLat,
    private readonly scope: 'loaded' | 'complete',
    private readonly emit: (bytes: Uint8Array<ArrayBuffer>) => void,
    private readonly maxBytes: number = 0xffffffff,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Expected a positive GLB byte budget.');
  }

  tile(key: string, matrix: number[]): number {
    this.roots.push(this.nodes.length);
    return this.nodes.push({ name: key, matrix }) - 1;
  }

  private append(array: Data, size: number, target: number, bounds?: { min: number[]; max: number[] }): number {
    const length = array.byteLength;
    const pad = (4 - (length % 4)) % 4;
    this.checkSize(this.length + length + pad);
    const view = this.views.push({ buffer: 0, byteOffset: this.length, byteLength: length, target }) - 1;
    this.emit(new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, length));
    if (pad) this.emit(new Uint8Array(pad));
    this.length += length + pad;
    const componentType = array instanceof Float32Array ? 5126 : array instanceof Uint16Array ? 5123 : 5125;
    return (
      this.accessors.push({
        bufferView: view,
        componentType,
        count: array.length / size,
        type: size === 3 ? 'VEC3' : 'SCALAR',
        ...bounds,
      }) - 1
    );
  }

  mesh(parent: number, name: string, geometry: Geometry, tint: number[] = [1, 1, 1], instances?: Float32Array): void {
    const { position, normal, color, index } = geometry;
    if (!position.length || index?.length === 0 || instances?.length === 0) return;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, position[i + k]!);
        max[k] = Math.max(max[k]!, position[i + k]!);
      }
    const attributes: Record<string, number> = { POSITION: this.append(position, 3, 34962, { min, max }) };
    if (normal) attributes.NORMAL = this.append(normal, 3, 34962);
    if (color) attributes.COLOR_0 = this.append(color, 3, 34962);
    const material =
      this.materials.push({
        name,
        pbrMetallicRoughness: {
          baseColorFactor: [...tint, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
        doubleSided: true,
      }) - 1;
    const mesh =
      this.meshes.push({
        name,
        primitives: [{ attributes, material, ...(index ? { indices: this.append(index, 1, 34963) } : {}) }],
      }) - 1;
    const children = (this.nodes[parent]!.children ??= []);
    if (!instances) {
      children.push(this.nodes.push({ name, mesh }) - 1);
      return;
    }
    // Tree transforms consist solely of scale and translation. Share each primitive between its instances.
    for (let i = 0; i < instances.length; i += 16)
      children.push(
        this.nodes.push({
          name,
          mesh,
          translation: Array.from(instances.subarray(i + 12, i + 15)),
          scale: [instances[i]!, instances[i + 5]!, instances[i + 10]!],
        }) - 1,
      );
  }

  private checkSize(bytes: number): void {
    if (bytes > Math.min(this.maxBytes, 0xffffffff))
      throw new Error('GLB exceeds its byte limit. Export a smaller area.');
  }

  /** GLB and chunk headers plus the JSON chunk; append the emitted BIN bytes in order. */
  header(): Uint8Array<ArrayBuffer> {
    const doc = {
      asset: { version: '2.0', generator: 'City Ink', copyright: this.tileset.attribution.text },
      scene: 0,
      scenes: [{ name: this.tileset.name, ...(this.roots.length ? { nodes: this.roots } : {}) }],
      extras: {
        scope: this.scope,
        origin: this.origin,
        axes: 'x east, y up, z south; local metres',
        attribution: this.tileset.attribution,
        source: this.tileset.source,
      },
      ...(this.nodes.length ? { nodes: this.nodes } : {}),
      ...(this.length
        ? {
            meshes: this.meshes,
            materials: this.materials,
            accessors: this.accessors,
            bufferViews: this.views,
            buffers: [{ byteLength: this.length }],
          }
        : {}),
    };
    const json = new TextEncoder().encode(JSON.stringify(doc));
    const padded = Math.ceil(json.length / 4) * 4;
    const out = new Uint8Array(20 + padded + (this.length ? 8 : 0));
    this.checkSize(out.length + this.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, out.length + this.length, true);
    view.setUint32(12, padded, true);
    view.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20);
    out.fill(32, 20 + json.length, 20 + padded);
    if (this.length) {
      view.setUint32(20 + padded, this.length, true);
      view.setUint32(24 + padded, 0x004e4942, true);
    }
    return out;
  }
}
