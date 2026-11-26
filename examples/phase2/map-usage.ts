// Type-checked usage of @city-ink/map (AC402): the 04 section 2 example plus every method of the 04 section 3
// interface. Compiled by `npm run test:types`; not executed.
import { createMap } from '@city-ink/map';
import type { CityMap, Feature, LngLat, MapEvent, MapStats, OverlayLayer, ProvenanceFilter } from '@city-ink/map';
import { Mesh, BoxGeometry, MeshStandardMaterial, Vector3 } from 'three';

export async function minimal(container: HTMLElement, myDiv: HTMLElement): Promise<CityMap> {
  const map = await createMap({
    container,
    tiles: 'https://example.com/beijing/tileset.json',
    center: [116.4605, 39.9095],
    zoom: 16,
    pitch: 60,
    bearing: -20,
    style: 'light',
  });
  map.addMarker({ lngLat: [116.4602, 39.9115], element: myDiv });
  map.on('click', (e: MapEvent) => console.log(e.lngLat, e.feature));
  return map;
}

export async function everyMethod(map: CityMap): Promise<void> {
  const center: LngLat = map.getCenter();
  const zoom: number = map.getZoom() + map.getPitch() + map.getBearing();
  map.jumpTo({ center, zoom, pitch: 45, bearing: 10 });
  await map.easeTo({ zoom: 17, duration: 500, easing: (t) => t });
  await map.flyTo({ center: [116.47, 39.91], zoom: 16 });
  await map.fitBounds([116.45, 39.9, 116.47, 39.92], { padding: 40, duration: 0 });

  const p = map.project([116.46, 39.91], 10);
  const back: LngLat | null = p ? map.unproject(p) : null;
  const world: Vector3 = map.lngLatToWorld([116.46, 39.91]);
  const { lngLat, altitude } = map.worldToLngLat(world);
  void back;
  void lngLat;
  void altitude;

  const anchor = map.createAnchor([116.46, 39.91], 30);
  anchor.add(new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial({ color: '#ff5533' })));
  map.scene.add(new Mesh());
  map.camera.updateProjectionMatrix();
  map.renderer.setPixelRatio(1);
  map.requestRender();

  const off = map.on('moveend', () => undefined);
  off();
  const handler = (e: MapEvent) => void e.type;
  map.on('idle', handler);
  map.off('idle', handler);

  const f: Feature | null = map.queryFeatures({ x: 100, y: 100 });
  if (f) {
    const again = map.getFeature(f.id);
    map.setFeatureState(f.id, { highlight: true, color: '#ff0000' });
    void again?.provenance.height;
  }

  const marker = map.addMarker({ lngLat: [116.46, 39.91], element: document.createElement('div'), anchor: 'center' });
  marker.setLngLat([116.461, 39.911]);
  marker.remove();
  const layer: OverlayLayer = { id: 'box', type: 'custom', object: new Mesh(), lngLat: [116.46, 39.91] };
  map.addLayer(layer);
  map.removeLayer('box');

  await map.setStyle('dark');
  const filter: ProvenanceFilter = { buildings: { minHeightProvenance: 'observed' }, trees: { inferred: false } };
  map.setFilter(filter);

  await map.whenIdle({ timeoutMs: 10000 });
  const stats: MapStats = map.getStats({ raw: true });
  void stats.tiles.visible;
  map.resize();
  map.pause(true);
  map.pause(false);
  await map.dispose();
}

export async function exportView(map: CityMap) {
  await map.whenIdle();
  const {blob: png} = await map.exportPNG();
  const {blob: glb, tileIds} = await map.exportGLB({scope:'loaded'});
  return {png,glb,tileIds};
}
