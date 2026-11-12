# City Ink (working name)

**OpenStreetMap as a good-looking 3D city layer you can embed and restyle.** Buildings with roofs and parts, roads with
kerbs and grades, bridges with parapets and piers, trees and green space — streamed as static tiles and generated in a
browser Worker. It is a plain Three.js scene, and it can also sit on a MapLibre map as a 3D layer.

> Status: pre-release (phase 2 in development). Package names `@city-ink/*` and the `.c3t` tile extension are working
> names; nothing is published to npm yet and there is no hosted demo. [中文说明](README.zh-CN.md)

## What it is — and what it is not

| It is | It is not |
| --- | --- |
| A 3D city layer: buildings, roofs, roads, bridges, stairs, water, trees, street details | A full map product: no search, routing, live traffic or POI service |
| Static tiles you build from OSM and host anywhere; no API key, no server | A hosted tile service (the maintainers run none) |
| A Three.js scene with semantic roles and OSM identity on every object | A survey-grade or photo-real model |
| Restylable: one JSON style file, or your own materials and post-processing | A label engine: the standalone map draws **no text labels**; use the MapLibre layer for labels |

### Real and inferred

OSM rarely says how tall a building is or what its roof looks like. City Ink fills gaps with rules and labels every
key attribute `observed` (tagged in OSM), `derived` (e.g. levels × storey height) or `inferred` (estimated). You can see
and filter this at runtime: `map.setFilter({ buildings: { minHeightProvenance: 'observed' } })` draws everything
without a measured height as a flat footprint. Roof shapes, extra trees, street furniture and site completion are
inferred decorations with explicit switches. Do not describe the result as an accurate reconstruction.

### Data in mainland China

OSM building coverage in mainland China is sparse. Applications served in mainland China must handle map-compliance
requirements (approval numbers, coordinate systems) themselves; this project provides no workaround.

## Try it locally (about five minutes)

Requires Node 22.11+ and a WebGL 2 browser.

```sh
npm ci
npm run demo:tiles      # builds the Beijing CBD and Kyoto Gion sample tiles from public/data
npm run build:demo
node scripts/serve-static.mjs apps/demo/dist --port 5180
```

Open `http://127.0.0.1:5180/`. Switch styles (`light`, `plain`, `dark`, and the ink looks `comic`, `line`, `color`,
`white`, `cel`), toggle street details, "observed heights only" and inferred roofs, click buildings. Other pages:
`overlays.html` (markers, lines, areas, extrusions) and `maplibre.html` (the MapLibre layer).

## Use it in your page

```js
import { createMap } from '@city-ink/map';

const map = await createMap({
  container: document.getElementById('map'), // needs a size
  tiles: './tiles/my-city/tileset.json',
  center: [116.4605, 39.9095], // [lng, lat]
  zoom: 16,
  pitch: 60,
  bearing: -20,
  style: 'light',
});
map.addMarker({ lngLat: [116.4602, 39.9115], element: document.createElement('div') });
map.on('click', (e) => console.log(e.feature)); // OSM id, layer, kept tags, provenance
```

Before the packages are published, build them from this repository (`npm run build:packages`) and use the workspace
packages or the single-file bundle `packages/map/bundle/city-map.js` (with `three` from an import map). The full API
is in [04 Runtime SDK](docs/phase2/04-runtime-sdk.md); [docs/llms.md](docs/llms.md) is a one-file guide for coding
agents.

### On a MapLibre map

```js
import { createMapLibreLayer } from '@city-ink/map/maplibre';
map.addLayer(createMapLibreLayer({ id: 'city', tiles: './tiles/my-city/tileset.json' }), 'labels-layer-id');
```

MapLibre keeps its basemap and text labels; hide its own `fill-extrusion` buildings. Tested with `maplibre-gl` 6.16.0.

## Build tiles for your own area

```sh
# a small area from an OSM JSON extract (Overpass "out body geom")
node bin/city.js tiles build --input area.json --output tiles/my-area --json
# a city from a .osm.pbf extract (<= 1 GB input, <= 5,000 km² build area)
node bin/city.js tiles build --input city.osm.pbf --bbox 4.885,52.368,4.905,52.380 --output tiles/my-city --json
node bin/city.js tiles validate tiles/my-city --json
node bin/city.js tiles serve tiles/my-city --port 4181
```

Options (`--config options.json`): `inferRoofs` (off), `ruleTrees` (on), `details` (street furniture, off),
`landscape` (site completion, off). Builds are deterministic and resumable (`--resume`). Large PBF extracts must be
clipped first, for example `osmium extract -b west,south,east,north in.osm.pbf -o city.osm.pbf`. Known limit: whole-city
builds are currently slow (see [WP-F report](docs/phase2/evidence/F/report.md)).

## Restyle

Three levels ([05 Style contract](docs/phase2/05-style-contract.md), tutorial in
[docs/extensions.md](docs/extensions.md)):

1. **StyleSpec** — one JSON file: colours per semantic role, light, fog, facade windows, rules by attribute or
   provenance. `map.setStyle(spec)` never refetches tiles or rebuilds geometry.
2. **Ink looks** — `import { comic } from '@city-ink/styles-ink'`: outlines, screentone and solid blacks from the phase-one
   renderer. Standalone map only.
3. **Code style packs** — your own materials, post-processing and tile load/unload hooks.

## Repository map

| Path | Content |
| --- | --- |
| `packages/tiles` | Tile format 1.0, codec, Web Mercator math, tileset schema |
| `packages/generators` | Geometry from planned features (buildings, roofs, roads, bridges, water, trees) |
| `packages/builder` | OSM JSON / PBF ingest, planning, cutting, encoding, `city tiles` CLI |
| `packages/map` | `createMap`, streaming, workers, picking, overlays, MapLibre layer |
| `packages/styles`, `styles-ink` | StyleSpec, default styles, facade shader; ink looks |
| `packages/details` | Optional street details and site completion |
| `src/`, `studio/`, `bin/` | Phase-one toolchain, scene packages, studio and CLI (still supported; see [history](docs/history.md)) |
| `docs/phase2/` | Plan, specifications, decisions and evidence |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), the [roadmap](ROADMAP.md) and the
[starter issues](docs/phase2/starter-issues.md). Support matrix: [docs/support.md](docs/support.md).

## License and attribution

Code: MIT ([LICENSE](LICENSE)). Map data © OpenStreetMap contributors, ODbL 1.0 ([DATA_LICENSE.md](DATA_LICENSE.md)); keep
the attribution visible wherever tiles are shown (the map adds it by default).
