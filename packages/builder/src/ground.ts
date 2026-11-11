// Per-tile union of flat ground fragments (phase-one road planning emits one fragment per segment).
import clipping from 'polygon-clipping';
import { tileKey } from '@city-ink/tiles';
import type { FeatureLayerInput, TileFeature, TileInput } from '@city-ink/tiles';
import { ringArea } from './clip.js';
import type { G } from './clip.js';
import { hash52 } from './plan.js';

function toPairs(ring: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ring[i]!, ring[i + 1]!]);
  out.push([ring[0]!, ring[1]!]);
  return out;
}

/**
 * Unions flat ground pieces with equal kind and elevation (1/16 m steps) into one multipolygon feature per group.
 * Ramps and paint keep their own features. Coverage is unchanged; only the encoding gets smaller.
 */
export function mergeFlatGround(t: TileInput): void {
  const layer = t.layers.ground as FeatureLayerInput | undefined;
  if (!layer || !layer.features.length) return;
  const groups = new Map<string, { kind: string; level: number; polys: [number, number][][][] }>();
  const kept: TileFeature[] = [];
  for (const f of layer.features) {
    const heights = (f.elevation ?? []).flat(2);
    const level = heights.length ? Math.round(heights[0]! * 16) : 0;
    const flat = heights.every((h) => Math.round(h * 16) === level);
    const kind = String(f.properties?.kind ?? 'pavement');
    if (!flat || kind === 'marking') {
      kept.push(f);
      continue;
    }
    const key = `${kind}:${level}`;
    const g = groups.get(key) ?? { kind, level, polys: [] };
    for (const part of f.geometry) g.polys.push(part.map((ring) => toPairs(ring)));
    groups.set(key, g);
  }
  for (const [key, g] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let merged: [number, number][][][];
    try {
      merged = clipping.union(...(g.polys as unknown as Parameters<typeof clipping.union>)) as [number, number][][][];
    } catch {
      merged = g.polys; // keep the pieces rather than drop them if the union fails on degenerate input
    }
    const geometry: number[][][] = [];
    for (const poly of merged) {
      const rings = poly
        .map((ring) => {
          const out: [number, number][] = [];
          for (const [x, y] of ring) {
            const p: [number, number] = [Math.round(x), Math.round(y)];
            const last = out.at(-1);
            if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
          }
          if (out.length > 1 && out[0]![0] === out.at(-1)![0] && out[0]![1] === out.at(-1)![1]) out.pop();
          return out;
        })
        .filter((ring) => ring.length >= 3 && Math.abs(ringArea(ring as G[])) >= 0.5);
      if (rings.length && rings[0] === undefined) continue;
      if (rings.length) geometry.push(rings.map((r) => r.flat()));
    }
    if (!geometry.length) continue;
    kept.push({
      id: `generated/${hash52(`${tileKey(t.id)}:ground:${key}`)}`,
      renderId: 0,
      geometry,
      elevation: geometry.map((part) => part.map((ring) => new Array<number>(ring.length / 2).fill(g.level / 16))),
      properties: { kind: g.kind },
      provenance: {},
      tags: {},
    });
  }
  layer.features = kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
