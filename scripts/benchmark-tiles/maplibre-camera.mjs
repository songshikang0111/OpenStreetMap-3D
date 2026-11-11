// WP-D AC404: compares ground-point projection of @city-ink/map's Transform with MapLibre GL JS (dev dependency) for
// 200 random cameras (zoom 13-19, pitch 0-75, any bearing) in Chrome/Edge.
// Prerequisites: npm run build:packages. Usage: node scripts/benchmark-tiles/maplibre-camera.mjs [--json out.json]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const page = await openPage(root, 'test/browser/maplibre-camera.html', { width: 1280, height: 720 });
try {
  await page.waitFor('!!globalThis.ac404', 120000);
  const r = await page.evaluate('globalThis.ac404');
  const worst = r.results.reduce((m, x) => Math.max(m, x.worst), 0);
  const points = r.results.reduce((s, x) => s + x.points, 0);
  const summary = {
    date: new Date().toISOString(),
    browser: page.version?.product,
    maplibre: r.maplibre,
    viewport: [1280, 720],
    cameras: r.results.length,
    points,
    worstPx: worst,
    pass: worst <= 2 && r.results.length === 200,
    worstCameras: r.results.sort((a, b) => b.worst - a.worst).slice(0, 5),
  };
  console.log(
    `${summary.pass ? 'PASS' : 'FAIL'} AC404 maplibre ${r.maplibre}: ${points} points over ${r.results.length} cameras, worst ${worst} px`,
  );
  const at = process.argv.indexOf('--json');
  if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2) + '\n');
  if (!summary.pass) process.exitCode = 1;
} finally {
  await page.close();
}
