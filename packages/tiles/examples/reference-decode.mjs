// Minimal third-party reference decoder for City Ink tiles (format 1.x), written only from
// docs/phase2/02-tile-format.md section 9. It depends on nothing but the JavaScript standard library.
//
// Usage: node reference-decode.mjs path/to/16/53958/24829.c3t
// Prints every building as { id, height, minHeight, outline: [[lng, lat], ...] } (JSON lines).
import { readFileSync } from 'node:fs';

export function readBuildings(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  if (u8[0] !== 0x43 || u8[1] !== 0x33 || u8[2] !== 0x54 || u8[3] !== 0x01) throw new Error('not a C3T tile');
  if (u16(4) !== 1) throw new Error(`unsupported major version ${u16(4)}`);
  const extentLog2 = u8[11];
  const [z, x, y] = [u8[12], u32(16), u32(20)];
  const layerCount = u16(14);
  const dirOffset = u32(24);
  const entryBytes = u16(40);

  // string table
  const strAt = u32(28);
  const count = u32(strAt);
  const dataAt = strAt + 4 + (count + 1) * 4;
  const text = new TextDecoder();
  const strings = [];
  for (let i = 0; i < count; i++) {
    const a = u32(strAt + 4 + i * 4);
    const b = u32(strAt + 8 + i * 4);
    strings.push(text.decode(u8.subarray(dataAt + a, dataAt + b)));
  }

  // find the building layer
  let layerAt = -1;
  for (let i = 0; i < layerCount; i++) {
    const e = dirOffset + i * entryBytes;
    if (strings[u32(e)] === 'building' && u8[e + 4] === 1) layerAt = u32(e + 8);
  }
  if (layerAt < 0) return [];
  const n = u32(layerAt);
  const sectionCount = u32(layerAt + 12);

  // collect sections
  const sections = {};
  const attributes = {};
  let at = layerAt + 16;
  for (let s = 0; s < sectionCount; s++) {
    const code = u16(at);
    const length = u32(at + 4);
    const body = at + 8;
    if (code === 12) attributes[strings[u32(body)]] = { type: u32(body + 4), at: body + 8 };
    else sections[code] = { at: body, length };
    at = body + length + ((4 - (length % 4)) % 4);
  }
  const u32s = (code, i) => u32(sections[code].at + i * 4);

  // coordinates (section 9.6)
  const scale = 2 ** (z + extentLog2);
  const half = 2 ** extentLog2 / 2;
  const toLngLat = (qx, qy) => {
    const mx = (qx + x * 2 ** extentLog2 + half) / scale;
    const my = (qy + y * 2 ** extentLog2 + half) / scale;
    return [mx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI];
  };
  const f32attr = (name, i) => {
    const a = attributes[name];
    if (!a || a.type !== 0) return null;
    const v = dv.getFloat32(a.at + i * 4, true);
    return Number.isNaN(v) ? null : v;
  };
  const types = ['node', 'way', 'relation', 'generated'];

  const out = [];
  for (let i = 0; i < n; i++) {
    const firstPart = u32s(6, i);
    const ring = u32s(7, firstPart);
    const v0 = u32s(8, ring);
    const v1 = u32s(8, ring + 1);
    const outline = [];
    for (let v = v0; v < v1; v++) {
      const p = sections[9].at + v * 4;
      outline.push(toLngLat(dv.getInt16(p, true), dv.getInt16(p + 2, true)));
    }
    const id = BigInt(u32s(3, i)) * 4294967296n + BigInt(u32s(2, i));
    const seq = u32s(4, i);
    out.push({
      id: `${types[u8[sections[1].at + i]]}/${id}${seq ? `#${seq - 1}` : ''}`,
      height: f32attr('height', i),
      minHeight: f32attr('minHeight', i),
      outline,
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const b of readBuildings(readFileSync(process.argv[2]))) console.log(JSON.stringify(b));
}
