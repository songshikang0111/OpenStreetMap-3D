// Axis-aligned clipping in global grid coordinates. Intersections are computed from canonically ordered segment
// endpoints so that two tiles sharing an edge compute bit-identical cut points (AC307).

export type G = [number, number];
export type Rect = [x0: number, y0: number, x1: number, y1: number];

/** Intersection of segment p-q with the vertical line x = X (endpoints ordered canonically). */
function atX(p: G, q: G, X: number): G {
  const [a, b] = p[0] < q[0] || (p[0] === q[0] && p[1] <= q[1]) ? [p, q] : [q, p];
  return [X, a[1] + ((X - a[0]) * (b[1] - a[1])) / (b[0] - a[0])];
}

function atY(p: G, q: G, Y: number): G {
  const [a, b] = p[1] < q[1] || (p[1] === q[1] && p[0] <= q[0]) ? [p, q] : [q, p];
  return [a[0] + ((Y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), Y];
}

/** Parameter t of point r on segment p-q (0 at p), from the dominant axis. */
function paramOf(p: G, q: G, r: G): number {
  const dx = q[0] - p[0],
    dy = q[1] - p[1];
  return Math.abs(dx) >= Math.abs(dy) ? (r[0] - p[0]) / dx : (r[1] - p[1]) / dy;
}

type Edge = { inside: (p: G) => boolean; cut: (p: G, q: G) => G };

function edges(r: Rect): Edge[] {
  return [
    { inside: (p) => p[0] >= r[0], cut: (p, q) => atX(p, q, r[0]) },
    { inside: (p) => p[0] <= r[2], cut: (p, q) => atX(p, q, r[2]) },
    { inside: (p) => p[1] >= r[1], cut: (p, q) => atY(p, q, r[1]) },
    { inside: (p) => p[1] <= r[3], cut: (p, q) => atY(p, q, r[3]) },
  ];
}

interface V {
  p: G;
  /** Original input edge this vertex lies on (cut points only). */
  line?: [G, G];
}

/**
 * Sutherland–Hodgman clip of a closed ring (no repeated end point). Every cut is computed from the original input
 * edge, never from a previously cut point, so results do not depend on which rectangle edges were applied first.
 */
export function clipRing(ring: G[], rect: Rect): G[] {
  let out: V[] = ring.map((p) => ({ p }));
  for (const e of edges(rect)) {
    if (!out.length) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!,
        prev = input[(i + input.length - 1) % input.length]!;
      const ci = e.inside(cur.p),
        pi = e.inside(prev.p);
      if (ci === pi) {
        if (ci) out.push(cur);
        continue;
      }
      const sameLine = prev.line && cur.line && prev.line === cur.line;
      const line: [G, G] = sameLine
        ? prev.line!
        : prev.line && !cur.line
          ? prev.line
          : cur.line && !prev.line
            ? cur.line
            : [prev.p, cur.p];
      const cut: V = { p: e.cut(line[0], line[1]), line };
      if (ci) out.push(cut, cur);
      else out.push(cut);
    }
  }
  return out.map((v) => v.p);
}

export function ringArea(ring: G[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Clips one segment (Liang–Barsky on canonical order). Returns the clipped segment in the original direction. */
export function clipSegment(p: G, q: G, r: Rect): { a: G; b: G; ta: number; tb: number } | null {
  const flip = !(p[0] < q[0] || (p[0] === q[0] && p[1] <= q[1]));
  const [a, b] = flip ? [q, p] : [p, q];
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let t0 = 0,
    t1 = 1;
  const P = [-dx, dx, -dy, dy];
  const Q = [a[0] - r[0], r[2] - a[0], a[1] - r[1], r[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) {
      if (Q[i]! < 0) return null;
    } else {
      const t = Q[i]! / P[i]!;
      if (P[i]! < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (t0 > t1) return null;
  }
  // Points on a rectangle edge use the exact edge coordinate for the clipped axis.
  const point = (t: number): G => {
    if (t === 0) return a;
    if (t === 1) return b;
    const x = a[0] + dx * t,
      y = a[1] + dy * t;
    for (const X of [r[0], r[2]]) if (Math.abs(x - X) < 1e-9 && dx !== 0) return atX(a, b, X);
    for (const Y of [r[1], r[3]]) if (Math.abs(y - Y) < 1e-9 && dy !== 0) return atY(a, b, Y);
    return [x, y];
  };
  const A = point(t0),
    B = point(t1);
  if (t1 - t0 <= 0) return null;
  return flip ? { a: B, b: A, ta: 1 - t1, tb: 1 - t0 } : { a: A, b: B, ta: t0, tb: t1 };
}

export { paramOf };

/** Douglas–Peucker simplification of a closed ring (tolerance in the ring's units). Keeps at least 3 points. */
export function simplifyRing(ring: G[], tolerance: number): G[] {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  // split at the two farthest points for a stable closed-ring simplification
  let far = 0,
    best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i]![0] - ring[0]![0]) ** 2 + (ring[i]![1] - ring[0]![1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = ring[s]!,
      b = ring[e % ring.length]!;
    let index = -1,
      max = tolerance;
    for (let i = s + 1; i < e; i++) {
      const p = ring[i]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([s, index], [index, e]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring;
}
