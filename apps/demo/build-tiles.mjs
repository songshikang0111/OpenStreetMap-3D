// Builds the demo sample tilesets into apps/demo/public/tiles (generated data, not committed).
// Usage: node apps/demo/build-tiles.mjs [name ...]
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTiles } from '../../packages/builder/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const area = (name) => {
  const j = JSON.parse(
    readFileSync(path.join(root, `docs/phase1-evidence/remediation/integration/performance/${name}.json`), 'utf8'),
  );
  const a = j.build.config.area;
  return [a.west, a.south, a.east, a.north];
};
const SAMPLES = {
  'beijing-cbd-grow-9': { input: 'beijing-cbd', bbox: area('beijing-cbd-grow-9') },
  'kyoto-gion-grow-9': { input: 'kyoto-gion', bbox: area('kyoto-gion-grow-9') },
  'beijing-cbd': { input: 'beijing-cbd' },
  'manhattan-financial': { input: 'manhattan-financial' },
  'shanghai-lujiazui': { input: 'shanghai-lujiazui' },
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['beijing-cbd-grow-9', 'kyoto-gion-grow-9'];
for (const name of names) {
  const s = SAMPLES[name];
  if (!s) throw new Error(`Unknown sample ${name}; choose from ${Object.keys(SAMPLES).join(', ')}`);
  const { report } = await buildTiles({
    input: path.join(root, 'public/data', `${s.input}.json`),
    output: path.join(root, 'apps/demo/public/tiles', name),
    name,
    ...(s.bbox ? { bbox: s.bbox } : {}),
  });
  console.log(name, JSON.stringify(report.counts));
}
