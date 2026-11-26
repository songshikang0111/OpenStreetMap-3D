// WP-E demo: the five overlay types, a marker, click-to-inspect and feature state (highlight the clicked object).
import { createMap } from '@city-ink/map';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

const params = new URLSearchParams(location.search);
const map = await createMap({
  container: document.getElementById('map'),
  tiles: params.get('tiles') ?? './tiles/beijing-cbd-grow-9/tileset.json',
  zoom: 16.3,
  pitch: 55,
  bearing: -20,
});
globalThis.cityMap = map;
const c = map.getCenter();

// line: a route with a constant on-screen width
map.addLayer({
  id: 'route',
  type: 'line',
  data: {
    type: 'LineString',
    coordinates: [
      [c[0] - 0.004, c[1] - 0.001],
      [c[0], c[1] - 0.0005],
      [c[0] + 0.004, c[1] + 0.001],
    ],
  },
  paint: { color: '#e2482d', width: 6 },
  altitude: 2,
});
// fill: a translucent area on the ground
map.addLayer({
  id: 'area',
  type: 'fill',
  data: {
    type: 'Feature',
    id: 'plaza',
    properties: { name: 'Study area' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [c[0] - 0.003, c[1] + 0.002],
          [c[0] - 0.001, c[1] + 0.002],
          [c[0] - 0.001, c[1] + 0.003],
          [c[0] - 0.003, c[1] + 0.003],
          [c[0] - 0.003, c[1] + 0.002],
        ],
      ],
    },
  },
  paint: { color: '#3a7bd5', opacity: 0.45 },
});
// extrusion: heights from a property
map.addLayer({
  id: 'proposals',
  type: 'extrusion',
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'p1',
        properties: { floors: 30, h: 100 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [c[0] + 0.001, c[1] + 0.002],
              [c[0] + 0.0016, c[1] + 0.002],
              [c[0] + 0.0016, c[1] + 0.0026],
              [c[0] + 0.001, c[1] + 0.0026],
              [c[0] + 0.001, c[1] + 0.002],
            ],
          ],
        },
      },
    ],
  },
  paint: { color: '#8e44ad', height: 'h', opacity: 0.85 },
});
// circle: screen-sized points
map.addLayer({
  id: 'stops',
  type: 'circle',
  data: {
    type: 'FeatureCollection',
    features: [0, 1, 2].map((i) => ({
      type: 'Feature',
      id: `stop-${i}`,
      properties: { name: `Stop ${i + 1}` },
      geometry: { type: 'Point', coordinates: [c[0] - 0.003 + i * 0.003, c[1] - 0.0008 + i * 0.0006] },
    })),
  },
  paint: { color: '#16a085', radius: 7 },
});
// custom: any Three.js object at a lng/lat (metres)
const box = new Mesh(new BoxGeometry(30, 60, 30), new MeshStandardMaterial({ color: '#f1c40f' }));
box.position.y = 30;
map.addLayer({ id: 'custom', type: 'custom', object: box, lngLat: [c[0] + 0.003, c[1] - 0.003] });

const pin = document.createElement('div');
pin.className = 'pin';
map.addMarker({ lngLat: [c[0] - 0.0003, c[1] + 0.0018], element: pin, anchor: 'center' });

let selected = null;
map.on('click', (e) => {
  if (selected) map.setFeatureState(selected, { highlight: false });
  selected = e.feature?.id ?? null;
  if (selected) map.setFeatureState(selected, { highlight: true });
  document.getElementById('info').textContent = e.feature
    ? JSON.stringify(
        {
          id: e.feature.id,
          layer: e.feature.layer,
          provenance: e.feature.provenance,
          properties: e.feature.properties,
        },
        null,
        2,
      )
    : `Nothing here (${e.lngLat?.map((v) => v.toFixed(5)).join(', ')})`;
});
