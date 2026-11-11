// Coverage bitmap (02 section 4): which tiles exist at the coverage zoom. Ancestors of an existing tile exist too.
import { TileError } from './diagnostics.js';
import { isValidTileId, parentTile } from './mercator.js';
import type { TileId } from './mercator.js';

const MAGIC = [0x43, 0x33, 0x54, 0x43]; // "C3TC"
const VERSION = 1;
const HEADER = 24;

export class Coverage {
  readonly bits: Uint8Array;
  constructor(
    readonly zoom: number,
    readonly minX: number,
    readonly minY: number,
    readonly width: number,
    readonly height: number,
    bits?: Uint8Array,
  ) {
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24)
      throw new TileError('COVERAGE_INVALID', `Invalid coverage zoom ${zoom}.`);
    if (width < 0 || height < 0 || width * height > 1 << 30)
      throw new TileError('COVERAGE_INVALID', 'Coverage range is too large.');
    const bytes = Math.ceil((width * height) / 8);
    if (bits && bits.length !== bytes)
      throw new TileError('COVERAGE_INVALID', 'Coverage bit array has the wrong length.');
    this.bits = bits ?? new Uint8Array(bytes);
  }

  static fromTiles(zoom: number, tiles: Iterable<TileId>): Coverage {
    const list = [...tiles];
    for (const t of list)
      if (t.z !== zoom) throw new TileError('COVERAGE_INVALID', `Tile at zoom ${t.z} given for coverage zoom ${zoom}.`);
    if (!list.length) return new Coverage(zoom, 0, 0, 0, 0);
    const xs = list.map((t) => t.x);
    const ys = list.map((t) => t.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const c = new Coverage(zoom, minX, minY, Math.max(...xs) - minX + 1, Math.max(...ys) - minY + 1);
    for (const t of list) c.set(t);
    return c;
  }

  private index(x: number, y: number): number {
    const dx = x - this.minX;
    const dy = y - this.minY;
    if (dx < 0 || dy < 0 || dx >= this.width || dy >= this.height) return -1;
    return dy * this.width + dx;
  }

  set(id: TileId): void {
    const i = this.index(id.x, id.y);
    if (id.z !== this.zoom || i < 0) throw new TileError('COVERAGE_INVALID', 'Tile is outside the coverage range.');
    this.bits[i >> 3]! |= 1 << (i & 7);
  }

  /**
   * True when the tile exists. Tiles at the coverage zoom are looked up directly; coarser tiles exist when any
   * descendant exists; finer tiles exist when their ancestor at the coverage zoom exists.
   */
  has(id: TileId): boolean {
    if (!isValidTileId(id)) return false;
    if (id.z >= this.zoom) {
      const a = id.z === this.zoom ? id : parentTile(id, this.zoom);
      const i = this.index(a.x, a.y);
      return i >= 0 && (this.bits[i >> 3]! & (1 << (i & 7))) !== 0;
    }
    const d = 2 ** (this.zoom - id.z);
    const x0 = Math.max(id.x * d, this.minX);
    const y0 = Math.max(id.y * d, this.minY);
    const x1 = Math.min((id.x + 1) * d, this.minX + this.width);
    const y1 = Math.min((id.y + 1) * d, this.minY + this.height);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = this.index(x, y);
        if (this.bits[i >> 3]! & (1 << (i & 7))) return true;
      }
    return false;
  }

  /** Existing tiles at the coverage zoom, row-major. */
  tiles(): TileId[] {
    const out: TileId[] = [];
    for (let i = 0; i < this.width * this.height; i++)
      if (this.bits[i >> 3]! & (1 << (i & 7)))
        out.push({ z: this.zoom, x: this.minX + (i % this.width), y: this.minY + Math.floor(i / this.width) });
    return out;
  }

  get count(): number {
    let n = 0;
    for (const b of this.bits) for (let v = b; v; v &= v - 1) n++;
    return n;
  }
}

export function encodeCoverage(c: Coverage): Uint8Array {
  const out = new Uint8Array(HEADER + c.bits.length);
  const v = new DataView(out.buffer);
  MAGIC.forEach((b, i) => v.setUint8(i, b));
  v.setUint16(4, VERSION, true);
  v.setUint8(6, c.zoom);
  v.setUint32(8, c.minX, true);
  v.setUint32(12, c.minY, true);
  v.setUint32(16, c.width, true);
  v.setUint32(20, c.height, true);
  out.set(c.bits, HEADER);
  return out;
}

export function decodeCoverage(input: ArrayBuffer | Uint8Array): Coverage {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = (m: string): never => {
    throw new TileError('COVERAGE_CORRUPT', m, { stage: 'decode', hint: 'Rebuild coverage.bin with the tileset.' });
  };
  if (bytes.length < HEADER) fail('Coverage file is truncated.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  MAGIC.forEach((b, i) => v.getUint8(i) !== b && fail('Coverage magic bytes do not match.'));
  const version = v.getUint16(4, true);
  if (version !== VERSION)
    throw new TileError('COVERAGE_VERSION_UNSUPPORTED', `Coverage version ${version} is not supported.`, {
      stage: 'decode',
    });
  const width = v.getUint32(16, true);
  const height = v.getUint32(20, true);
  if (width * height > 1 << 30) fail('Coverage range is too large.');
  const needed = Math.ceil((width * height) / 8);
  if (bytes.length < HEADER + needed) fail('Coverage bits are truncated.');
  return new Coverage(
    v.getUint8(6),
    v.getUint32(8, true),
    v.getUint32(12, true),
    width,
    height,
    bytes.slice(HEADER, HEADER + needed),
  );
}
