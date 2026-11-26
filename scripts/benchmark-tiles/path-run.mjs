// Real-browser replay. Use --json for the compact summary and --frames for the full log outside the repository.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const pathFile = path.resolve(
  process.argv[2] ?? path.join(root, 'scripts/benchmark-tiles/paths/beijing-cbd-grow-9.json'),
);
const plan = JSON.parse(readFileSync(pathFile, 'utf8'));
const loops = Number(arg('loops', 1));
const params = new URLSearchParams({
  run: '1',
  plan: JSON.stringify(plan),
  quality: arg('quality', 'balanced'),
  loops: String(loops),
  device: os.cpus()[0]?.model ?? os.arch(),
});
const headless = !process.argv.includes('--headful');
const page = await openPage(path.join(root, 'apps/demo/dist'), 'benchmark.html?' + params, {
  width: Number(arg('width', 1280)),
  height: Number(arg('height', 720)),
  headless,
});
try {
  await page.waitFor(
    'window.benchmarkError || !!window.benchmarkResult',
    120000 + loops * plan.keyframes.reduce((sum, k) => sum + k.duration, 0),
  );
  const error = await page.evaluate('window.benchmarkError ?? null');
  if (error) throw new Error(error);
  const summary = await page.evaluate('window.benchmarkResult.summary');
  Object.assign(summary.environment, {
    browser: page.version?.product ?? summary.environment.browser,
    cpu: os.cpus()[0]?.model,
    platform: os.platform() + ' ' + os.release(),
    headless,
  });
  summary.path = path.relative(root, pathFile);
  const text = JSON.stringify(summary, null, 2) + '\n';
  if (arg('json')) writeFileSync(arg('json'), text);
  if (arg('frames')) {
    const log = await page.evaluate('window.benchmarkResult');
    writeFileSync(arg('frames'), JSON.stringify({ ...log, summary }));
  }
  process.stdout.write(text);
} finally {
  await page.close();
}
