// PBF ingest (WP-F task F2): three streaming passes over the file (relations, then ways, then nodes; decision E12),
// node coordinates in sorted typed arrays, output in the phase-one Overpass "out body geom" shape so the existing
// normalisation, parsing and planning run unchanged.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readPbf } from './pbf.js';
import type { PbfRelation, PbfWay } from './pbf.js';
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

/**
 * Reads the kept OSM features of `file` inside `bbox` (west, south, east, north; default: the file's header box).
 * Ways are kept when any node lies in the box (expanded by `marginDeg`), together with every member way of a kept
 * relation, so outlines that cross the box stay complete.
 */
export async function ingestPbf(
  file: string,
  options: { bbox?: [number, number, number, number]; marginDeg?: number; onProgress?(stage: string): void } = {},
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

  // Pass 1: relations of interest and the ways they need.
  options.onProgress?.('relations');
  const relations: PbfRelation[] = [];
  const memberWays = new Set<number>();
  const header = await readPbf(file, {
    relation(r) {
      if (!wantedRelation(r.tags)) return;
      relations.push(r);
      for (const m of r.members) if (m.type === 'way') memberWays.add(m.ref);
    },
  });
  const bbox = options.bbox ?? header.bbox;
  if (!bbox) throw new IngestError('TILES_BBOX_MISSING', 'The PBF has no header bbox.', 'Pass --bbox w,s,e,n.');
  const area = bboxAreaKm2(bbox);
  if (area > MAX_AREA_KM2)
    throw new IngestError(
      'BUILD_AREA_TOO_LARGE',
      `The build area is ${area.toFixed(0)} km²; the supported maximum is ${MAX_AREA_KM2} km².`,
      'Pass a smaller --bbox, or clip the file with `osmium extract -b ...`.',
    );
  count('relations', relations.length);

  // Pass 2: ways (tag filter or relation member) and their node ids.
  options.onProgress?.('ways');
  const ways: PbfWay[] = [];
  let refCount = 0;
  await readPbf(file, {
    way(w) {
      if (!wantedWay(w.tags) && !memberWays.has(w.id)) return;
      ways.push(w);
      refCount += w.refs.length;
    },
  });
  count('waysRead', ways.length);
  const ids = new Float64Array(refCount);
  let k = 0;
  for (const w of ways) for (const r of w.refs) ids[k++] = r;
  ids.sort();
  let unique = 0;
  for (let i = 0; i < ids.length; i++) if (!i || ids[i] !== ids[unique - 1]) ids[unique++] = ids[i]!;
  const nodeIds = ids.subarray(0, unique);
  const lat = new Float64Array(unique).fill(NaN);
  const lon = new Float64Array(unique).fill(NaN);
  const find = (id: number) => {
    let lo = 0,
      hi = unique - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = nodeIds[mid]!;
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };

  // Pass 3: node coordinates and tagged point features.
  options.onProgress?.('nodes');
  const [w0, s0, e0, n0] = bbox;
  const inBox = (la: number, lo: number, m = 0) => lo >= w0 - m && lo <= e0 + m && la >= s0 - m && la <= n0 + m;
  const elements: unknown[] = [];
  await readPbf(file, {
    wantNodeTags: true,
    node(id, la, lo, tags) {
      const i = find(id);
      if (i >= 0) {
        lat[i] = la;
        lon[i] = lo;
      }
      if (tags && wantedNode(tags) && inBox(la, lo)) {
        elements.push({ type: 'node', id, lat: la, lon: lo, tags });
        count('nodes');
      }
    },
  });

  const margin = options.marginDeg ?? 0.002;
  const geometry = (w: PbfWay) => {
    const g: { lat: number; lon: number }[] = [];
    for (const r of w.refs) {
      const i = find(r);
      if (i < 0 || Number.isNaN(lat[i]!)) return null;
      g.push({ lat: lat[i]!, lon: lon[i]! });
    }
    return g;
  };
  const bounds = (g: { lat: number; lon: number }[]) => {
    let minlat = Infinity,
      minlon = Infinity,
      maxlat = -Infinity,
      maxlon = -Infinity;
    for (const p of g) {
      minlat = Math.min(minlat, p.lat);
      maxlat = Math.max(maxlat, p.lat);
      minlon = Math.min(minlon, p.lon);
      maxlon = Math.max(maxlon, p.lon);
    }
    return { minlat, minlon, maxlat, maxlon };
  };
  const wayGeometry = new Map<number, { lat: number; lon: number }[]>();
  for (const w of ways) {
    const g = geometry(w);
    if (!g || g.length < 2) {
      count('waysIncomplete');
      continue;
    }
    if (memberWays.has(w.id)) wayGeometry.set(w.id, g);
    if (!wantedWay(w.tags) || !g.some((p) => inBox(p.lat, p.lon, margin))) continue;
    elements.push({ type: 'way', id: w.id, bounds: bounds(g), nodes: w.refs, geometry: g, tags: w.tags });
    count('ways');
  }
  for (const r of relations) {
    const members: unknown[] = [];
    let inside = false,
      missing = 0;
    for (const m of r.members) {
      if (m.type !== 'way') continue;
      const g = wayGeometry.get(m.ref);
      if (!g) {
        missing++;
        continue;
      }
      if (!inside && g.some((p) => inBox(p.lat, p.lon, margin))) inside = true;
      members.push({ type: 'way', ref: m.ref, role: m.role, geometry: g });
    }
    if (!inside || !members.length) continue;
    if (missing) count('relationsIncomplete');
    elements.push({ type: 'relation', id: r.id, members, tags: r.tags });
    count('relationsKept');
  }
  ways.length = 0;
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
    stats: { ...stats, nodeRefs: unique },
  };
}
