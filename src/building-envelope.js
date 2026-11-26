import clipping from 'polygon-clipping';
import { inside } from './osm.js';

// Work in metres. A sub-millimetre probe distinguishes contact from interior;
// it does not move the observed outline or hide legitimate narrow alleys.
const EPS = 0.0005;
const rings = (b) => [b.outer, ...(b.holes || [])];
const contains = (b, p) => inside(p, b.outer) && !(b.holes || []).some((h) => inside(p, h));
const priority = (a, b) => a.height - b.height || String(a.id).localeCompare(String(b.id));

/** The exposed boundary of overlapping OSM extrusions, without modifying data.
 * Curved/custom landmarks may opt out because their footprint is not a solid
 * vertical prism. Spatial buckets keep dense low-rise datasets local.
 */
export function planBuildingEnvelopes(buildings, { exclude = () => false, lazyCaps = false } = {}) {
  const entries = buildings
    .filter((b) => !exclude(b))
    .map((b) => ({
      b,
      box: b.outer.reduce(
        (r, p) => [Math.min(r[0], p[0]), Math.min(r[1], p[1]), Math.max(r[2], p[0]), Math.max(r[3], p[1])],
        [Infinity, Infinity, -Infinity, -Infinity],
      ),
    }));
  const grid = new Map(),
    size = 80;
  const keys = (box) => {
    const result = [];
    for (let x = Math.floor((box[0] - EPS) / size); x <= Math.floor((box[2] + EPS) / size); x++)
      for (let z = Math.floor((box[1] - EPS) / size); z <= Math.floor((box[3] + EPS) / size); z++)
        result.push(`${x},${z}`);
    return result;
  };
  for (const e of entries)
    for (const k of keys(e.box)) {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
    }
  const plans = new Map();
  for (const { b, box } of entries) {
    const neighbors = [...new Set(keys(box).flatMap((k) => grid.get(k) || []))]
      .filter(
        (e) =>
          e.b !== b &&
          e.box[2] >= box[0] - EPS &&
          e.box[0] <= box[2] + EPS &&
          e.box[3] >= box[1] - EPS &&
          e.box[1] <= box[3] + EPS,
      )
      .map((e) => e.b);
    const cap = (height, up) => {
      const blockers = neighbors.filter((n) =>
        up
          ? n.minHeight <= height + EPS &&
            (n.height > height + EPS || (Math.abs(n.height - height) < EPS && priority(n, b) > 0))
          : n.height >= height - EPS &&
            (n.minHeight < height - EPS || (Math.abs(n.minHeight - height) < EPS && priority(n, b) > 0)),
      );
      return blockers.length ? clipping.difference(rings(b), ...blockers.map(rings)) : [rings(b)];
    };
    function wall(a, c, normal) {
      const dx = c[0] - a[0],
        dz = c[1] - a[1],
        length = Math.hypot(dx, dz),
        cuts = [0, 1];
      if (length < EPS) return [];
      if (!neighbors.length) return [{ t0: 0, t1: 1, lo: b.minHeight, hi: b.height }];
      // Split at every footprint crossing, including endpoints of shared walls.
      for (const n of neighbors)
        for (const ring of rings(n))
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i],
              q = ring[(i + 1) % ring.length],
              ex = q[0] - p[0],
              ez = q[1] - p[1],
              px = p[0] - a[0],
              pz = p[1] - a[1],
              den = dx * ez - dz * ex;
            if (Math.abs(den) > 1e-10) {
              const t = (px * ez - pz * ex) / den,
                u = (px * dz - pz * dx) / den;
              if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
            } else if (Math.abs(px * dz - pz * dx) / length < EPS)
              for (const point of [p, q]) {
                const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (length * length);
                if (t > 0 && t < 1) cuts.push(t);
              }
          }
      const ordered = [...new Set(cuts.map((t) => (t * length < EPS ? 0 : (1 - t) * length < EPS ? 1 : t)))].sort(
          (a, b) => a - b,
        ),
        spans = [];
      for (let i = 1; i < ordered.length; i++) {
        const t0 = ordered[i - 1],
          t1 = ordered[i];
        if ((t1 - t0) * length < EPS) continue;
        const mid = [a[0] + (dx * (t0 + t1)) / 2, a[1] + (dz * (t0 + t1)) / 2];
        const out = [mid[0] + normal[0] * EPS, mid[1] + normal[2] * EPS],
          inward = [mid[0] - normal[0] * EPS, mid[1] - normal[2] * EPS];
        let heights = [[b.minHeight, b.height]];
        for (const n of neighbors) {
          // Interior or opposite-facing contact removes both hidden skins.
          // Same-facing coplanar skins have one deterministic owner.
          if (!contains(n, out) && !(contains(n, inward) && priority(n, b) > 0)) continue;
          heights = heights.flatMap(([lo, hi]) =>
            n.height <= lo || n.minHeight >= hi
              ? [[lo, hi]]
              : [
                  [lo, Math.min(hi, n.minHeight)],
                  [Math.max(lo, n.height), hi],
                ].filter(([l, h]) => h - l > EPS),
          );
        }
        for (const [lo, hi] of heights) spans.push({ t0, t1, lo, hi });
      }
      return spans;
    }
    let roof, bottom;
    // Tile generation may skip bottom caps and sloped roofs. All inputs remain owned by the synchronous build.
    const plan = lazyCaps
      ? {
          wall,
          neighbors: neighbors.length,
          get roof() {
            return (roof ??= cap(b.height, true));
          },
          get bottom() {
            return (bottom ??= cap(b.minHeight, false));
          },
        }
      : { wall, roof: cap(b.height, true), bottom: cap(b.minHeight, false), neighbors: neighbors.length };
    plans.set(b.id, plan);
  }
  return plans;
}
