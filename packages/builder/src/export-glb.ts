import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Color } from 'three';
import { decodeCoverage, decodeTile, tileKey, tileToWorldMatrix, validateTileset } from '@city-ink/tiles';
import type { LngLat } from '@city-ink/tiles';
import { crownGeometry, generateTile, trunkGeometry } from '@city-ink/generators';
import { geometryArrays, TileGlb } from '@city-ink/generators/glb';
import { treeTransforms } from '@city-ink/generators/tree-transforms';
import { DETAIL_GENERATORS } from '@city-ink/details';

/** Generate each finest-coverage tile once. Publish the GLB only after every required tile has succeeded. */
export async function exportTilesGLB(dir: string, output: string, signal?: AbortSignal): Promise<number> {
  if (path.extname(output).toLowerCase() !== '.glb') throw new Error('Choose a .glb output file.');
  const result = validateTileset(JSON.parse(await readFile(path.join(dir, 'tileset.json'), 'utf8')));
  if (!result.valid || !result.value) throw new Error('Invalid tileset.json');
  const ts = result.value;
  const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
  async function member(key: string) {
    const data = await readFile(path.join(dir, key), { signal });
    if (createHash('sha256').update(data).digest('hex') !== report.hashes[key])
      throw new Error('Missing or incorrect digest: ' + key);
    return data;
  }
  const coverage = decodeCoverage(await member(ts.coverage.index));
  const finest = ts.levels.at(-1)!;
  if (coverage.zoom !== finest.zoom) throw new Error('Coverage must describe the finest tile level.');
  const origin: LngLat = [ts.center[0], ts.center[1]];
  const tmp = output + '.' + randomUUID();
  const bin = tmp + '.bin';
  const scratch = await open(bin, 'wx');
  const writer = new TileGlb(ts, origin, 'complete', (bytes) => writeFileSync(scratch.fd, bytes));
  const crown = crownGeometry(),
    trunk = trunkGeometry();
  let count = 0;
  try {
    for (const id of coverage.tiles()) {
      signal?.throwIfAborted();
      const key = tileKey(id);
      const tile = decodeTile(await member(key + '.c3t'));
      if (tileKey(tile.id) !== key || tile.profile !== finest.profile)
        throw new Error('Unexpected tile content: ' + key);
      const g = generateTile(tile, {
        seed: ts.build?.seed ?? 1,
        inferRoofs: Boolean(ts.build?.options?.inferRoofs),
        layerGenerators: DETAIL_GENERATORS,
      });
      const parent = writer.tile(key, tileToWorldMatrix(id, origin));
      for (const batch of g.batches) writer.mesh(parent, batch.layer + ':' + batch.role, batch);
      if (g.trees.count) {
        const t = treeTransforms(g.trees);
        writer.mesh(parent, 'tree crowns', geometryArrays(crown), new Color('#8fbf7a').toArray(), t.crowns);
        writer.mesh(parent, 'tree trunks', geometryArrays(trunk), new Color('#846b4f').toArray(), t.trunks);
      }
      count++;
    }
    if (!count) throw new Error('Tileset has no covered tiles.');
    const header = writer.header();
    await scratch.close();
    const out = await open(tmp, 'wx');
    try {
      await out.writeFile(header);
      for await (const chunk of createReadStream(bin, { signal })) await out.writeFile(chunk as Buffer);
    } finally {
      await out.close();
    }
    signal?.throwIfAborted();
    await rename(tmp, output);
    return count;
  } finally {
    crown.dispose();
    trunk.dispose();
    await scratch.close();
    await Promise.all([rm(bin, { force: true }), rm(tmp, { force: true })]);
  }
}
