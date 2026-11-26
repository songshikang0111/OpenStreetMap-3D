// Linear preparation for the render thread. Arrays are transferred alongside generated geometry.
import { ROLE_LIST, TREE_STRIDE } from '@city-ink/generators';
import type { GeneratedTile } from '@city-ink/generators';

/** Phase-one ink class per role index (1 building, 1.25 facade, 3 road, 3.2 walkway, 3.5 paint, 4 structure, 5, 6). */
const INK_BY_ROLE = ROLE_LIST.map((r) =>
  r === 'wall' || r === 'glass'
    ? 1.25
    : r === 'roof' || r === 'landmark'
      ? 1
      : r === 'road'
        ? 3
        : r === 'road.marking'
          ? 3.5
          : r === 'ground.pavement' || r === 'ground.plaza'
            ? 3.2
            : r === 'water'
              ? 6
              : r.startsWith('ground')
                ? 5
                : 4,
);

export function prepareUpload(generated: GeneratedTile) {
  const ink = generated.batches.map((batch) => {
    const values = new Float32Array(batch.vertexCount);
    for (let i = 0; i < values.length; i++) values[i] = INK_BY_ROLE[batch.roleIndex[i]!] ?? 4;
    return values;
  });
  const trees = generated.trees;
  const crowns = new Float32Array(trees.count * 16);
  const trunks = new Float32Array(trees.count * 16);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  for (let i = 0; i < trees.count; i++) {
    const t = i * TREE_STRIDE,
      m = i * 16;
    const x = trees.data[t]!,
      y = trees.data[t + 1]!,
      z = trees.data[t + 2]!;
    const h = trees.data[t + 3]!,
      r = trees.data[t + 4]!,
      shape = trees.data[t + 5]!;
    const narrow = shape === 2 || shape === 4;
    const crownR = narrow ? r * 0.55 : r;
    const crownH = narrow ? h * 0.45 : Math.min(h * 0.55, r * 1.6);
    crowns[m] = crowns[m + 10] = crownR;
    crowns[m + 5] = crownH;
    crowns[m + 13] = y + h - crownH;
    trunks[m] = trunks[m + 10] = 1;
    trunks[m + 5] = h - crownH * 0.9;
    trunks[m + 13] = y;
    crowns[m + 12] = trunks[m + 12] = x;
    crowns[m + 14] = trunks[m + 14] = z;
    crowns[m + 15] = trunks[m + 15] = 1;
    const radius = Math.max(0.18, crownR);
    bounds[0] = Math.min(bounds[0], x - radius);
    bounds[1] = Math.min(bounds[1], y, y + h - 2 * crownH);
    bounds[2] = Math.min(bounds[2], z - radius);
    bounds[3] = Math.max(bounds[3], x + radius);
    bounds[4] = Math.max(bounds[4], y + h);
    bounds[5] = Math.max(bounds[5], z + radius);
  }
  return { ink, crowns, trunks, bounds };
}
export type UploadData = ReturnType<typeof prepareUpload>;
