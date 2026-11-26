// MapLibre GL JS custom layer (04 section 8, WP-H). The layer shares MapLibre's WebGL context and camera: every
// frame it copies MapLibre's center/zoom/pitch/bearing/fov into the same camera model used by createMap, which
// matches MapLibre's projection exactly (AC404), then draws the 3D city into the host's framebuffer.
// `maplibre-gl` is an optional peer dependency: this module never imports it, it only receives the host map.
import { CityMapImpl } from '../map.js';
import type { HostedOptions } from '../map.js';
import type {
  Feature,
  LngLat,
  MapEvent,
  MapEventType,
  MapOptions,
  MapStats,
  ProvenanceFilter,
  StylePack,
  StyleSpec,
} from '../types.js';

/** The subset of maplibregl.Map this adapter relies on (tested with maplibre-gl 6.16.0). */
export interface HostMap {
  getCanvas(): HTMLCanvasElement;
  getContainer(): HTMLElement;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  getPadding?(): { left: number; right: number; top: number; bottom: number };
  getVerticalFieldOfView?(): number;
  transform?: { fov?: number };
  triggerRepaint(): void;
  on(type: string, listener: (e: any) => void): unknown;
  off(type: string, listener: (e: any) => void): unknown;
}

export interface MapLibreLayerOptions
  extends Omit<MapOptions, 'container' | 'center' | 'zoom' | 'pitch' | 'bearing' | 'fov' | 'interactive'> {
  id: string;
  /** Who draws ground, roads and water: the host map (default) or this layer (experimental). */
  ground?: 'host' | 'self';
}

export interface CityMapLibreLayer {
  readonly id: string;
  readonly type: 'custom';
  readonly renderingMode: '3d';
  /** The Three.js renderer drawing into the host context (null before onAdd / after onRemove). */
  readonly renderer: import('three').WebGLRenderer | null;
  onAdd(map: HostMap, gl: WebGL2RenderingContext): void;
  render(gl: WebGL2RenderingContext, options?: unknown): void;
  onRemove(map: HostMap, gl: WebGL2RenderingContext): void;
  /** Resolves when the layer has loaded its tileset (rejects with the load diagnostic). */
  ready(): Promise<void>;
  queryFeatures(point: { x: number; y: number }): Feature | null;
  /** Screen position (CSS pixels) of a lng/lat as drawn by this layer. */
  project(lngLat: LngLat, altitude?: number): { x: number; y: number } | null;
  getFeature(id: string): Feature | null;
  setFeatureState(id: string, state: Record<string, unknown>): void;
  setStyle(style: string | StyleSpec | StylePack): Promise<void>;
  setFilter(filter: ProvenanceFilter): void;
  getStats(o?: { raw?: boolean }): MapStats;
  whenIdle(o?: { timeoutMs?: number }): Promise<void>;
  on(type: MapEventType, handler: (e: MapEvent) => void): () => void;
  off(type: MapEventType, handler: (e: MapEvent) => void): void;
}

const DEG = 180 / Math.PI;

function hostFov(map: HostMap): number {
  const v = map.getVerticalFieldOfView?.();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const f = map.transform?.fov;
  if (typeof f === 'number' && Number.isFinite(f)) return f > Math.PI ? f : f * DEG;
  return 36.86989764584402;
}

export function createMapLibreLayer(options: MapLibreLayerOptions): CityMapLibreLayer {
  let core: CityMapImpl | null = null;
  let host: HostMap | null = null;
  // ready() can be awaited before the host adds the layer. Link those waiters to this attachment's init.
  let readyPromise: Promise<void> | null = null;
  let waitForAdd: ((result: Promise<void>) => void)[] = [];
  function publishReady(promise: Promise<void>) {
    readyPromise = promise;
    for (const resolve of waitForAdd) resolve(promise);
    waitForAdd = [];
    promise.catch(() => undefined);
  }
  const pending: [MapEventType, (e: MapEvent) => void][] = [];
  const onClick = (e: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent: Event;
  }) => {
    if (!core) return;
    const feature = core.queryFeatures(e.point);
    core.emit({
      type: 'click',
      point: e.point,
      lngLat: [e.lngLat.lng, e.lngLat.lat],
      feature,
      originalEvent: e.originalEvent,
    });
  };
  const need = () => {
    if (!core) throw Object.assign(new Error('The layer is not on a map yet.'), { code: 'LAYER_NOT_ADDED' });
    return core;
  };
  return {
    id: options.id,
    type: 'custom',
    renderingMode: '3d',
    get renderer() {
      return core?.renderer ?? null;
    },
    onAdd(map, gl) {
      host = map;
      const canvas = map.getCanvas();
      const hosted: HostedOptions['hosted'] = {
        canvas,
        gl,
        ground: options.ground ?? 'host',
        camera: () => {
          const c = map.getCenter();
          const width = canvas.clientWidth || canvas.width;
          const height = canvas.clientHeight || canvas.height;
          const padding = map.getPadding?.();
          return {
            center: [c.lng, c.lat] as LngLat,
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
            fov: hostFov(map),
            width,
            height,
            offsetX: padding ? Math.max(-width, Math.min(width, padding.left - padding.right)) / 2 : 0,
            offsetY: padding ? Math.max(-height, Math.min(height, padding.top - padding.bottom)) / 2 : 0,
          };
        },
        repaint: () => map.triggerRepaint(),
      };
      try {
        core = new CityMapImpl({ ...options, container: map.getContainer(), hosted } as HostedOptions);
      } catch (error) {
        host = null;
        publishReady(Promise.reject(error));
        throw error;
      }
      for (const [type, handler] of pending) core.on(type, handler);
      const attaching = core;
      publishReady(
        attaching
          .init()
          .then(() => map.triggerRepaint())
          .catch(async (error) => {
            if (core === attaching) {
              core = null;
              map.off('click', onClick);
              await attaching.dispose();
            }
            throw error;
          }),
      );
      map.on('click', onClick);
    },
    render() {
      core?.hostedRender();
    },
    onRemove() {
      host?.off('click', onClick);
      void core?.dispose();
      core = null;
      host = null;
      readyPromise = null;
    },
    ready: () => readyPromise ?? new Promise<void>((resolve) => waitForAdd.push(resolve)),
    queryFeatures: (point) => need().queryFeatures(point),
    project: (lngLat, altitude) => need().project(lngLat, altitude),
    getFeature: (id) => need().getFeature(id),
    setFeatureState: (id, state) => {
      need().setFeatureState(id, state);
      host?.triggerRepaint();
    },
    setStyle: async (style) => {
      await need().setStyle(style);
      host?.triggerRepaint();
    },
    setFilter: (filter) => {
      need().setFilter(filter);
      host?.triggerRepaint();
    },
    getStats: (o) => need().getStats(o),
    whenIdle: (o) => need().whenIdle(o),
    on(type, handler) {
      if (!pending.some(([t, h]) => t === type && h === handler)) pending.push([type, handler]);
      core?.on(type, handler);
      return () => this.off(type, handler);
    },
    off(type, handler) {
      core?.off(type, handler);
      const i = pending.findIndex(([t, h]) => t === type && h === handler);
      if (i >= 0) pending.splice(i, 1);
    },
  };
}
