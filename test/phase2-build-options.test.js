import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { runTilesCLI } from '@city-ink/builder';
import { readFeatures, decodeTile } from '@city-ink/tiles';

test('CLI height inference preserves observed, derived and elevated base heights through resume', async (t) => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'city-height-options-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const config = path.join(out, 'options.json'),
    input = path.join(out, 'input.json');
  const elements = [];
  for (const [i, tags] of [{ height: '13' }, { 'building:levels': '2' }, { min_height: '5' }].entries()) {
    const lon = 0.001 + i * 0.001;
    const coords = [
      [lon, 0.001],
      [lon + 0.0004, 0.001],
      [lon + 0.0004, 0.0014],
      [lon, 0.0014],
    ];
    elements.push(...coords.map(([lon, lat], j) => ({ type: 'node', id: 100 * i + j + 1, lon, lat })), {
      type: 'way',
      id: i + 1,
      nodes: [1, 2, 3, 4, 1].map((n) => 100 * i + n),
      tags: { building: 'office', ...tags },
    });
  }
  await writeFile(input, JSON.stringify({ metadata: { bbox: [0, 0, 0.005, 0.005] }, elements }));
  const args = ['build', '--input', input, '--config', config, '--output', path.join(out, 'tiles'), '--resume'];
  const run = () => runTilesCLI(args, { stderr: { write() {} } });
  await writeFile(config, JSON.stringify({ inferHeights: true }));
  assert.equal((await run()).status, 'succeeded');
  await writeFile(config, JSON.stringify({ inferHeights: false, landmarks: false }));
  assert.equal((await run()).status, 'succeeded');
  const manifest = JSON.parse(await readFile(path.join(out, 'tiles', 'tileset.json')));
  assert.equal(manifest.build.options.landmarks, false);
  assert.equal(manifest.build.options.inferHeights, false);
  const report = JSON.parse(await readFile(path.join(out, 'tiles', 'report.json')));
  const buildings = new Map();
  for (const name of Object.keys(report.hashes).filter((n) => n.startsWith('16/'))) {
    const layer = decodeTile(await readFile(path.join(out, 'tiles', name))).layers.building;
    if (layer) for (const f of readFeatures(layer)) buildings.set(f.id, f);
  }
  for (const [id, h, source] of [
    [1, 13, 'observed'],
    [2, 7.6, 'derived'],
    [3, 8, 'inferred'],
  ]) {
    const feature = buildings.get('way/' + id);
    assert.ok(Math.abs(feature.properties.height - h) < 0.01);
    assert.equal(feature.provenance.height, source);
  }
  await writeFile(config, JSON.stringify({ inferHeights: 'false' }));
  assert.equal((await run()).diagnostics[0].code, 'OPTION_INVALID');
});
