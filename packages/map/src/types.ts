// Public types of @city-ink/map (04 section 3, frozen contract; optional fields may be added).
import type { Group, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { Diagnostic, LngLat, Tileset, Provenance } from '@city-ink/tiles';

export type { LngLat, Tileset, Diagnostic, Provenance };

export interface Budget {
  residentBytes: number;
  visibleTriangles: number;
  drawCalls: number;
  concurrentLoads: number;
  pixelRatio: number;
  nearDetails: number;
  shadowQuality: number;
  aoQuality: number;
  hysteresis: number;
  minResidenceMs: number;
  unloadDelayMs: number;
  prefetchMargin: number;
  /** Maximum tiles waiting for or inside workers. */
  workerQueue: number;
  /** Main-thread GPU upload time slice per frame (ms). */
  uploadMsPerFrame: number;
}

export type Quality = 'low' | 'balanced' | 'high';

export interface ProvenanceFilter {
  buildings?: { minHeightProvenance?: Provenance };
  trees?: { inferred?: boolean };
  roofs?: { inferred?: boolean };
  details?: boolean;
}

/** Same signature as the phase-one injectable reader. */
export type ReadAsset = (
  url: string,
  options: { signal?: AbortSignal; responseType: 'json' | 'arraybuffer' },
) => Promise<unknown>;

export interface StyleSpec {
  schemaVersion: number;
  id: string;
  [key: string]: unknown;
}

export interface StylePack {
  id: string;
  [key: string]: unknown;
}

export interface MapOptions {
  container: HTMLElement;
  tiles: string | Tileset;
  center?: LngLat;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  fov?: number;
  style?: string | StyleSpec | StylePack;
  quality?: Quality | Partial<Budget>;
  interactive?: boolean;
  attributionControl?: boolean;
  filter?: ProvenanceFilter;
  readAsset?: ReadAsset;
  workers?: number;
  minZoom?: number;
  maxZoom?: number;
  maxPitch?: number;
  /** Screen-space error threshold in CSS pixels for refining to the next level (default 16). */
  maximumScreenSpaceError?: number;
  /** Base URL of the worker module; defaults to the bundled worker. */
  workerUrl?: string | URL;
  onDiagnostic?(d: Diagnostic): void;
}

export interface CameraOptions {
  center?: LngLat;
  zoom?: number;
  pitch?: number;
  bearing?: number;
}

export interface AnimationOptions {
  duration?: number;
  easing?(t: number): number;
}

export type MapEventType =
  | 'click'
  | 'dblclick'
  | 'pointermove'
  | 'movestart'
  | 'move'
  | 'moveend'
  | 'idle'
  | 'tileload'
  | 'tileerror'
  | 'styledata'
  | 'error';

export interface Feature {
  id: string;
  layer: string;
  properties: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  lngLat: LngLat;
  bounds?: [number, number, number, number];
}

export interface MapEvent {
  type: MapEventType;
  lngLat?: LngLat;
  point?: { x: number; y: number };
  feature?: Feature | null;
  originalEvent?: Event;
  tile?: string;
  error?: Diagnostic;
}

export interface MarkerOptions {
  lngLat: LngLat;
  altitude?: number;
  element: HTMLElement;
  anchor?: 'center' | 'bottom' | 'top';
  occlude?: boolean;
}

export interface Marker {
  setLngLat(l: LngLat): void;
  remove(): void;
}

export type OverlayLayer =
  | {
      id: string;
      type: 'line';
      data: unknown;
      paint: { color: string; width: number; opacity?: number };
      altitude?: number;
    }
  | { id: string; type: 'fill'; data: unknown; paint: { color: string; opacity?: number }; altitude?: number }
  | {
      id: string;
      type: 'extrusion';
      data: unknown;
      paint: { color: string; opacity?: number; height: number | string; base?: number | string };
    }
  | { id: string; type: 'circle'; data: unknown; paint: { color: string; radius: number } }
  | { id: string; type: 'custom'; object: Object3D; lngLat: LngLat; altitude?: number };

export interface MapStats {
  frame: number;
  fps: number | null;
  drawCalls: number;
  triangles: number;
  tiles: { visible: number; loaded: number; loading: number; queued: number; failed: number };
  requests: { started: number; completed: number; cancelled: number; failed: number; bytes: number };
  workers: { size: number; busy: number; queued: number; generateMs: { p50: number | null; p95: number | null } };
  upload: { lastFrameMs: number; maxFrameMs: number };
  residentBytes: number;
  renderer: { geometries: number; textures: number; programs: number };
  camera: { center: LngLat; zoom: number; pitch: number; bearing: number; anchor: LngLat };
  raw?: unknown;
}

export interface CityMap {
  getCenter(): LngLat;
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  jumpTo(o: CameraOptions): void;
  easeTo(o: CameraOptions & AnimationOptions): Promise<void>;
  flyTo(o: CameraOptions & AnimationOptions): Promise<void>;
  fitBounds(bounds: [number, number, number, number], o?: { padding?: number } & AnimationOptions): Promise<void>;

  project(lngLat: LngLat, altitude?: number): { x: number; y: number } | null;
  unproject(point: { x: number; y: number }): LngLat | null;
  lngLatToWorld(lngLat: LngLat, altitude?: number): Vector3;
  worldToLngLat(v: Vector3): { lngLat: LngLat; altitude: number };

  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  createAnchor(lngLat: LngLat, altitude?: number): Group;
  requestRender(): void;

  on(type: MapEventType, handler: (e: MapEvent) => void): () => void;
  off(type: MapEventType, handler: (e: MapEvent) => void): void;

  queryFeatures(point: { x: number; y: number }): Feature | null;
  getFeature(id: string): Feature | null;
  setFeatureState(id: string, state: Record<string, unknown>): void;

  addMarker(o: MarkerOptions): Marker;
  addLayer(layer: OverlayLayer): void;
  removeLayer(id: string): void;

  setStyle(style: string | StyleSpec | StylePack): Promise<void>;
  setFilter(filter: ProvenanceFilter): void;

  whenIdle(o?: { timeoutMs?: number }): Promise<void>;
  getStats(o?: { raw?: boolean }): MapStats;
  resize(): void;
  pause(value?: boolean): void;
  dispose(): Promise<void>;
}
