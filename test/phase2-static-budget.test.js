import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTiles } from '@city-ink/builder';

test('static budget rejects a report that omits real coverage tiles', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-budget-coverage-'));
  try {
    await buildTiles({ input: 'public/data/bibury-village.json', output: dir });
    const report = path.join(dir, 'report.json');
    const args = ['scripts/benchmark-tiles/static-budget.mjs', dir, '--bundle', report, '--max-decode-ms', '1000'];
    const run = () => JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
    assert.equal(run().status, 'pass');
    const original = JSON.parse(await readFile(report, 'utf8'));
    await writeFile(report, JSON.stringify({ ...original, hashes: {} }));
    assert.throws(run, (e) => e.status === 1 && JSON.parse(e.stdout).problems.some((p) => p.includes('digest')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
