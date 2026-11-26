// Reserve a complete cover first; a refinement replaces one visible parent with every requested sibling.
import { parentTile, tileKey } from '@city-ink/tiles';
import type { DesiredTile } from './selection.js';

export interface TileCost {
  bytes: number;
  triangles: number;
  draws: number;
  /** The source is resident, but the first Worker result has not supplied the full geometry cost yet. */
  sourceOnly?: boolean;
}
const unknown: TileCost = { bytes: 0, triangles: 0, draws: 0, sourceOnly: true };

export function fitRefinements(
  leaves: DesiredTile[],
  zooms: number[],
  costs: ReadonlyMap<string, TileCost>,
  ready: (key: string) => boolean,
  previous: ReadonlySet<string>,
  limits: TileCost,
  unavailable: (key: string) => boolean = () => false,
): { leaves: DesiredTile[]; refined: Set<string>; rootCost: TileCost } {
  const levels = zooms.map(() => new Map<string, DesiredTile>());
  const siblings = new Map<string, DesiredTile[]>();
  for (const leaf of leaves) {
    let child = leaf;
    for (let level = leaf.level; level >= 0; level--) {
      // Leaves arrive nearest first, so the first descendant sets the group's load priority.
      if (levels[level]!.has(child.key)) break;
      levels[level]!.set(child.key, child);
      if (!level) break;
      const id = parentTile(child.id, zooms[level - 1]!);
      const key = tileKey(id);
      const group = siblings.get(key) ?? [];
      group.push(child);
      siblings.set(key, group);
      child = { id, key, level: level - 1, priority: leaf.priority, sse: 0 };
    }
  }
  const visible = new Map(levels[0]);
  const refined = new Set<string>();
  let bytes = 0,
    triangles = 0,
    draws = 0;
  for (const root of visible.values()) {
    const cost = costs.get(root.key) ?? unknown;
    bytes += cost.bytes;
    triangles += cost.triangles;
    draws += cost.draws;
  }
  const rootCost = { bytes, triangles, draws };
  // Prefer nearby regions. A small priority advantage for an admitted group suppresses switching
  // across the equal-distance boundary during tiny camera movements.
  const priority = (d: DesiredTile) => d.priority * (previous.has(d.key) ? 0.85 : 1);
  let probing = false;
  for (const level of levels) {
    const candidates = [...level.values()]
      .filter((d) => siblings.has(d.key) && visible.has(d.key))
      .sort((a, b) => Number(ready(a.key)) - Number(ready(b.key)) || priority(a) - priority(b));
    for (const parent of candidates) {
      const group = siblings.get(parent.key)!;
      const before = costs.get(parent.key) ?? unknown;
      let extraBytes = 0,
        extraTriangles = -before.triangles,
        extraDraws = -before.draws;
      for (const c of group) {
        const cost = costs.get(c.key) ?? unknown;
        // Parent data remains resident as the fallback even after it stops drawing.
        // A first fetch already retains its input while its worker is still measuring the geometry.
        extraBytes += cost.bytes;
        extraTriangles += cost.triangles;
        extraDraws += cost.draws;
      }
      if (
        ready(parent.key) &&
        (bytes + extraBytes > limits.bytes ||
          triangles + extraTriangles > limits.triangles ||
          draws + extraDraws > limits.draws)
      )
        continue;
      // Probe one incomplete group at a time when a parent supplies cover. Learning the near
      // group's actual cost may rule out farther groups before their workers start.
      const unknownChildren = group.some((c) => (costs.get(c.key) ?? unknown).sourceOnly && !unavailable(c.key));
      if (unknownChildren && ready(parent.key)) {
        if (probing) continue;
        probing = true;
      }
      bytes += extraBytes;
      triangles += extraTriangles;
      draws += extraDraws;
      refined.add(parent.key);
      visible.delete(parent.key);
      for (const c of group) visible.set(c.key, c);
    }
  }
  return { leaves: [...visible.values()].sort((a, b) => a.priority - b.priority), refined, rootCost };
}
