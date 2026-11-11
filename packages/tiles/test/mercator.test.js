import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lngLatToTile,
  tileToLngLatBounds,
  lngLatToMercator,
  mercatorToLngLat,
  metersPerMercatorUnit,
  tileSizeMeters,
  tileCenterLngLat,
  lngLatToTileMeters,
  tileMetersToLngLat,
  tileToWorldMatrix,
  parentTile,
  childTiles,
  tilesInBounds,
  parseTileKey,
  tileKey,
  isValidTileId,
  quantizeLngLat,
  dequantizeToLngLat,
  TileError,
  EARTH_CIRCUMFERENCE,
} from '../dist/index.js';
import { rng } from './helpers.js';

test('AC209: lng/lat ↔ tile across latitudes ±80°, zoom 0–20 and the ±180° longitude edges', () => {
  const r = rng(209);
  for (let z = 0; z <= 20; z++) {
    const n = 2 ** z;
    for (const lat of [-80, -79.999, -45, 0, 45, 79.999, 80]) {
      for (const lng of [-180, -179.9999999, 0, 179.9999999, 180]) {
        const t = lngLatToTile(lng, lat, z);
        assert.ok(isValidTileId(t), `${lng},${lat},${z}`);
        const [w, s, e, nn] = tileToLngLatBounds(t);
        assert.ok(lng >= w - 1e-9 && lng <= e + 1e-9, `lng ${lng} in [${w}, ${e}] at z${z}`);
        assert.ok(lat >= s - 1e-9 && lat <= nn + 1e-9, `lat ${lat} in [${s}, ${nn}] at z${z}`);
      }
    }
    assert.equal(lngLatToTile(-180, 0, z).x, 0);
    assert.equal(lngLatToTile(180, 0, z).x, n - 1, '180° clamps to the last column');
    for (let i = 0; i < 200; i++) {
      const lng = r() * 360 - 180;
      const lat = r() * 160 - 80;
      const t = lngLatToTile(lng, lat, z);
      const [w, s, e, nn] = tileToLngLatBounds(t);
      assert.ok(lng >= w - 1e-9 && lng <= e + 1e-9 && lat >= s - 1e-9 && lat <= nn + 1e-9);
      const [mx, my] = lngLatToMercator([lng, lat]);
      const [lng2, lat2] = mercatorToLngLat(mx, my);
      assert.ok(Math.abs(lng2 - lng) < 1e-9 && Math.abs(lat2 - lat) < 1e-9);
    }
  }
  assert.throws(() => lngLatToTile(0, 0, 25), TileError);
  assert.throws(() => lngLatToTile(NaN, 0, 3), TileError);
});

test('tile keys, parents and children', () => {
  assert.deepEqual(parseTileKey('16/53958/24829'), { z: 16, x: 53958, y: 24829 });
  assert.equal(tileKey({ z: 2, x: 1, y: 3 }), '2/1/3');
  assert.throws(() => parseTileKey('2/4/0'), TileError);
  assert.deepEqual(parentTile({ z: 16, x: 53958, y: 24829 }, 14), { z: 14, x: 13489, y: 6207 });
  const kids = childTiles({ z: 14, x: 13489, y: 6207 }, 16);
  assert.equal(kids.length, 16);
  for (const k of kids) assert.deepEqual(parentTile(k, 14), { z: 14, x: 13489, y: 6207 });
  assert.throws(() => tilesInBounds([170, 0, -170, 1], 10), TileError, 'antimeridian rejected');
  assert.equal(tilesInBounds([116.43, 39.9, 116.48, 39.93], 16).length > 0, true);
});

test('metres per Mercator unit and tile sizes match 02 section 2', () => {
  assert.equal(metersPerMercatorUnit(0), EARTH_CIRCUMFERENCE);
  const t16 = lngLatToTile(116.46, 40, 16);
  const t14 = lngLatToTile(116.46, 40, 14);
  assert.ok(Math.abs(tileSizeMeters(t16) - 468) < 2, `z16 at 40°N ${tileSizeMeters(t16)}`);
  assert.ok(Math.abs(tileSizeMeters(t14) - 1874) < 8, `z14 at 40°N ${tileSizeMeters(t14)}`);
});

test('tile-local metres invert and the world matrix places adjacent tiles seamlessly', () => {
  const a = lngLatToTile(116.46, 39.91, 16);
  const b = { ...a, x: a.x + 1 };
  const [, , e, n] = tileToLngLatBounds(a);
  const s = tileToLngLatBounds(a)[1];
  const edge = [e, (s + n) / 2];
  const anchor = [116.45, 39.9];
  const apply = (m, x, y, z) => [m[0] * x + m[12], m[5] * y, m[10] * z + m[14]];
  const pa = apply(tileToWorldMatrix(a, anchor), ...((p) => [p[0], 0, p[1]])(lngLatToTileMeters(a, edge)));
  const pb = apply(tileToWorldMatrix(b, anchor), ...((p) => [p[0], 0, p[1]])(lngLatToTileMeters(b, edge)));
  assert.ok(Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) < 1e-6, 'shared edge coincides in world space');
  const [x, z] = lngLatToTileMeters(a, [116.461, 39.912]);
  const [lng, lat] = tileMetersToLngLat(a, x, z);
  assert.ok(Math.abs(lng - 116.461) < 1e-10 && Math.abs(lat - 39.912) < 1e-10);
  const c = tileCenterLngLat(a);
  assert.deepEqual(
    lngLatToTileMeters(a, c).map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [0, 0],
  );
});

test('grid quantisation round-trips to within half a step', () => {
  const r = rng(3);
  const t = lngLatToTile(116.46, 39.91, 16);
  const [w, s, e, n] = tileToLngLatBounds(t);
  for (let i = 0; i < 1000; i++) {
    const p = [w + r() * (e - w), s + r() * (n - s)];
    const [lng, lat] = dequantizeToLngLat(t, 14, ...quantizeLngLat(t, 14, p));
    const meters = Math.hypot((lng - p[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (lat - p[1]) * 110540);
    assert.ok(meters < 0.03, `${meters} m`);
  }
});
