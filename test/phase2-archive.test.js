import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buildTiles, runTilesCLI, serveTiles } from '@city-ink/builder';
import { openTileArchive } from '@city-ink/map';
import { createStaticServer } from '../scripts/serve-static.mjs';

test('an archive preserves every public build member over byte ranges and is reproducible', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'city-archive-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const output = path.join(base, 'tiles');
  const { report } = await buildTiles({ input: 'public/data/bibury-village.json', output });
  const archive = path.join(base, 'city.archive');
  const pack = () => runTilesCLI(['pack', output, '--output', archive]);
  assert.equal((await pack()).status, 'succeeded');
  const bytes = await readFile(archive);
  const server = await serveTiles(base, { port: 0 });
  try {
    const { tiles, readAsset } = await openTileArchive(server.url + '/city.archive?sig=example');
    for (const name of ['tileset.json', 'report.json', ...Object.keys(report.hashes)]) {
      const stored = await readAsset(new URL(name, tiles).href, { responseType: 'arraybuffer' });
      assert.deepEqual(Buffer.from(stored), await readFile(path.join(output, name)), name);
    }
    assert.deepEqual(
      await readAsset(tiles, { responseType: 'json' }),
      JSON.parse(await readFile(path.join(output, 'tileset.json'))),
    );
    await assert.rejects(
      readAsset(new URL('missing', tiles).href, { responseType: 'arraybuffer' }),
      /Missing archive member/,
    );
    const broken = Buffer.from(bytes);
    broken[0] = 0;
    await writeFile(path.join(base, 'broken.archive'), broken);
    await assert.rejects(openTileArchive(server.url + '/broken.archive'), /index header/);
    const abort = AbortSignal.abort();
    await assert.rejects(readAsset(tiles, { responseType: 'json', signal: abort }), { name: 'AbortError' });
  } finally {
    await server.close();
  }
  const noRanges = await createStaticServer(base);
  try {
    await assert.rejects(openTileArchive(noRanges.url + '/city.archive'), /206 Content-Range/);
  } finally {
    await noRanges.close();
  }
  assert.equal((await pack()).status, 'succeeded');
  assert.deepEqual(await readFile(archive), bytes);
  await writeFile(path.join(output, 'coverage.bin'), Buffer.from('bad'));
  assert.equal((await pack()).status, 'failed');
  assert.equal(
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
    createHash('sha256').update(bytes).digest('hex'),
  );
});
