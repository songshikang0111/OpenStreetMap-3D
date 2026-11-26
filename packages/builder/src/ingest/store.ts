// Write each filtered OSM object once. Only offsets, extents and road-group memberships remain resident.
// Cell queries read neighbouring objects from disk with the full project's projection and crop.
import { openSync, closeSync, writeSync, readSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { tilesInBounds, tileKey } from '@city-ink/tiles';
import type { Bounds } from '@city-ink/tiles';
import { boundsIntersect } from '../geo.js';

interface OsmRow {
  id: number;
  type: string;
  tags: Record<string, string>;
  nodes?: number[];
  members?: { type: string; ref: number }[];
}
interface Ref {
  at: number;
  bytes: number;
  bounds: Bounds;
  name?: string;
  gradeNodes?: number[];
  buildingKind?: 'outline' | 'part';
}

interface Index {
  region?: Bounds;
  refs: Ref[];
  buckets: Map<string, number[]>;
  names: Map<string, number[]>;
  gradeNodes: Map<number, number[]>;
  water: number[];
  waterWays: Set<number>;
  memberships: { index: number; ways: number[] }[];
}
export class FeatureStore {
  private readonly file: string;
  private writer: number;
  private cursor = 0;
  private region?: Bounds;
  private readonly refs: Ref[] = [];
  private readonly buckets = new Map<string, number[]>();
  private readonly names = new Map<string, number[]>();
  private readonly gradeNodes = new Map<number, number[]>();
  private readonly water: number[] = [];
  private readonly waterWays = new Set<number>();
  private readonly memberships: { index: number; ways: number[] }[] = [];
  constructor(cache: string, index?: Buffer) {
    mkdirSync(cache, { recursive: true });
    this.file = path.join(cache, 'features.ndjson');
    if (index) {
      const saved: Index = deserialize(index);
      if (saved.region) this.region = saved.region;
      this.refs = saved.refs;
      this.buckets = saved.buckets;
      this.names = saved.names;
      this.gradeNodes = saved.gradeNodes;
      this.water = saved.water;
      this.waterWays = saved.waterWays;
      this.memberships = saved.memberships;
      this.writer = -1;
    } else this.writer = openSync(this.file, 'w');
  }
  index(): Buffer {
    return serialize({
      ...(this.region ? { region: this.region } : {}),
      refs: this.refs,
      buckets: this.buckets,
      names: this.names,
      gradeNodes: this.gradeNodes,
      water: this.water,
      waterWays: this.waterWays,
      memberships: this.memberships,
    } satisfies Index);
  }
  close() {
    if (this.writer >= 0) {
      closeSync(this.writer);
      this.writer = -1;
    }
  }
  add(row: OsmRow, bounds: Bounds, region: Bounds) {
    this.region = region;
    const buf = Buffer.from(JSON.stringify(row) + '\n');
    let n = 0;
    while (n < buf.length) n += writeSync(this.writer, buf, n, buf.length - n);
    const index = this.refs.length;
    const ref: Ref = { at: this.cursor, bytes: buf.length, bounds };
    this.refs.push(ref);
    this.cursor += buf.length;
    const add = <K>(map: Map<K, number[]>, key: K) => {
      const list = map.get(key);
      if (list) list.push(index);
      else map.set(key, [index]);
    };
    const [w, s, e, north] = region;
    // Clamp long coastlines to the actual project, where cells can query them. Include degenerate point extents.
    const box: Bounds = [
      Math.max(w, Math.min(e, bounds[0])),
      Math.max(s, Math.min(north, bounds[1])),
      Math.max(w, Math.min(e, bounds[2])),
      Math.max(s, Math.min(north, bounds[3])),
    ];
    for (const key of this.keys(box)) add(this.buckets, key);
    const t = row.tags;
    if (t['building:part'] && t['building:part'] !== 'no') ref.buildingKind = 'part';
    else if (t.building && t.building !== 'no') ref.buildingKind = 'outline';
    if (t.highway && t.name) {
      ref.name = t.name;
      add(this.names, t.name);
    }
    if (row.nodes && (t.bridge === 'yes' || Number(t.layer) > 0 || t.highway === 'steps')) {
      ref.gradeNodes = row.nodes;
      for (const id of new Set(row.nodes)) add(this.gradeNodes, id);
    }
    if (
      t.natural === 'water' ||
      t.amenity === 'fountain' ||
      t.leisure === 'swimming_pool' ||
      t.waterway === 'riverbank'
    ) {
      this.water.push(index);
      if (row.type === 'way') this.waterWays.add(row.id);
    }
    if (row.members)
      this.memberships.push({ index, ways: row.members.filter((m) => m.type === 'way').map((m) => m.ref) });
  }
  private keys(b: Bounds) {
    // Cover both sides of exact integer-grid boundaries, including a single point.
    const epsilon = 1e-10;
    const bounds: Bounds = [
      Math.max(-180, b[0] - epsilon),
      Math.max(-80, b[1] - epsilon),
      Math.min(180, b[2] + epsilon),
      Math.min(80, b[3] + epsilon),
    ];
    return tilesInBounds(bounds, 13).map(tileKey);
  }
  private read(indices: Set<number>): unknown[] {
    const fd = openSync(this.file, 'r');
    try {
      return [...indices]
        .sort((a, b) => a - b)
        .map((i) => {
          const r = this.refs[i]!,
            buf = Buffer.allocUnsafe(r.bytes);
          let n = 0;
          while (n < buf.length) {
            const got = readSync(fd, buf, n, buf.length - n, r.at + n);
            if (!got) throw new Error('Truncated PBF feature store.');
            n += got;
          }
          return JSON.parse(buf.toString('utf8'));
        });
    } finally {
      closeSync(fd);
    }
  }
  /** Merge water once for the project, so neighbouring cells reference the same topology and identities. */
  waterInput() {
    const indices = new Set(this.water);
    for (const { index, ways } of this.memberships) if (ways.some((id) => this.waterWays.has(id))) indices.add(index);
    return this.read(indices);
  }
  neighbourhood(bounds: Bounds) {
    const indices = new Set<number>();
    if (!this.region || !boundsIntersect(this.region, bounds)) return [];
    const region = this.region;
    const boundedKeys = (box: Bounds) =>
      this.keys([
        Math.max(box[0], region[0]),
        Math.max(box[1], region[1]),
        Math.min(box[2], region[2]),
        Math.min(box[3], region[3]),
      ]);
    for (const key of boundedKeys(bounds))
      for (const i of this.buckets.get(key) ?? []) if (boundsIntersect(bounds, this.refs[i]!.bounds)) indices.add(i);
    const names = new Set<string>(),
      queue: number[] = [];
    for (const i of indices) {
      const r = this.refs[i]!;
      // Phase-one outline suppression uses all tagged parts within the outline, even beyond the
      // active halo. Read those candidates when a retained outline extends outside the query.
      if (
        r.buildingKind === 'outline' &&
        (r.bounds[0] < bounds[0] || r.bounds[1] < bounds[1] || r.bounds[2] > bounds[2] || r.bounds[3] > bounds[3]) &&
        boundsIntersect(r.bounds, region)
      ) {
        for (const key of boundedKeys(r.bounds))
          for (const j of this.buckets.get(key) ?? []) {
            const candidate = this.refs[j]!;
            if (candidate.buildingKind === 'part' && boundsIntersect(r.bounds, candidate.bounds)) indices.add(j);
          }
      }
      if (r.name) names.add(r.name);
      if (r.gradeNodes) queue.push(i);
    }
    // Preserve the deterministic named-road planting stream and complete connected grade groups.
    const visitedGrades = new Set(queue);
    for (const name of names) for (const i of this.names.get(name)!) indices.add(i);
    for (let i = 0; i < queue.length; i++)
      for (const node of this.refs[queue[i]!]!.gradeNodes!)
        for (const j of this.gradeNodes.get(node)!)
          if (!visitedGrades.has(j)) {
            indices.add(j);
            visitedGrades.add(j);
            queue.push(j);
          }
    return this.read(indices);
  }
}
