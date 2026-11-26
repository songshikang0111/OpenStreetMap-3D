// Minimal streaming OSM PBF decoder (WP-F task F1, decision E12): file blocks are read one at a time, inflated with
// node:zlib and decoded with a hand-written protobuf reader. No dependency; ids and coordinates use JS numbers
// (exact below 2^53). Only what the builder needs is decoded: tags, way node refs, relation members, node coordinates.
import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const MAX_HEADER = 64 * 1024;
const MAX_BLOB = 32 * 1024 * 1024;

class Reader {
  pos = 0;
  constructor(
    readonly buf: Uint8Array,
    readonly end = buf.length,
  ) {}
  more(): boolean {
    return this.pos < this.end;
  }
  varint(): number {
    let result = 0,
      shift = 1,
      b: number;
    do {
      if (this.pos >= this.end || shift > 2 ** 63) throw new Error('Invalid PBF varint');
      b = this.buf[this.pos++]!;
      result += (b & 0x7f) * shift;
      shift *= 128;
    } while (b & 0x80);
    return result;
  }
  // PrimitiveBlock coordinate offsets are int64 (two’s complement), unlike zig-zag node coordinates.
  int64(): number {
    let value = 0n;
    for (let shift = 0n; shift < 64n && this.more(); shift += 7n) {
      const byte = this.buf[this.pos++]!;
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) return Number(BigInt.asIntN(64, value));
    }
    throw new Error('Invalid PBF int64');
  }
  length(): number {
    const n = this.varint();
    if (n > this.end - this.pos) throw new Error('Truncated PBF field');
    return n;
  }
  svarint(): number {
    const n = this.varint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }
  key(): [number, number] {
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }
  bytes(): Uint8Array {
    const n = this.length();
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  sub(): Reader {
    const n = this.length();
    const r = new Reader(this.buf, this.pos + n);
    r.pos = this.pos;
    this.pos += n;
    return r;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // read the length first: `this.pos += this.varint()` would add to the position before the length byte
      const n = this.length();
      this.pos += n;
    } else if (wire === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
    if (this.pos > this.end) throw new Error('Truncated PBF field');
  }
  packed(signed: boolean, delta: boolean): number[] {
    const r = this.sub();
    const out: number[] = [];
    let acc = 0;
    while (r.more()) {
      const v = signed ? r.svarint() : r.varint();
      acc = delta ? acc + v : v;
      out.push(acc);
    }
    return out;
  }
}

const text = new TextDecoder();

export interface PbfWay {
  id: number;
  tags: Record<string, string>;
  refs: number[];
}
export interface PbfRelation {
  id: number;
  tags: Record<string, string>;
  members: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
}
export interface PbfVisitor {
  header?(header: PbfHeader): void;
  onBlock?(): void;
  /** Called per dense or plain node; tags are only built when `wantNodeTags` is true. */
  node?(id: number, lat: number, lon: number, tags: Record<string, string> | null): void;
  way?(way: PbfWay): void;
  relation?(relation: PbfRelation): void;
  wantNodeTags?: boolean;
}

export interface PbfHeader {
  bbox: [number, number, number, number] | null;
  replicationTimestamp: number | null;
}

/** Reads a whole file block by block, calling the visitor; returns the header. Memory stays at one block. */
export async function readPbf(file: string, visitor: PbfVisitor): Promise<PbfHeader> {
  const fh = await open(file, 'r');
  const header: PbfHeader = { bbox: null, replicationTimestamp: null };
  try {
    const lenBuf = Buffer.alloc(4);
    let offset = 0;
    const read = async (buffer: Buffer, allowEnd = false) => {
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await fh.read(buffer, filled, buffer.length - filled, offset);
        if (bytesRead === 0) {
          if (allowEnd && filled === 0) return false;
          throw new Error('Truncated PBF file block');
        }
        filled += bytesRead;
        offset += bytesRead;
      }
      return true;
    };
    for (;;) {
      visitor.onBlock?.();
      if (!(await read(lenBuf, true))) break;
      const headerLength = lenBuf.readUInt32BE(0);
      if (!headerLength || headerLength >= MAX_HEADER) throw new Error('Invalid PBF BlobHeader size');
      const hb = Buffer.alloc(headerLength);
      await read(hb);
      const hr = new Reader(hb);
      let type = '',
        dataSize = 0;
      while (hr.more()) {
        const [f, w] = hr.key();
        if (f === 1) type = text.decode(hr.bytes());
        else if (f === 3) dataSize = hr.varint();
        else hr.skip(w);
      }
      if (!dataSize || dataSize > MAX_BLOB) throw new Error('Invalid PBF Blob size');
      const blob = Buffer.alloc(dataSize);
      await read(blob);
      if (type !== 'OSMHeader' && type !== 'OSMData') continue;
      const data = inflateBlob(blob);
      if (type === 'OSMHeader') {
        readHeader(data, header);
        visitor.header?.(header);
      } else if (type === 'OSMData') readBlock(data, visitor);
    }
  } finally {
    await fh.close();
  }
  return header;
}

function inflateBlob(blob: Uint8Array): Uint8Array {
  const r = new Reader(blob);
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 1) return r.bytes();
    if (f === 3) return inflateSync(r.bytes(), { maxOutputLength: MAX_BLOB });
    if (f === 4 || f === 5 || f === 6 || f === 7)
      throw new Error('Unsupported PBF blob compression (only zlib or raw).');
    r.skip(w);
  }
  throw new Error('Missing PBF blob payload');
}

