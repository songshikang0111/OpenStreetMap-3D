// Minimal usage from docs/phase2/04-runtime-sdk.md section 2, against locally built sample tiles.
// ?tiles=<url> picks another tileset; ?style=plain|light|dark switches the temporary built-in looks.
import { createMap } from '@city-ink/map';

const params = new URLSearchParams(location.search);
const tiles = params.get('tiles') ?? './tiles/beijing-cbd-grow-9/tileset.json';
const hud = document.getElementById('hud');
if (params.get('hud') === '0') hud.style.display = 'none';
if (params.get('panel') === '0') document.getElementById('panel')?.remove();

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
  center: params.has('tiles') ? undefined : [116.4605, 39.9095],
  zoom: params.has('tiles') ? undefined : 16,
  pitch: 60,
  bearing: -20,
  style: await styleFor(styleId),
  onDiagnostic: (d) => console.warn(d.code, d.message),
});

map.addMarker({ lngLat: [116.4602, 39.9115], element: myDiv });
map.on('click', (e) => console.log(e.lngLat, e.feature));
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
const filter = {};
document.getElementById('details')?.addEventListener('change', (e) => {
  filter.details = e.target.checked;
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
