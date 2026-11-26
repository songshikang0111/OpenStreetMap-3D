/** Edges of polygon features that lie on the line x = X (vertical) or y = Y (horizontal), in global grid units. */
export function boundaryCoverage(tile, layerName, axis, value) {
  const layer = tile.layers[layerName];
  if (!layer || layer.type !== 'features') return [];
  const e = 2 ** tile.extentLog2;
  const ox = tile.id.x * e + e / 2,
    oy = tile.id.y * e + e / 2;
  const spans = [];
  for (let ring = 0; ring + 1 < layer.vertexStart.length; ring++) {
    const a0 = layer.vertexStart[ring],
      a1 = layer.vertexStart[ring + 1];
    for (let v = a0; v < a1; v++) {
      const w = v + 1 < a1 ? v + 1 : a0;
      const p = [layer.positions[v * 2] + ox, layer.positions[v * 2 + 1] + oy];
      const q = [layer.positions[w * 2] + ox, layer.positions[w * 2 + 1] + oy];
      const h = (i) => (layer.elevation ? layer.baseElevation + layer.elevation[i] / 16 : 0);
      if (axis === 'x' && p[0] === value && q[0] === value)
        spans.push({ lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]), p, q, hp: h(v), hq: h(w) });
      if (axis === 'y' && p[1] === value && q[1] === value)
        spans.push({ lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]), p, q, hp: h(v), hq: h(w) });
    }
  }
  return spans;
}

export function sampleAt(spans, t, axis) {
  const k = axis === 'x' ? 1 : 0;
  const levels = spans
    .filter((s) => s.lo < t && t < s.hi)
    .map((s) => {
      const u = (t - s.p[k]) / (s.q[k] - s.p[k]);
      return s.hp + (s.hq - s.hp) * u;
    })
    .sort((a, b) => a - b);
  // identical levels from overlapping pieces count once
  return levels.filter((h, i) => i === 0 || Math.abs(h - levels[i - 1]) > 0.01);
}
