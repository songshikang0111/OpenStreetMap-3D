// Minimal usage from docs/phase2/04-runtime-sdk.md section 2, against locally built sample tiles.
// ?tiles=<url> picks another tileset; ?style=plain|light|dark switches the temporary built-in looks.
import { createMap } from '@city-ink/map';

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud');
if (params.get('hud') === '0') hud.style.display = 'none';
if (params.get('panel') === '0') document.getElementById('panel')?.remove();

const catalog = await fetch('./tiles/catalog.json')
  .then((response) => (response.ok ? response.json() : []))
  .catch(() => []);
const tilesFor = (sample) => `./tiles/${sample.name}/tileset.json`;
if (!catalog.length && !params.has('tiles')) {
  hud.textContent = 'No local samples available. Run npm run demo:tiles and npm run build:demo.';
  throw new Error(hud.textContent);
}
const tiles = params.get('tiles') ?? tilesFor(catalog[0]);
const sample = catalog.find((entry) => tilesFor(entry) === tiles);
const city = document.getElementById('city');
if (city) {
  for (const entry of catalog) city.add(new Option(entry.label, tilesFor(entry)));
  if (!sample) city.add(new Option('Custom tileset', tiles));
  city.value = tiles;
  city.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('tiles', city.value);
    location.href = url.href;
  });
}
if (sample && document.getElementById('source')) {
  const source = document.getElementById('source');
  source.textContent = `OSM extract · ${sample.retrievedAt.slice(0, 10)} · ${sample.license}`;
  source.href = sample.endpoint;
  document.getElementById('maplibre').href = `./maplibre.html?sample=${encodeURIComponent(sample.name)}`;
}
const overlays = document.getElementById('overlays');
if (overlays) overlays.href = `./overlays.html?tiles=${encodeURIComponent(tiles)}`;

const myDiv = document.createElement('div');
myDiv.className = 'marker';

// Built-in looks are StyleSpec data in @city-ink/map; the ink looks come from @city-ink/styles-ink and are loaded only
// when picked (createMap never bundles them).
const INK = ['comic', 'line', 'color', 'white', 'cel'];
async function styleFor(id) {
  if (!INK.includes(id)) return id;
  const ink = await import('@city-ink/styles-ink');
  return ink.inkStyles[id];
}
const styleId = params.get('style') ?? 'light';

const map = await createMap({
  container: document.getElementById('map'),
  tiles,
  pitch: 60,
  bearing: -20,
  style: await styleFor(styleId),
  onDiagnostic: (d) => console.warn(d.code, d.message),
});

myDiv.title = sample?.label ?? 'Map center';
map.addMarker({ lngLat: map.getCenter(), element: myDiv });
// Click a building: show its OSM identity, kept tags and provenance, and highlight it.
const info = document.getElementById('info');
let selected = null;
map.on('click', (e) => {
  if (selected) map.setFeatureState(selected, { highlight: false });
  selected = e.feature?.id ?? null;
  if (!e.feature || !info) {
    if (info) info.hidden = true;
    return;
  }
  map.setFeatureState(selected, { highlight: true });
  const { id, layer, properties, provenance } = e.feature;
  info.hidden = false;
  info.textContent = JSON.stringify({ id, layer, properties, provenance }, null, 1);
});
map.on('tileerror', (e) => console.warn('tile error', e.tile, e.error));

const picker = document.getElementById('style');
if (picker) {
  picker.value = styleId;
  picker.addEventListener('change', async () => {
    await map.setStyle(await styleFor(picker.value));
    const url = new URL(location.href);
    url.searchParams.set('style', picker.value);
    history.replaceState(null, '', url);
  });
}
globalThis.styleFor = styleFor;
// For automated checks of custom style packs (loaded on demand, not part of the initial bundle).
globalThis.loadThree = () => import('three');
const filter = {};
document.getElementById('details')?.addEventListener('change', (e) => {
  filter.details = e.target.checked;
  map.setFilter({ ...filter });
});
// ProvenanceFilter (05 section 5): buildings without an observed height become ground footprints.
document.getElementById('observed')?.addEventListener('change', (e) => {
  filter.buildings = e.target.checked ? { minHeightProvenance: 'observed' } : undefined;
  map.setFilter({ ...filter });
});
document.getElementById('roofs')?.addEventListener('change', (e) => {
  filter.roofs = { inferred: e.target.checked };
  map.setFilter({ ...filter });
});

// Exposed for automated checks and for experimenting in the console.
globalThis.cityMap = map;
globalThis.createCityMap = createMap;

function updateHud() {
  const s = map.getStats();
  const c = s.camera;
  hud.textContent = [
    `center ${c.center[0].toFixed(5)}, ${c.center[1].toFixed(5)}`,
    `zoom ${c.zoom.toFixed(2)}  pitch ${c.pitch.toFixed(1)}  bearing ${c.bearing.toFixed(1)}`,
    `tiles ${s.tiles.visible} visible / ${s.tiles.loaded} loaded / ${s.tiles.loading} loading`,
    `draw calls ${s.drawCalls}  triangles ${s.triangles.toLocaleString()}`,
    `fps ${s.fps ? s.fps.toFixed(0) : '–'}  worker p95 ${s.workers.generateMs.p95?.toFixed(0) ?? '–'} ms`,
  ].join('\n');
  requestAnimationFrame(updateHud);
}
updateHud();
