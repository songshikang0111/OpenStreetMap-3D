// Web Mercator and XYZ tile math (docs/phase2/01-architecture.md section 6, 02 section 5.2).
// Mercator units are normalised to [0, 1] with the origin in the north-west, y growing south (as in MapLibre).
import { TileError } from './diagnostics.js';

export type LngLat = [lng: number, lat: number];
export type Bounds = [west: number, south: number, east: number, north: number];
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Equatorial circumference of the WGS84 ellipsoid, metres. */
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
/** Latitude limit of the Web Mercator square. */
export const MERCATOR_MAX_LATITUDE = 85.0511287798066;
/** Latitude limit supported by builds (phase-one limit, 01 section 6). */
export const SUPPORTED_MAX_LATITUDE = 80;
export const MAX_ZOOM = 24;

const DEG = Math.PI / 180;

export function lngToMercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat));
  const s = Math.sin(clamped * DEG);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function mercatorXToLng(x: number): number {
  return x * 360 - 180;
}

export function mercatorYToLat(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG;
}

export function lngLatToMercator(lngLat: LngLat): [number, number] {
  return [lngToMercatorX(lngLat[0]), latToMercatorY(lngLat[1])];
}

export function mercatorToLngLat(x: number, y: number): LngLat {
  return [mercatorXToLng(x), mercatorYToLat(y)];
}

/** Metres represented by one normalised Mercator unit at a latitude (equals the scaled circumference). */
export function metersPerMercatorUnit(lat: number): number {
  return EARTH_CIRCUMFERENCE * Math.cos(lat * DEG);
}

export function isValidTileId(id: unknown): id is TileId {
  if (!id || typeof id !== 'object') return false;
  const { z, x, y } = id as TileId;
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM) return false;
  const n = 2 ** z;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < n && y < n;
}

export function assertTileId(id: TileId): void {
  if (!isValidTileId(id))
    throw new TileError('TILE_ID_INVALID', `Invalid tile id ${JSON.stringify(id)}.`, {
      hint: `z must be an integer in [0, ${MAX_ZOOM}] and x, y integers in [0, 2^z).`,
    });
}

export function tileKey(id: TileId): string {
  return `${id.z}/${id.x}/${id.y}`;
}

export function parseTileKey(key: string): TileId {
  const m = /^(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/.exec(key);
  const id = m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
  if (!id || !isValidTileId(id))
    throw new TileError('TILE_ID_INVALID', `Invalid tile key "${key}".`, { hint: 'Use the form z/x/y.' });
  return id;
}

export function lngLatToTile(lng: number, lat: number, zoom: number): TileId {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM)
    throw new TileError('TILE_ZOOM_INVALID', `Zoom ${zoom} is not an integer in [0, ${MAX_ZOOM}].`);
  if (!Number.isFinite(lng) || !Number.isFinite(lat))
    throw new TileError('LNGLAT_INVALID', `Coordinate [${lng}, ${lat}] is not finite.`);
  const n = 2 ** zoom;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  return { z: zoom, x: clamp(lngToMercatorX(lng)), y: clamp(latToMercatorY(lat)) };
}

/** [west, south, east, north] of a tile in degrees. */
export function tileToLngLatBounds(id: TileId): Bounds {
  assertTileId(id);
  const n = 2 ** id.z;
  return [
    mercatorXToLng(id.x / n),
    mercatorYToLat((id.y + 1) / n),
    mercatorXToLng((id.x + 1) / n),
    mercatorYToLat(id.y / n),
  ];
}

export function tileCenterMercator(id: TileId): [number, number] {
  const n = 2 ** id.z;
  return [(id.x + 0.5) / n, (id.y + 0.5) / n];
}

export function tileCenterLngLat(id: TileId): LngLat {
  const [x, y] = tileCenterMercator(id);
  return mercatorToLngLat(x, y);
}

/** Edge length of a tile in its own local metres (Mercator size times the scale at the tile centre). */
export function tileSizeMeters(id: TileId): number {
  return metersPerMercatorUnit(tileCenterLngLat(id)[1]) / 2 ** id.z;
}

export function parentTile(id: TileId, zoom = id.z - 1): TileId {
  if (zoom < 0 || zoom > id.z)
    throw new TileError('TILE_ZOOM_INVALID', `No ancestor at zoom ${zoom} for ${tileKey(id)}.`);
  const d = id.z - zoom;
  return { z: zoom, x: Math.floor(id.x / 2 ** d), y: Math.floor(id.y / 2 ** d) };
}

export function childTiles(id: TileId, zoom = id.z + 1): TileId[] {
  if (zoom < id.z || zoom > MAX_ZOOM) throw new TileError('TILE_ZOOM_INVALID', `No descendants at zoom ${zoom}.`);
  const d = 2 ** (zoom - id.z);
  const out: TileId[] = [];
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) out.push({ z: zoom, x: id.x * d + x, y: id.y * d + y });
  return out;
}

