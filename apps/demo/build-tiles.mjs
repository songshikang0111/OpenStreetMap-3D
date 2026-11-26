// Builds the demo sample tilesets into apps/demo/public/tiles (generated data, not committed).
// Usage: node apps/demo/build-tiles.mjs [name ...]
import path from 'node:path';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { parseOSM } from '../../src/osm.js';
import { normalizeRaw } from '../../src/core/contract.js';
import { fileURLToPath } from 'node:url';
import { buildTiles, validateTilesetDir } from '../../packages/builder/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const area = (name) => {
  const j = JSON.parse(
    readFileSync(path.join(root, `docs/phase1-evidence/remediation/integration/performance/${name}.json`), 'utf8'),
  );
  const a = j.build.config.area;
  return [a.west, a.south, a.east, a.north];
};
const SAMPLES = {
  'beijing-cbd-grow-9': { label: 'Beijing · CBD', input: 'beijing-cbd', bbox: area('beijing-cbd-grow-9') },
  'kyoto-gion-grow-9': { label: 'Kyoto · Gion', input: 'kyoto-gion', bbox: area('kyoto-gion-grow-9') },
  'manhattan-financial': { label: 'New York · Financial District', input: 'manhattan-financial' },
  'shanghai-lujiazui': { label: 'Shanghai · Lujiazui', input: 'shanghai-lujiazui' },
  'amsterdam-canals': { label: 'Amsterdam · Canal district', input: 'amsterdam-canals' },
  'beijing-cbd': { label: 'Beijing · Full CBD sample', input: 'beijing-cbd' },
};
const names = process.argv.slice(2);
const outputRoot = path.join(root, 'apps/demo/public/tiles');
const work = path.join(root, 'work');
mkdirSync(work, { recursive: true });
mkdirSync(outputRoot, { recursive: true });
for (const name of names.length ? names : Object.keys(SAMPLES).filter((key) => key !== 'beijing-cbd')) {
  if (!Object.hasOwn(SAMPLES, name))
    throw new Error(`Unknown sample ${name}; choose from ${Object.keys(SAMPLES).join(', ')}`);
  const s = SAMPLES[name];
  const output = mkdtempSync(path.join(work, 'demo-tiles-'));
  try {
    const { report } = await buildTiles({
      input: path.join(root, 'public/data', `${s.input}.json`),
      output,
      name,
      // The demo shows the explicit, conservative roof inference (pitched roofs on small houses; 05 section 5). The
      // builder default stays off, and the runtime ProvenanceFilter `roofs.inferred: false` turns it back off.
      inferRoofs: true,
      // Optional decorations (street furniture, parked cars, pedestrians, inferred landscape) are off by default in the
      // builder; the demo turns them on and offers a switch (ProvenanceFilter `details`).
      details: true,
      landscape: true,
      ...(s.bbox ? { bbox: s.bbox } : {}),
    });
    console.log(name, JSON.stringify(report.counts));
    // Building footprints as GeoJSON: the stand-in "basemap buildings" of the MapLibre demo and the AC802 check.
    const raw = JSON.parse(readFileSync(path.join(root, 'public/data', `${s.input}.json`), 'utf8'));
    const [south, west, north, east] = s.bbox ? [s.bbox[1], s.bbox[0], s.bbox[3], s.bbox[2]] : raw.metadata.bbox;
    const origin = s.bbox
      ? { lat: (south + north) / 2, lon: (west + east) / 2 }
      : { lat: raw.metadata.center[0], lon: raw.metadata.center[1] };
    const data = parseOSM(normalizeRaw(raw, { area: { south, west, north, east }, origin }), 1);
    const ll = (p) => {
      const [lat, lon] = data.project.inverse(p);
      return [+lon.toFixed(8), +lat.toFixed(8)];
    };
    const features = data.buildings.map((b) => ({
      type: 'Feature',
      id: b.id,
      properties: { height: b.height, min_height: b.minHeight },
      geometry: { type: 'Polygon', coordinates: [b.outer, ...b.holes].map((r) => [...r.map(ll), ll(r[0])]) },
    }));
    writeFileSync(path.join(output, 'buildings.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
    const validation = await validateTilesetDir(output);
    if (!validation.valid) throw new Error(JSON.stringify(validation.diagnostics));
    const { endpoint, retrievedAt, attribution, license, licenseUrl } = raw.metadata;
    writeFileSync(
      path.join(output, 'sample.json'),
      JSON.stringify({ name, label: s.label, endpoint, retrievedAt, attribution, license, licenseUrl }),
    );
    // Keep the resumable planning cache (including local paths) out of the web root.
    rmSync(path.join(output, '.build'), { recursive: true, force: true });
    chmodSync(output, 0o777 & ~process.umask());
    const destination = path.join(outputRoot, name);
    rmSync(destination, { recursive: true, force: true });
    renameSync(output, destination);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
  const catalog = Object.keys(SAMPLES)
    .map((name) => path.join(outputRoot, name, 'sample.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')));
  writeFileSync(path.join(outputRoot, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
}
