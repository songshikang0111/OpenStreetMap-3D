import { NodeCoordinates } from './nodes.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readPbf } from './pbf.js';
import type { PbfRelation } from './pbf.js';
import { wantedNode, wantedRelation, wantedWay } from './filter.js';

/** Supported scale (03 section 2). Larger inputs are rejected with a hint to clip first. */
export const MAX_PBF_BYTES = 1024 ** 3;
export const MAX_AREA_KM2 = 5000;

export interface PbfIngestResult {
  raw: { elements: unknown[]; metadata: Record<string, unknown> };
  bbox: [number, number, number, number];
  sha256: string;
  bytes: number;
  timestamp: string | undefined;
  stats: Record<string, number>;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export function bboxAreaKm2([w, s, e, n]: [number, number, number, number]): number {
  const k = 111.32;
  return (e - w) * k * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57;
}

export class IngestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** Stream node coordinates and relation memberships first, then resolve and spatially filter each way. */
export async function ingestPbf(
  file: string,
  options: {
    bbox?: [number, number, number, number];
    marginDeg?: number;
    checkBudget?(): void;
    onProgress?(stage: string): void;
  } = {},
): Promise<PbfIngestResult> {
  const bytes = (await stat(file)).size;
  if (bytes > MAX_PBF_BYTES)
    throw new IngestError(
      'PBF_TOO_LARGE',
      `${file} is ${(bytes / 1024 ** 2).toFixed(0)} MB; the supported maximum is 1 GB.`,
      'Clip it first, e.g. `osmium extract -b west,south,east,north in.osm.pbf -o city.osm.pbf`.',
    );
  const stats: Record<string, number> = {};
  const count = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  const relations: PbfRelation[] = [];
  const memberWays = new Set<number>();
  const nodes = new NodeCoordinates();
  let bbox = options.bbox;
  const elements: unknown[] = [];
  const validateBounds = () => {
    if (!bbox) throw new IngestError('TILES_BBOX_MISSING', 'The PBF has no header bbox.', 'Pass --bbox w,s,e,n.');
    const [w, s, e, n] = bbox;
    if (!bbox.every(Number.isFinite) || w < -180 || e > 180 || s < -80 || n > 80 || w >= e || s >= n)
      throw new IngestError(
        'TILES_BBOX_INVALID',
        'Invalid WGS84 build bounds.',
        'Pass west,south,east,north inside ±80° latitude and avoid crossing the antimeridian.',
      );
    const area = bboxAreaKm2(bbox);
    if (area > MAX_AREA_KM2)
      throw new IngestError(
        'BUILD_AREA_TOO_LARGE',
        `The build area is ${area.toFixed(0)} km²; the supported maximum is ${MAX_AREA_KM2} km².`,
        'Pass a smaller --bbox, or clip the file with `osmium extract -b ...`.',
      );
  };
  if (bbox) validateBounds();
  options.onProgress?.('nodes and relations');
  const header = await readPbf(file, {
    ...(options.checkBudget ? { onBlock: options.checkBudget } : {}),
    header(h) {
      bbox ??= h.bbox ?? undefined;
      validateBounds();
    },
    wantNodeTags: true,
    node(id, lat, lon, tags) {
      nodes.add(id, lat, lon);
      if (tags && wantedNode(tags) && bbox && lon >= bbox[0] && lat >= bbox[1] && lon <= bbox[2] && lat <= bbox[3]) {
        elements.push({ type: 'node', id, lat, lon, tags });
        count('nodes');
      }
    },
    relation(r) {
      if (!wantedRelation(r.tags)) return;
      relations.push(r);
      for (const m of r.members) if (m.type === 'way') memberWays.add(m.ref);
    },
  });
  if (!bbox) throw new IngestError('TILES_BBOX_MISSING', 'No PBF bounds were supplied.', 'Pass --bbox w,s,e,n.');
  type Extent = { minlat: number; minlon: number; maxlat: number; maxlon: number };
  const emptyExtent = (): Extent => ({ minlat: Infinity, minlon: Infinity, maxlat: -Infinity, maxlon: -Infinity });
  const [west, south, east, north] = bbox;
  const margin = options.marginDeg ?? 0.002;
  const overlaps = (b: Extent) =>
    b.minlon <= east + margin && b.maxlon >= west - margin && b.minlat <= north + margin && b.maxlat >= south - margin;
  const geometry = (refs: number[]) =>
    refs.map((ref) => {
      const p = { lat: 0, lon: 0 };
      nodes.get(ref, p);
      return p;
    });
  const members = new Map<number, { refs: number[]; bounds: Extent }>();
  options.onProgress?.('ways');
  await readPbf(file, {
    ...(options.checkBudget ? { onBlock: options.checkBudget } : {}),
    way(w) {
      const wanted = wantedWay(w.tags);
      if (!wanted && !memberWays.has(w.id)) return;
      count('waysRead');
      const bounds = emptyExtent();
      const p = { lat: 0, lon: 0 };
      if (w.refs.length < 2) return;
      for (const id of w.refs) {
        if (!nodes.get(id, p)) {
          count('waysIncomplete');
          return;
        }
        bounds.minlat = Math.min(bounds.minlat, p.lat);
        bounds.maxlat = Math.max(bounds.maxlat, p.lat);
        bounds.minlon = Math.min(bounds.minlon, p.lon);
        bounds.maxlon = Math.max(bounds.maxlon, p.lon);
      }
      if (memberWays.has(w.id)) members.set(w.id, { refs: w.refs, bounds });
      // A polygon can surround the box, or a road can cross it with every vertex outside. Phase-one parsing
      // performs the exact clip. The conservative envelope test here preserves both cases.
      if (!wanted || !overlaps(bounds)) return;
      elements.push({ type: 'way', id: w.id, bounds, nodes: w.refs, geometry: geometry(w.refs), tags: w.tags });
      count('ways');
    },
  });
  const nearbyPolygons = new Set(
    relations
      .filter(
        (r) =>
          r.tags.type === 'multipolygon' &&
          r.members.some((m) => m.type === 'way' && members.has(m.ref) && overlaps(members.get(m.ref)!.bounds)),
      )
      .map((r) => r.id),
  );
  for (const r of relations) {
    const bounds = emptyExtent();
    for (const m of r.members) {
      if (m.type !== 'way') continue;
      const b = members.get(m.ref)?.bounds;
      if (!b) continue;
      bounds.minlat = Math.min(bounds.minlat, b.minlat);
      bounds.maxlat = Math.max(bounds.maxlat, b.maxlat);
      bounds.minlon = Math.min(bounds.minlon, b.minlon);
      bounds.maxlon = Math.max(bounds.maxlon, b.maxlon);
    }
    const building = r.tags.type === 'building';
    if (!overlaps(bounds) && !(building && r.members.some((m) => m.type === 'relation' && nearbyPolygons.has(m.ref))))
      continue;
    // Membership is sufficient here: the tagged ways/multipolygons carry their own geometry.
    if (building) {
      elements.push({ type: 'relation', id: r.id, members: r.members, tags: r.tags });
      continue;
    }
    let incomplete = false;
    const ways = r.members
      .filter((m) => m.type === 'way')
      .map((m) => {
        const entry = members.get(m.ref);
        if (!entry) {
          incomplete = true;
          return m;
        }
        return { ...m, geometry: geometry(entry.refs) };
      });
    if (incomplete) count('relationsIncomplete');
    elements.push({ type: 'relation', id: r.id, members: ways, tags: r.tags });
  }
  count('relations', relations.length);
  const timestamp = header.replicationTimestamp
    ? new Date(header.replicationTimestamp * 1000).toISOString().replace(/\.000Z$/, 'Z')
    : undefined;
  const [w, s, e, n] = bbox;
  return {
    raw: {
      elements,
      metadata: {
        bbox: [s, w, n, e],
        center: [(s + n) / 2, (w + e) / 2],
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
        source: 'pbf',
        ...(timestamp ? { timestamp } : {}),
      },
    },
    bbox,
    sha256: await sha256File(file),
    bytes,
    timestamp,
    stats: { ...stats, indexedNodes: nodes.size },
  };
}