/** Tiles at a zoom that intersect lng/lat bounds, row-major. Rejects antimeridian-crossing bounds. */
export function tilesInBounds(bounds: Bounds, zoom: number): TileId[] {
  const [w, s, e, n] = bounds;
  if (!(w < e) || !(s < n))
    throw new TileError(
      'BOUNDS_INVALID',
      `Bounds ${JSON.stringify(bounds)} must satisfy west < east and south < north.`,
      {
        hint: 'Builds that cross the antimeridian are not supported.',
      },
    );
  const a = lngLatToTile(w, n, zoom);
  const b = lngLatToTile(e, s, zoom);
  const out: TileId[] = [];
  for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) out.push({ z: zoom, x, y });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Quantisation grid. Every tile at zoom z uses a global integer grid of 2^(z + extentLog2) cells per Mercator unit,
// offset so that 0 is the tile centre. Because the grid is global and the offsets are integers, a point on a shared
// edge quantises to the same Mercator position from both sides (02 section 5.2, AC203).
// ---------------------------------------------------------------------------------------------------------------

/** Default grid resolution: 2^14 cells per tile at zoom >= 16 (about 3 cm), 2^15 below (about 7 cm at z14). */
export function defaultExtentLog2(z: number): number {
  return z >= 16 ? 14 : 15;
}

export const QUANT_MIN = -32768;
export const QUANT_MAX = 32767;

function gridScale(id: TileId, extentLog2: number): number {
  return 2 ** (id.z + extentLog2);
}

function gridCenter(id: TileId, extentLog2: number): [number, number] {
  const e = 2 ** extentLog2;
  return [id.x * e + e / 2, id.y * e + e / 2];
}

/** Quantise a Mercator position to tile grid integers (may lie outside the int16 range; check with fitsInt16). */
export function quantizeMercator(id: TileId, extentLog2: number, mx: number, my: number): [number, number] {
  const k = gridScale(id, extentLog2);
  const [cx, cy] = gridCenter(id, extentLog2);
  return [Math.round(mx * k) - cx, Math.round(my * k) - cy];
}

export function dequantizeToMercator(id: TileId, extentLog2: number, qx: number, qy: number): [number, number] {
  const k = gridScale(id, extentLog2);
  const [cx, cy] = gridCenter(id, extentLog2);
  return [(qx + cx) / k, (qy + cy) / k];
}

export function quantizeLngLat(id: TileId, extentLog2: number, lngLat: LngLat): [number, number] {
  const [mx, my] = lngLatToMercator(lngLat);
  return quantizeMercator(id, extentLog2, mx, my);
}

export function dequantizeToLngLat(id: TileId, extentLog2: number, qx: number, qy: number): LngLat {
  const [mx, my] = dequantizeToMercator(id, extentLog2, qx, qy);
  return mercatorToLngLat(mx, my);
}

/** Local metres per grid step for a tile (x east, z south). */
export function gridStepMeters(id: TileId, extentLog2: number): number {
  return metersPerMercatorUnit(tileCenterLngLat(id)[1]) / gridScale(id, extentLog2);
}

export function fitsInt16(q: number): boolean {
  return q >= QUANT_MIN && q <= QUANT_MAX;
}

/** Local metres of a tile (x east, z south, origin at the tile centre) for a lng/lat. */
export function lngLatToTileMeters(id: TileId, lngLat: LngLat): [x: number, z: number] {
  const [mx, my] = lngLatToMercator(lngLat);
  const [cx, cy] = tileCenterMercator(id);
  const s = metersPerMercatorUnit(tileCenterLngLat(id)[1]);
  return [(mx - cx) * s, (my - cy) * s];
}

export function tileMetersToLngLat(id: TileId, x: number, z: number): LngLat {
  const [cx, cy] = tileCenterMercator(id);
  const s = metersPerMercatorUnit(tileCenterLngLat(id)[1]);
  return mercatorToLngLat(cx + x / s, cy + z / s);
}

/**
 * Column-major 4x4 matrix that maps tile-local metres into a world whose origin is `anchor` and whose unit is one
 * metre at the anchor latitude (01 section 6.4). Uniform scale = anchor scale / tile scale.
 */
export function tileToWorldMatrix(id: TileId, anchor: LngLat): number[] {
  const [amx, amy] = lngLatToMercator(anchor);
  const [cx, cy] = tileCenterMercator(id);
  const anchorScale = metersPerMercatorUnit(anchor[1]);
  const s = anchorScale / metersPerMercatorUnit(tileCenterLngLat(id)[1]);
  const tx = (cx - amx) * anchorScale;
  const tz = (cy - amy) * anchorScale;
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, tx, 0, tz, 1];
}
