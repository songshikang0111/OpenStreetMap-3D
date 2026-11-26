// Linear preparation for the render thread. Arrays are transferred alongside generated geometry.
import { ROLE_LIST } from '@city-ink/generators';
import { treeTransforms } from '@city-ink/generators/tree-transforms';
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
  return { ink, ...treeTransforms(generated.trees) };
}
export type UploadData = ReturnType<typeof prepareUpload>;
