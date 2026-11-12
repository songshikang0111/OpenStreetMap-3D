# City Ink for coding agents (single-file guide)

Everything an agent needs to put a City Ink 3D city in a web page. Pre-release: packages are built from this
repository (names `@city-ink/*` are working names, not on npm yet). Every JavaScript snippet below has a type-checked counterpart in
[`examples/phase2/llms-usage.ts`](../examples/phase2/llms-usage.ts) (`npm run test:types`).

## 1. Get tiles

A tileset is a folder with `tileset.json`, `coverage.bin` and `{z}/{x}/{y}.c3t` files, served over HTTP.

```sh
npm ci && npm run build:packages
node bin/city.js tiles build --input area.json --output public/tiles/my-city --json   # OSM JSON ("out body geom")
node bin/city.js tiles build --input city.osm.pbf --bbox W,S,E,N --output public/tiles/my-city --json
node bin/city.js tiles validate public/tiles/my-city --json
```

`--json` prints one result line on stdout (`status: "succeeded" | "failed"`, `diagnostics[]` with `code`, `message`,
`hint`); progress goes to stderr. Exit code 0 or 1. The sample tiles of the demo come from `npm run demo:tiles`
(`apps/demo/public/tiles/{beijing-cbd-grow-9,kyoto-gion-grow-9}`).

## 2. Show the city

```js
import { createMap } from '@city-ink/map'; // peer dependency: three 0.186.x

const map = await createMap({
  container: document.getElementById('map'), // must have a non-zero size
  tiles: '/tiles/my-city/tileset.json', // URL or a tileset object
  center: [116.4605, 39.9095], // [lng, lat]; default: tileset centre
  zoom: 16, // MapLibre semantics: zoom, pitch (0-80), bearing, fov
  pitch: 60,
  bearing: -20,
  style: 'light', // 'light' | 'plain' | 'dark' | StyleSpec | style pack
  onDiagnostic: (d) => console.warn(d.code, d.message),
});
await map.whenIdle(); // resolves when visible tiles are loaded
```

Camera: `jumpTo`, `easeTo`, `flyTo`, `fitBounds([w, s, e, n])`, `getCenter/getZoom/getPitch/getBearing`. Coordinates:
`project(lngLat)` → `{x, y}` pixels, `unproject(point)` → `[lng, lat]`. Three.js: `map.scene`, `map.camera`,
`map.renderer`; put your own objects in `map.createAnchor(lngLat)` so they follow the floating origin. Clean up with
`await map.dispose()`.

## 3. Switch styles

```js
await map.setStyle('dark'); // no refetch, no geometry rebuild
await map.setStyle({ schemaVersion: 2, id: 'brand', extends: 'light', roles: { wall: { color: '#f1c9a5', blend: 'multiply' } } });
import { comic } from '@city-ink/styles-ink'; // optional package: outlines and screentone (not in MapLibre layers)
await map.setStyle(comic);
```

Invalid specs throw `code: 'STYLE_INVALID'` with `errors: [{ path, message }]`. Roles: `wall`, `glass`, `roof`,
`structure`, `road`, `water`, `foliage`, `ground`, `facility`, `landmark` (sub-roles like `road.marking`). Schema:
`schemas/style-spec.schema.json`.

## 4. Click a building

```js
map.on('click', (e) => {
  if (!e.feature) return;
  const { id, layer, properties, provenance, lngLat } = e.feature;
  // id: 'way/123' | 'relation/45#0'; layer: 'building' | 'tree' | 'road' | 'landmark' | overlay id
  // properties.height, properties.levels, properties.roofShape; provenance.height: 'observed' | 'derived' | 'inferred'
  map.setFeatureState(id, { highlight: true }); // also { hidden: true }, { color: '#ff0000' }
});
const f = map.queryFeatures({ x: 640, y: 360 }); // same result without an event
```

## 5. Add a route, an area or a marker

```js
map.addLayer({
  id: 'route',
  type: 'line', // 'line' | 'fill' | 'extrusion' | 'circle' | 'custom'
  data: { type: 'LineString', coordinates: [[116.456, 39.908], [116.462, 39.910]] }, // GeoJSON geometry, feature or collection
  paint: { color: '#e2482d', width: 6 }, // width in CSS pixels
  altitude: 2,
});
map.addMarker({ lngLat: [116.4602, 39.9115], element: myDiv, anchor: 'bottom' });
map.removeLayer('route');
```

## 6. Real versus inferred

```js
map.setFilter({ buildings: { minHeightProvenance: 'observed' } }); // others become flat footprints
map.setFilter({ trees: { inferred: false }, roofs: { inferred: false }, details: false });
map.setFilter({}); // everything
```

## 7. On a MapLibre map

```js
import { createMapLibreLayer } from '@city-ink/map/maplibre'; // maplibre-gl >= 6.16 < 7 (optional peer)
mlMap.addLayer(createMapLibreLayer({ id: 'city', tiles: '/tiles/my-city/tileset.json', style: 'light' }));
mlMap.setLayoutProperty('building-3d', 'visibility', 'none'); // hide the basemap's own extrusions
```

The layer shares MapLibre's WebGL context and camera; host labels draw on top. Ink looks are rejected here
(`STYLE_NOT_HOST_COMPATIBLE`).

## Pitfalls

- The standalone map draws no text labels.
- Keep the attribution (`© OpenStreetMap contributors`); the map adds it unless `attributionControl: false`.
- Serve tiles over HTTP (not `file://`); a `tileerror` event reports failed tiles after retries.
- OSM building coverage in mainland China is sparse; compliance is the application's responsibility.
