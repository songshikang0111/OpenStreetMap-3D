// Test-only binary transport for Three.js ObjectLoader JSON. This is deliberately
// labelled as a runtime fixture, not the phase-one core scene protocol.
import { BufferGeometry, ObjectLoader } from 'three';
const types = { Float32Array, Uint32Array, Uint16Array, Int32Array, Int16Array, Uint8Array, Int8Array, Float64Array };
export function encodeFixture(group) {
  // Parametric toJSON methods omit later attribute additions and transforms.
  // Serialize concrete buffers so fixture fidelity includes shader attributes.
  const clone = group.clone(true), geometries = new Map();
  clone.traverse(object => { if (object.geometry) { if (!geometries.has(object.geometry)) geometries.set(object.geometry, new BufferGeometry().copy(object.geometry)); object.geometry = geometries.get(object.geometry); } });
  const json = clone.toJSON(), arrays = []; let offset = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (types[node.type] && Array.isArray(node.array)) {
      const data = new types[node.type](node.array); offset = Math.ceil(offset / 8) * 8;
      node.array = { fixtureBuffer: true, byteOffset: offset, length: data.length };
      arrays.push({ data: new Uint8Array(data.buffer), offset }); offset += data.byteLength;
    }
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value);
  }
  visit(json);
  const header = new TextEncoder().encode(JSON.stringify({ codec: 'runtime-fixture-v1', json })), start = Math.ceil((header.length + 4) / 8) * 8;
  const buffer = new ArrayBuffer(start + offset); new DataView(buffer).setUint32(0, header.length, true); new Uint8Array(buffer, 4, header.length).set(header);
  for (const array of arrays) new Uint8Array(buffer, start + array.offset, array.data.length).set(array.data);
  return new Uint8Array(buffer);
}
export function decodeFixture(payload) {
  const buffer = ArrayBuffer.isView(payload) ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : payload;
  const length = new DataView(buffer).getUint32(0, true), start = Math.ceil((length + 4) / 8) * 8;
  const packet = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
  if (packet.codec !== 'runtime-fixture-v1') throw new Error('Unsupported fixture codec.');
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.array?.fixtureBuffer) {
      if (!types[node.type]) throw new Error('Invalid typed array.');
      node.array = new types[node.type](buffer, start + node.array.byteOffset, node.array.length); return;
    }
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value);
  }
  visit(packet.json); return new ObjectLoader().parse(packet.json);
}