function readHeader(data: Uint8Array, header: PbfHeader) {
  const r = new Reader(data);
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 1) {
      const b = r.sub();
      const box = [0, 0, 0, 0];
      while (b.more()) {
        const [bf] = b.key();
        box[bf - 1] = b.svarint() / 1e9;
      }
      // left, right, top, bottom → west, south, east, north
      header.bbox = [box[0]!, box[3]!, box[1]!, box[2]!];
    } else if (f === 4) {
      const feature = text.decode(r.bytes());
      if (feature !== 'OsmSchema-V0.6' && feature !== 'DenseNodes')
        throw new Error(`Unsupported required OSM PBF feature: ${feature}`);
    } else if (f === 32) header.replicationTimestamp = r.varint();
    else r.skip(w);
  }
}

function readBlock(data: Uint8Array, v: PbfVisitor) {
  const r = new Reader(data);
  let strings: string[] = [];
  const groups: Reader[] = [];
  let granularity = 100,
    latOffset = 0,
    lonOffset = 0;
  while (r.more()) {
    const [f, w] = r.key();
    if (f === 1) {
      const s = r.sub();
      strings = [];
      while (s.more()) {
        const [sf, sw] = s.key();
        if (sf === 1) strings.push(text.decode(s.bytes()));
        else s.skip(sw);
      }
    } else if (f === 2) groups.push(r.sub());
    else if (f === 17) granularity = r.varint();
    else if (f === 19) latOffset = r.int64();
    else if (f === 20) lonOffset = r.int64();
    else r.skip(w);
  }
  const coord = (raw: number, off: number) => (off + granularity * raw) / 1e9;
  const tagsOf = (keys: number[], vals: number[]) => {
    const t: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) t[strings[keys[i]!]!] = strings[vals[i]!]!;
    return t;
  };
  for (const g of groups)
    while (g.more()) {
      const [f, w] = g.key();
      if (f === 2 && v.node) {
        const d = g.sub();
        let ids: number[] = [],
          lats: number[] = [],
          lons: number[] = [],
          kv: number[] = [];
        while (d.more()) {
          const [df, dw] = d.key();
          if (df === 1) ids = d.packed(true, true);
          else if (df === 8) lats = d.packed(true, true);
          else if (df === 9) lons = d.packed(true, true);
          else if (df === 10 && v.wantNodeTags) kv = d.packed(false, false);
          else d.skip(dw);
        }
        let k = 0;
        for (let i = 0; i < ids.length; i++) {
          let tags: Record<string, string> | null = null;
          if (v.wantNodeTags && kv.length) {
            while (kv[k] !== 0 && k < kv.length) {
              (tags ??= {})[strings[kv[k]!]!] = strings[kv[k + 1]!]!;
              k += 2;
            }
            k++;
          }
          v.node(ids[i]!, coord(lats[i]!, latOffset), coord(lons[i]!, lonOffset), tags);
        }
      } else if (f === 1 && v.node) {
        const n = g.sub();
        let id = 0,
          lat = 0,
          lon = 0,
          keys: number[] = [],
          vals: number[] = [];
        while (n.more()) {
          const [nf, nw] = n.key();
          if (nf === 1) id = n.svarint();
          else if (nf === 2) keys = n.packed(false, false);
          else if (nf === 3) vals = n.packed(false, false);
          else if (nf === 8) lat = n.svarint();
          else if (nf === 9) lon = n.svarint();
          else n.skip(nw);
        }
        v.node(id, coord(lat, latOffset), coord(lon, lonOffset), keys.length ? tagsOf(keys, vals) : null);
      } else if (f === 3 && v.way) {
        const wr = g.sub();
        let id = 0,
          keys: number[] = [],
          vals: number[] = [],
          refs: number[] = [];
        while (wr.more()) {
          const [wf, ww] = wr.key();
          if (wf === 1) id = wr.varint();
          else if (wf === 2) keys = wr.packed(false, false);
          else if (wf === 3) vals = wr.packed(false, false);
          else if (wf === 8) refs = wr.packed(true, true);
          else wr.skip(ww);
        }
        v.way({ id, tags: tagsOf(keys, vals), refs });
      } else if (f === 4 && v.relation) {
        const rr = g.sub();
        let id = 0,
          keys: number[] = [],
          vals: number[] = [],
          roles: number[] = [],
          mem: number[] = [],
          types: number[] = [];
        while (rr.more()) {
          const [rf, rw] = rr.key();
          if (rf === 1) id = rr.varint();
          else if (rf === 2) keys = rr.packed(false, false);
          else if (rf === 3) vals = rr.packed(false, false);
          else if (rf === 8) roles = rr.packed(false, false);
          else if (rf === 9) mem = rr.packed(true, true);
          else if (rf === 10) types = rr.packed(false, false);
          else rr.skip(rw);
        }
        v.relation({
          id,
          tags: tagsOf(keys, vals),
          members: mem.map((ref, i) => ({
            type: (['node', 'way', 'relation'] as const)[types[i]!] ?? 'node',
            ref,
            role: strings[roles[i]!] ?? '',
          })),
        });
      } else g.skip(w);
    }
}
