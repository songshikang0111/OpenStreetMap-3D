// Type-checked counterparts of every JavaScript snippet in docs/llms.md (AC1003). Compiled by `npm run test:types`.
import { createMap } from '@city-ink/map';
import type { CityMap } from '@city-ink/map';
import { createMapLibreLayer } from '@city-ink/map/maplibre';
import { comic } from '@city-ink/styles-ink';
import type { Map as MapLibreMap } from 'maplibre-gl';

export async function section2(): Promise<CityMap> {
  const map = await createMap({
    container: document.getElementById('map')!,
    tiles: '/tiles/my-city/tileset.json',
    center: [116.4605, 39.9095],
    zoom: 16,
    pitch: 60,
    bearing: -20,
    style: 'light',
    onDiagnostic: (d) => console.warn(d.code, d.message),
  });
  await map.whenIdle();
  return map;
}

export async function section3(map: CityMap) {
  await map.setStyle('dark');
  await map.setStyle({
    schemaVersion: 2,
    id: 'brand',
    extends: 'light',
    roles: { wall: { color: '#f1c9a5', blend: 'multiply' } },
  });
  await map.setStyle(comic as never);
}

export function section4(map: CityMap) {
  map.on('click', (e) => {
    if (!e.feature) return;
    const { id, layer, properties, provenance, lngLat } = e.feature;
    console.log(layer, properties.height, provenance.height, lngLat);
    map.setFeatureState(id, { highlight: true });
  });
  return map.queryFeatures({ x: 640, y: 360 });
}

export function section5(map: CityMap, myDiv: HTMLElement) {
  map.addLayer({
    id: 'route',
    type: 'line',
    data: {
      type: 'LineString',
      coordinates: [
        [116.456, 39.908],
        [116.462, 39.91],
      ],
    },
    paint: { color: '#e2482d', width: 6 },
    altitude: 2,
  });
  map.addMarker({ lngLat: [116.4602, 39.9115], element: myDiv, anchor: 'bottom' });
  map.removeLayer('route');
}

export function section6(map: CityMap) {
  map.setFilter({ buildings: { minHeightProvenance: 'observed' } });
  map.setFilter({ trees: { inferred: false }, roofs: { inferred: false }, details: false });
  map.setFilter({});
}

export function section7(mlMap: MapLibreMap) {
  mlMap.addLayer(createMapLibreLayer({ id: 'city', tiles: '/tiles/my-city/tileset.json', style: 'light' }));
  mlMap.setLayoutProperty('building-3d', 'visibility', 'none');
}
