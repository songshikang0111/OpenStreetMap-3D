# Building and serving the demo

The local release directory contains the app, style and geometry Workers, MapLibre, and the sample tiles. All sample districts come from OSM JSON extracts in the repository. The menu lists the districts prepared in this checkout.

## Choose districts

From the repository root, install dependencies with `npm ci`. Run the following commands for a two-district demo.

```sh
npm run demo:tiles -- kyoto-gion-grow-9 amsterdam-canals
npm run build:demo
node scripts/serve-static.mjs apps/demo/dist --port 5180
```

Open `http://127.0.0.1:5180/`. A later build can add more districts. Running `npm run demo:tiles` with no arguments prepares all five defaults.

| District | Build argument |
| --- | --- |
| Beijing CBD | `beijing-cbd-grow-9` |
| Kyoto Gion | `kyoto-gion-grow-9` |
| New York Financial District | `manhattan-financial` |
| Shanghai Lujiazui | `shanghai-lujiazui` |
| Amsterdam canal district | `amsterdam-canals` |

Use the city selector to switch the map, its marker and the data-source link together. The date beside the source link is the extract retrieval date. Click a building for its OSM identity and available height provenance. The overlay and MapLibre links open examples in the selected district. MapLibre uses local footprints as the basemap.

## Static hosting

Copy the contents of `apps/demo/dist/` together, preserving the directories. Relative asset URLs allow a nested mount such as `/maps/city/`. Serve JavaScript with a JavaScript MIME type, JSON as `application/json`, and C3T and coverage files as binary data. Return HTTP 404 for missing resources. An HTML fallback for a missing Worker or tile prevents it from loading.

For hosting the tile directory separately, enable cross-origin GET for the app's origin and gzip or Brotli for JSON and C3T responses. Serve directory tiles as individual files. Keep the manifest, coverage file and level directories from the same build together. Keep the map attribution visible. `tiles/catalog.json` records the source URL, retrieval date and license for each sample.

Verify the built site with an installed Chrome or Edge from the repository root.

```sh
node scripts/demo-smoke.mjs
```

The check serves the release directory on loopback under a nested path. It opens each listed city, changes style and height filtering, clicks a building, and checks the overlay and MapLibre pages. It rejects unexpected network origins and browser errors.

## Embedded browsers

The standalone map needs a nonzero-size container, WebGL 2 and module Workers. Serve a WebView's assets through an HTTP(S) origin and give its container a defined height. On navigation away, await `map.dispose()` to release the renderer and its Workers. Consult the [device matrix](support.md) for measured devices and the [runtime interface](phase2/04-runtime-sdk.md) for lifecycle methods.
