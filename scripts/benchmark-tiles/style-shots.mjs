// Fixed-camera screenshots of the built demo for visual review and the WP-G style baseline (AC701).
// Screenshots are written outside the repository (07 section 4).
// Prerequisites: npm run demo:tiles && npm run build:demo
// Usage: node scripts/benchmark-tiles/style-shots.mjs <outDir> [--styles plain,light,dark] [--samples beijing,kyoto]
//   [--views name,...] [--dist apps/demo/dist]
// Use CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" for the hardware GPU.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!out) {
  console.error('Usage: node scripts/benchmark-tiles/style-shots.mjs <outDir> [--styles a,b] [--samples a,b]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const styles = opt('styles', 'light').split(',');
const dist = path.resolve(opt('dist', path.join(root, 'apps/demo/dist')));
const filter = opt('filter', '');

/** Fixed cameras per sample: an overview across the L0/L1 boundary, a street close-up and a bridge or roof view. */
export const VIEWS = {
  beijing: {
    tiles: './tiles/beijing-cbd-grow-9/tileset.json',
    views: {
      overview: { center: [116.4605, 39.9095], zoom: 15.2, pitch: 55, bearing: -20 },
      street: { center: [116.4598, 39.9088], zoom: 17.6, pitch: 68, bearing: 30 },
      bridge: { center: [116.4524, 39.9152], zoom: 18.2, pitch: 66, bearing: 35 },
      stairs: { center: [116.465, 39.91485], zoom: 19.3, pitch: 60, bearing: 0 },
    },
  },
  kyoto: {
    tiles: './tiles/kyoto-gion-grow-9/tileset.json',
    views: {
      overview: { center: [135.775, 35.0025], zoom: 16.3, pitch: 66, bearing: 0 },
      street: { center: [135.7752, 35.0035], zoom: 17.8, pitch: 65, bearing: 60 },
      roofs: { center: [135.7785, 35.0015], zoom: 17.4, pitch: 50, bearing: -30 },
    },
  },
  manhattan: {
    tiles: './tiles/manhattan-financial/tileset.json',
    views: {
      overview: { center: [-74.0105, 40.7075], zoom: 15.6, pitch: 55, bearing: 30 },
      street: { center: [-74.0112, 40.7065], zoom: 17.6, pitch: 68, bearing: 20 },
    },
  },
};
const samples = opt('samples', 'beijing,kyoto').split(',');
const viewFilter = opt('views', '');

mkdirSync(out, { recursive: true });
const summary = [];
for (const sample of samples) {
  const s = VIEWS[sample];
  if (!s) throw new Error(`Unknown sample ${sample}`);
  if (!existsSync(path.join(dist, s.tiles))) {
    console.warn(`skip ${sample}: ${s.tiles} not built (node apps/demo/build-tiles.mjs ...)`);
    continue;
  }
  for (const style of styles) {
    const query = `?tiles=${encodeURIComponent(s.tiles)}&style=${style}${filter ? `&filter=${filter}` : ''}&hud=0`;
    const page = await openPage(dist, `index.html${query}`);
    try {
      await page.waitFor('!!globalThis.cityMap', 30000);
      for (const [name, camera] of Object.entries(s.views)) {
        if (viewFilter && !viewFilter.split(',').includes(name)) continue;
        await page.evaluate(`cityMap.jumpTo(${JSON.stringify(camera)}); cityMap.whenIdle({ timeoutMs: 90000 })`);
        await page.evaluate('new Promise((r) => setTimeout(r, 400))');
        const file = path.join(out, `${sample}-${name}-${style}${filter ? '-' + filter : ''}.png`);
        await page.screenshot(file);
        const stats = await page.evaluate('JSON.stringify(cityMap.getStats())').then(JSON.parse);
        summary.push({ sample, style, view: name, file, drawCalls: stats.drawCalls, triangles: stats.triangles });
        console.log(`${file} drawCalls=${stats.drawCalls} triangles=${stats.triangles}`);
      }
      const errors = page.events.filter((e) => e.level === 'error');
      if (errors.length) console.warn(`${sample}/${style}: ${errors.length} console errors`, errors.slice(0, 3));
    } finally {
      await page.close();
    }
  }
}
writeFileSync(
  path.join(out, 'shots.json'),
  JSON.stringify({ gpu: process.env.CITY_BROWSER_FLAGS ?? null, summary }, null, 2),
);
