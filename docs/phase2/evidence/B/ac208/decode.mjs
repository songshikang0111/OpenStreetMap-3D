import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const u8 = (o) => dv.getUint8(o), u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
const i16 = (o) => dv.getInt16(o, true), f32 = (o) => dv.getFloat32(o, true);
if (u8(0) !== 0x43 || u8(1) !== 0x33 || u8(2) !== 0x54 || u8(3) !== 1) throw new Error('bad magic');
if (u16(4) !== 1) throw new Error('unsupported major');
const extentLog2 = u8(11), z = u8(12), tx = u32(16), ty = u32(20);
const dirOff = u32(24), strOff = u32(28), layerCount = u16(14), entBytes = u16(40);
if (buf.length < u32(36)) throw new Error('truncated');
const sc = u32(strOff), dataStart = strOff + 4 + 4 * (sc + 1);
const strs = [];
const td = new TextDecoder();
for (let i = 0; i < sc; i++) {
  const a = u32(strOff + 4 + 4 * i), b = u32(strOff + 4 + 4 * (i + 1));
  strs.push(td.decode(buf.subarray(dataStart + a, dataStart + b)));
}
let layer = null;
for (let i = 0; i < layerCount; i++) {
  const o = dirOff + i * entBytes;
  if (strs[u32(o)] === 'building' && u8(o + 4) === 1) layer = { off: u32(o + 8), len: u32(o + 12), n: u32(o + 16) };
}
const out = [];
if (layer) {
  const o = layer.off, n = u32(o);
  const secCount = u32(o + 12);
  const S = {}, attrs = {};
  let p = o + 16;
  for (let s = 0; s < secCount; s++) {
    const code = u16(p), len = u32(p + 4), d = p + 8;
    if (code === 12) attrs[strs[u32(d)]] = { type: u32(d + 4), at: d + 8 };
    else S[code] = { at: d, len };
    p = d + ((len + 3) & ~3);
  }
  const arr = (code, rd, w) => { const s = S[code]; const r = []; for (let i = 0; i < s.len / w; i++) r.push(rd(s.at + i * w)); return r; };
  const type = arr(1, u8, 1), lo = arr(2, u32, 4), hi = arr(3, u32, 4), seq = S[4] ? arr(4, u32, 4) : null;
  const ps = arr(6, u32, 4), rs = arr(7, u32, 4), vs = arr(8, u32, 4);
  const pos = S[9].at;
  const names = ['node', 'way', 'relation', 'generated'];
  const E = 2 ** extentLog2, W = 2 ** (z + extentLog2);
  for (let i = 0; i < n; i++) {
    let id = `${names[type[i]]}/${(BigInt(hi[i]) << 32n) | BigInt(lo[i])}`;
    if (seq && seq[i] > 0) id += `#${seq[i] - 1}`;
    let height = null;
    const h = attrs.height;
    if (h) {
      const a = h.at + 4 * i;
      if (h.type === 0) { const v = f32(a); height = Number.isNaN(v) ? null : v; }
      else if (h.type === 1) { const v = dv.getInt32(a, true); height = v === -2147483648 ? null : v; }
      else if (h.type === 2) { const v = u32(a); height = v === 0xFFFFFFFF ? null : v; }
    }
    const outline = [];
    const part = ps[i], ring = rs[part];
    for (let v = vs[ring]; v < vs[ring + 1]; v++) {
      const qx = i16(pos + 4 * v), qy = i16(pos + 4 * v + 2);
      const mx = (qx + tx * E + E / 2) / W, my = (qy + ty * E + E / 2) / W;
      outline.push([mx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI]);
    }
    out.push({ id, height, outline });
  }
}
console.log(JSON.stringify(out));
