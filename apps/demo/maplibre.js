// The 04 section 8 usage: City Ink as a 3D layer on a MapLibre map. Without ?basemap=<style.json> the host uses a
// small offline style: background, the sample's building footprints as "building-3d" (the basemap's boxes, hidden
// below as the docs say) and a circle layer above the city (standing in for labels, which need online glyphs).
import * as maplibregl from 'maplibre-gl';
import { createMapLibreLayer } from '@city-ink/map/maplibre';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Bundled apps tell MapLibre 6 where its worker module lives.
maplibregl.setWorkerUrl(maplibreWorker);

const params = new URLSearchParams(location.search);
const sample = params.get('sample') ?? 'beijing-cbd-grow-9';
const tiles = `./tiles/${sample}/tileset.json`;
const tileset = await fetch(tiles).then((r) => r.json());
const offlineStyle = {
  version: 8,
  sources: {
    buildings: { type: 'geojson', data: `./tiles/${sample}/buildings.geojson` },
    pois: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: tileset.center.slice(0, 2) } },
        ],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eef1f4' } },
    { id: 'footprints', type: 'fill', source: 'buildings', paint: { 'fill-color': '#d8d4cc' } },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'buildings',
      paint: {
        'fill-extrusion-color': '#c0c0c0',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'min_height'],
      },
    },
    {
      id: 'poi-dots',
      type: 'circle',
      source: 'pois',
      paint: { 'circle-color': '#e2482d', 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    },
  ],
};

const map = new maplibregl.Map({
  container: 'map',
  style: params.get('basemap') ?? offlineStyle,
  center: tileset.center.slice(0, 2),
  zoom: 16,
  pitch: 60,
  bearing: -20,
  maxPitch: 85,
  // ?preserve=1 keeps the drawing buffer readable for automated pixel checks.
  ...(params.has('preserve') ? { canvasContextAttributes: { preserveDrawingBuffer: true } } : {}),
});
const layer = createMapLibreLayer({ id: 'city3d', tiles, style: 'light' });
map.on('load', () => {
  if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none'); // hide the basemap boxes
  map.addLayer(layer, map.getLayer('poi-dots') ? 'poi-dots' : undefined);
});
layer.on('click', (e) => console.log(e.lngLat, e.feature));
globalThis.mlMap = map;
globalThis.cityLayer = layer;
globalThis.createMapLibreLayer = createMapLibreLayer;
