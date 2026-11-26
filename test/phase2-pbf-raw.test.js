import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPbf } from '../packages/builder/dist/ingest/pbf.js';

// These length-delimited fixture fields use one-byte keys and lengths.
function bytesField(number, bytes) {
  assert.ok(bytes.length < 128);
  return Buffer.from([(number << 3) | 2, bytes.length, ...bytes]);
}

function rawBlock(type, payload) {
  const blob = bytesField(1, payload);
  const header = Buffer.concat([
    bytesField(1, Buffer.from(type)),
    bytesField(2, [0xff, 0x00, 0x18, 0x01]), // opaque BlobHeader.indexdata
    Buffer.from([0x18, blob.length]), // BlobHeader.datasize
  ]);
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(header.length);
  return Buffer.concat([lengthPrefix, header, blob]);
}

test('readPbf reads raw header and data blobs with optional binary indexdata', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-pbf-raw-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'indexed-raw.osm.pbf');
  const requiredFeatures = bytesField(4, Buffer.from('OsmSchema-V0.6'));
  const replicationTimestamp = Buffer.from([0x80, 0x02, 10]); // HeaderBlock field 32, value 10
  const header = rawBlock('OSMHeader', Buffer.concat([requiredFeatures, replicationTimestamp]));
  const strings = bytesField(1, bytesField(1, []));
  // A plain Node: zigzag-encoded ID 7, latitude -1 and longitude 2 at the default granularity.
  const node = bytesField(1, [0x08, 14, 0x40, 1, 0x48, 4]);
  const data = rawBlock('OSMData', Buffer.concat([strings, bytesField(2, node)]));
  await writeFile(file, Buffer.concat([header, data]));

  const nodes = [];
  const decoded = await readPbf(file, { node: (id, lat, lon) => nodes.push({ id, lat, lon }) });
  assert.equal(decoded.replicationTimestamp, 10);
  assert.deepEqual(nodes, [{ id: 7, lat: -1e-7, lon: 2e-7 }]);
});
