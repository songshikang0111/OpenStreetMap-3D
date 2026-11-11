// createMap: map-style SDK over static City Ink tiles (04). Owns the camera and the render loop in standalone mode.
import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  decodeCoverage,
  lngLatToMercator,
  mercatorToLngLat,
  satisfiesRange,
  tileKey,
  tileToWorldMatrix,
  validateTileset,
  resolveTileUrl,
  parentTile,
  childTiles,
} from '@city-ink/tiles';
import type { Coverage, Diagnostic, LngLat, TileId, Tileset } from '@city-ink/tiles';
import { DEFAULT_FOV, Transform } from './transform.js';
import { selectTiles } from './selection.js';
import type { DesiredTile } from './selection.js';
import { WorkerPool } from './pool.js';
import type { WorkerLike } from './pool.js';
import type { FeatureRecord, WorkerResponse } from './worker-core.js';
import { MaterialLibrary, buildTileObject } from './tile-object.js';
import type { RoleStyle, TileObject } from './tile-object.js';
import { Controls } from './controls.js';
import { BUILTIN_STYLES, resolveStyle } from './styles.js';
import type {
  AnimationOptions,
  Budget,
  CameraOptions,
  CityMap,
  Feature,
  MapEvent,
  MapEventType,
  MapOptions,
  MapStats,
  Marker,
  MarkerOptions,
  OverlayLayer,
  ProvenanceFilter,
  Quality,
  StylePack,
  StyleSpec,
} from './types.js';

export const RUNTIME_VERSION = '2.0.0';

export const QUALITY_BUDGETS: Record<Quality, Budget> = {
  low: {
    residentBytes: 96 * 2 ** 20,
    visibleTriangles: 250_000,
    drawCalls: 600,
    concurrentLoads: 4,
    pixelRatio: 1.5,
    nearDetails: 4000,
    shadowQuality: 0,
    aoQuality: 0,
    hysteresis: 0.18,
    minResidenceMs: 750,
    unloadDelayMs: 1200,
    prefetchMargin: 0.1,
    workerQueue: 8,
    uploadMsPerFrame: 6,
  },
  balanced: {
    residentBytes: 128 * 2 ** 20,
    visibleTriangles: 600_000,
    drawCalls: 1200,
    concurrentLoads: 6,
    pixelRatio: 2,
    nearDetails: 18000,
    shadowQuality: 1,
    aoQuality: 1,
    hysteresis: 0.18,
    minResidenceMs: 750,
    unloadDelayMs: 1200,
    prefetchMargin: 0.15,
    workerQueue: 12,
    uploadMsPerFrame: 4,
  },
  high: {
    residentBytes: 256 * 2 ** 20,
    visibleTriangles: 1_500_000,
    drawCalls: 2400,
    concurrentLoads: 6,
    pixelRatio: 2,
    nearDetails: 40000,
    shadowQuality: 2,
    aoQuality: 1,
    hysteresis: 0.18,
    minResidenceMs: 750,
    unloadDelayMs: 1200,
    prefetchMargin: 0.2,
    workerQueue: 16,
    uploadMsPerFrame: 4,
  },
};

const FLOATING_ORIGIN_METERS = 10_000;
const MAX_RETRIES = 3;

class MapError extends Error implements Diagnostic {
  constructor(
    readonly code: string,
    readonly stage: string,
    message: string,
    readonly hint?: string,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'MapError';
  }
}

type TileState = 'queued' | 'loading' | 'generating' | 'ready' | 'failed' | 'missing';

interface TileEntry {
  key: string;
  id: TileId;
  level: number;
  state: TileState;
  object: TileObject | null;
  features: FeatureRecord[] | null;
  featureIndex?: Map<string, FeatureRecord> | null;
  renderIndex?: Map<number, FeatureRecord> | null;
  priority: number;
  retries: number;
  retryAt: number;
  controller: AbortController | null;
  cancelWork: (() => void) | null;
  lastWanted: number;
  shownAt: number;
  visible: boolean;
  bytes: number;
}

interface PendingUpload {
  entry: TileEntry;
  response: Extract<WorkerResponse, { type: 'result' }>;
}

function defaultWorker(url?: string | URL): WorkerLike {
  if (url) return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

function easeCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

async function readJSON(url: string, options: MapOptions, signal: AbortSignal): Promise<unknown> {
  if (options.readAsset) return options.readAsset(url, { signal, responseType: 'json' });
  const r = await fetch(url, { signal });
  if (!r.ok)
    throw new MapError(
      'TILESET_FETCH_FAILED',
      'load',
      `GET ${url} returned ${r.status}.`,
      'Check the tiles URL and CORS headers.',
      url,
    );
  return r.json();
}

async function readBinary(url: string, options: MapOptions, signal: AbortSignal): Promise<ArrayBuffer> {
  if (options.readAsset) return (await options.readAsset(url, { signal, responseType: 'arraybuffer' })) as ArrayBuffer;
  const r = await fetch(url, { signal });
  if (!r.ok)
    throw Object.assign(new MapError('TILE_FETCH_FAILED', 'load', `GET ${url} returned ${r.status}.`, undefined, url), {
      status: r.status,
    });
  return r.arrayBuffer();
}

export async function createMap(options: MapOptions): Promise<CityMap> {
  if (!options?.container) throw new MapError('MAP_CONTAINER_MISSING', 'init', 'createMap needs a container element.');
  const map = new CityMapImpl(options);
  await map.init();
  return map;
}

export class CityMapImpl implements CityMap {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly transform = new Transform();
  private tileset!: Tileset;
  private tilesetUrl = '';
  private coverage: Coverage | null = null;
  private readonly tilesRoot = new Group();
  private readonly anchorsRoot = new Group();
  private readonly anchors = new Set<{ group: Group; lngLat: LngLat; altitude: number }>();
  private readonly tiles = new Map<string, TileEntry>();
  private readonly uploads: PendingUpload[] = [];
  private readonly refined = new Set<string>();
  private readonly listeners = new Map<MapEventType, Set<(e: MapEvent) => void>>();
  private readonly featureState = new Map<string, Record<string, unknown>>();
  private readonly markers = new Set<{ element: HTMLElement; lngLat: LngLat; altitude: number; anchor: string }>();
  private readonly customLayers = new Map<string, Group>();
  private readonly materials = new MaterialLibrary();
  private readonly ground: Mesh;
  private readonly sun = new DirectionalLight('#ffffff', 1.2);
  private readonly hemi = new HemisphereLight('#ffffff', '#d8d4c7', 0.9);
  private readonly ambient = new AmbientLight('#ffffff', 0.2);
  private readonly budget: Budget;
  private readonly pool: WorkerPool;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLDivElement;
  private attribution: HTMLDivElement | null = null;
  private controls: Controls | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  private frame = 0;
  private raf = 0;
  private dirty = true;
  private moving = false;
  private paused = false;
  private disposed = false;
  private animation: { cancel(): void } | null = null;
  private idleWaiters: (() => void)[] = [];
  private wasIdle = false;
  private lastFrameTime = 0;
  private readonly frameIntervals: number[] = [];
  private uploadLastMs = 0;
  private uploadMaxMs = 0;
  private readonly requestStats = { started: 0, completed: 0, cancelled: 0, failed: 0, bytes: 0 };
  private emptyNotified = false;
  private filter: ProvenanceFilter = {};
  private styleId = 'light';
  private generationOptions: { seed?: number; inferRoofs?: boolean } = {};
  private lastDesired: DesiredTile[] = [];
  private lastUpdate = 0;

  constructor(private readonly options: MapOptions) {
    const quality = options.quality ?? 'balanced';
    this.budget =
      typeof quality === 'string' ? { ...QUALITY_BUDGETS[quality] } : { ...QUALITY_BUDGETS.balanced, ...quality };
    const container = options.container;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    container.appendChild(this.overlay);
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.budget.pixelRatio));
    this.transform.limits = {
      minZoom: options.minZoom ?? 12,
      maxZoom: options.maxZoom ?? 20,
      maxPitch: options.maxPitch ?? 80,
    };
    this.ground = new Mesh(
      new CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: '#f3f2ee' }),
    );
    this.ground.position.y = -0.35;
    this.ground.renderOrder = -1;
    this.sun.position.set(-0.5, 0.8, -0.3);
    this.scene.add(this.ground, this.tilesRoot, this.anchorsRoot, this.sun, this.sun.target, this.hemi, this.ambient);
    this.tilesRoot.matrixAutoUpdate = false;
    const hw = (globalThis.navigator?.hardwareConcurrency ?? 4) - 1;
    const size = Math.max(1, Math.floor(options.workers ?? Math.min(4, hw)));
    this.pool = new WorkerPool(size, () => defaultWorker(options.workerUrl));
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(container);
  }

  // ------------------------------------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    const controller = new AbortController();
    let json: unknown = this.options.tiles;
    if (typeof this.options.tiles === 'string') {
      this.tilesetUrl = new URL(this.options.tiles, globalThis.location?.href ?? 'http://localhost/').href;
      json = await readJSON(this.tilesetUrl, this.options, controller.signal);
    } else this.tilesetUrl = globalThis.location?.href ?? 'http://localhost/';
    const valid = validateTileset(json);
    if (!valid.valid) {
      const first = valid.diagnostics[0]!;
      throw Object.assign(
        new MapError(
          first.code,
          'tileset',
          first.message,
          first.hint ?? 'The tileset.json does not match this runtime.',
        ),
        {
          diagnostics: valid.diagnostics,
        },
      );
    }
    this.tileset = valid.value!;
    if (!satisfiesRange(RUNTIME_VERSION, this.tileset.generator.compatibleRuntime))
      this.diagnostic({
        code: 'RUNTIME_VERSION_MISMATCH',
        stage: 'tileset',
        message: `Tiles from ${this.tileset.generator.id} ${this.tileset.generator.version} declare ${this.tileset.generator.compatibleRuntime}; this runtime is ${RUNTIME_VERSION}.`,
        hint: 'Rebuild the tiles or use a matching runtime.',
      });
    try {
      const url = new URL(this.tileset.coverage.index, this.tilesetUrl).href;
      this.coverage = decodeCoverage(await readBinary(url, this.options, controller.signal));
    } catch (error) {
      this.diagnostic({
        code: 'COVERAGE_UNAVAILABLE',
        stage: 'tileset',
        message: `Coverage index could not be read: ${(error as Error).message}`,
        hint: 'Every tile in bounds will be requested.',
      });
    }
    const build = this.tileset.build?.options ?? {};
    this.generationOptions = { seed: this.tileset.build?.seed ?? 1, inferRoofs: Boolean(build.inferRoofs) };
    const [lng, lat, zoom] = this.tileset.center;
    this.transform.anchor = this.options.center ?? [lng, lat];
    this.transform.set({
      center: this.options.center ?? [lng, lat],
      zoom: this.options.zoom ?? zoom,
      pitch: this.options.pitch ?? 0,
      bearing: this.options.bearing ?? 0,
      fov: this.options.fov ?? DEFAULT_FOV,
    });
    if (this.options.filter) this.filter = this.options.filter;
    await this.setStyle(this.options.style ?? 'light');
    if (this.options.attributionControl !== false) this.addAttribution();
    if (this.options.interactive !== false)
      this.controls = new Controls(this.controlHost(), {
        dragPan: true,
        scrollZoom: true,
        dragRotate: true,
        touchZoomRotate: true,
        touchPitch: true,
        inertia: true,
      });
    this.resize();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private assertAlive() {
    if (this.disposed)
      throw new MapError('MAP_DISPOSED', 'api', 'This map has been disposed.', 'Create a new map with createMap.');
  }

  private addAttribution() {
    const a = this.tileset.attribution;
    const div = document.createElement('div');
    div.className = 'city-attribution';
    div.style.cssText =
      'position:absolute;right:0;bottom:0;padding:2px 6px;font:11px/1.4 system-ui,sans-serif;background:rgba(255,255,255,.75);color:#333;pointer-events:auto';
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = a.text;
    link.style.color = 'inherit';
    div.appendChild(link);
    this.options.container.appendChild(div);
    this.attribution = div;
  }

  private controlHost() {
    return {
      transform: this.transform,
      element: this.canvas,
      move: (c: CameraOptions, e?: Event) => this.applyCamera(c, e),
      begin: (e?: Event) => this.beginMove(e),
      end: (e?: Event) => this.endMove(e),
      stopAnimation: () => this.stopAnimation(),
      click: (point: { x: number; y: number }, e: Event, double: boolean) => this.handleClick(point, e, double),
      pointerMove: (point: { x: number; y: number }, e: Event) => {
        if (this.listeners.get('pointermove')?.size)
          this.fire({
            type: 'pointermove',
            point,
            lngLat: this.unproject(point) ?? undefined,
            feature: null,
            originalEvent: e,
          });
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stopAnimation();
    this.controls?.dispose();
    this.resizeObserver?.disconnect();
    this.pool.terminate();
    for (const entry of this.tiles.values()) this.unload(entry);
    this.tiles.clear();
    for (const g of this.customLayers.values()) g.removeFromParent();
    this.materials.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as MeshBasicMaterial).dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.overlay.remove();
    this.attribution?.remove();
    this.listeners.clear();
    for (const w of this.idleWaiters) w();
    this.idleWaiters = [];
  }

  // ------------------------------------------------------------------------------------------- camera

  getCenter(): LngLat {
    this.assertAlive();
    return [...this.transform.center] as LngLat;
  }
  getZoom() {
    this.assertAlive();
    return this.transform.zoom;
  }
  getPitch() {
    this.assertAlive();
    return this.transform.pitch;
  }
  getBearing() {
    this.assertAlive();
    return this.transform.bearing;
  }

  private applyCamera(c: CameraOptions, e?: Event) {
    const before = this.transform.state;
    this.transform.set(c);
    this.checkFloatingOrigin();
    const after = this.transform.state;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.dirty = true;
      this.fire({ type: 'move', ...(e ? { originalEvent: e } : {}) });
    }
  }

  private beginMove(e?: Event) {
    if (!this.moving) {
      this.moving = true;
      this.fire({ type: 'movestart', ...(e ? { originalEvent: e } : {}) });
    }
  }

  private endMove(e?: Event) {
    if (this.moving) {
      this.moving = false;
      this.fire({ type: 'moveend', ...(e ? { originalEvent: e } : {}) });
    }
  }

  jumpTo(o: CameraOptions): void {
    this.assertAlive();
    this.stopAnimation();
    this.beginMove();
    this.applyCamera(o);
    this.endMove();
  }

  private stopAnimation() {
    this.animation?.cancel();
    this.animation = null;
  }

  private animate(
    target: CameraOptions,
    o: AnimationOptions,
    path?: (t: number, from: ReturnType<Transform['state']['valueOf']>) => CameraOptions,
  ): Promise<void> {
    this.assertAlive();
    this.stopAnimation();
    const from = this.transform.state;
    const duration = Math.max(0, o.duration ?? 600);
    const easing = o.easing ?? easeCubic;
    const fromM = lngLatToMercator(from.center);
    const toM = lngLatToMercator(target.center ?? from.center);
    let dBearing = (target.bearing ?? from.bearing) - from.bearing;
    dBearing = ((((dBearing + 180) % 360) + 360) % 360) - 180;
    this.beginMove();
    return new Promise<void>((resolve) => {
      if (duration === 0) {
        this.applyCamera(target);
        this.endMove();
        resolve();
        return;
      }
      const start = performance.now();
      let frame = 0;
      const step = () => {
        const raw = Math.min(1, (performance.now() - start) / duration);
        const k = easing(raw);
        const c = path
          ? path(k, from)
          : {
              center: mercatorToLngLat(fromM[0] + (toM[0] - fromM[0]) * k, fromM[1] + (toM[1] - fromM[1]) * k),
              zoom: from.zoom + ((target.zoom ?? from.zoom) - from.zoom) * k,
            };
        this.applyCamera({
          ...c,
          pitch: from.pitch + ((target.pitch ?? from.pitch) - from.pitch) * k,
          bearing: from.bearing + dBearing * k,
        });
        if (raw < 1) frame = requestAnimationFrame(step);
        else {
          this.animation = null;
          this.endMove();
          resolve();
        }
      };
      frame = requestAnimationFrame(step);
      this.animation = {
        cancel: () => {
          cancelAnimationFrame(frame);
          this.endMove();
          resolve();
        },
      };
    });
  }

  easeTo(o: CameraOptions & AnimationOptions): Promise<void> {
    return this.animate(o, o);
  }

  flyTo(o: CameraOptions & AnimationOptions): Promise<void> {
    const from = this.transform.state;
    const fromM = lngLatToMercator(from.center);
    const toM = lngLatToMercator(o.center ?? from.center);
    const toZoom = o.zoom ?? from.zoom;
    // Zoom out in the middle of the flight in proportion to the distance (screen widths) travelled.
    const distPx = Math.hypot(toM[0] - fromM[0], toM[1] - fromM[1]) * this.transform.worldSize;
    const bump = Math.max(0, Math.log2(Math.max(1, distPx / Math.max(1, this.transform.width))));
    return this.animate(
      o,
      { duration: o.duration ?? Math.min(4000, 800 + bump * 400), ...(o.easing ? { easing: o.easing } : {}) },
      (k) => ({
        center: mercatorToLngLat(fromM[0] + (toM[0] - fromM[0]) * k, fromM[1] + (toM[1] - fromM[1]) * k),
        zoom: from.zoom + (toZoom - from.zoom) * k - bump * 4 * k * (1 - k),
      }),
    );
  }

  fitBounds(bounds: [number, number, number, number], o: { padding?: number } & AnimationOptions = {}): Promise<void> {
    const [w, s, e, n] = bounds;
    const a = lngLatToMercator([w, n]);
    const b = lngLatToMercator([e, s]);
    const pad = o.padding ?? 20;
    const width = Math.max(1, this.transform.width - 2 * pad);
    const height = Math.max(1, this.transform.height - 2 * pad);
    const zoom = Math.log2(Math.min(width / ((b[0] - a[0]) * 512), height / ((b[1] - a[1]) * 512)));
    const center = mercatorToLngLat((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    return this.easeTo({ center, zoom, bearing: 0, pitch: 0, ...o });
  }

  // ------------------------------------------------------------------------------------------- coordinates

  project(lngLat: LngLat, altitude = 0) {
    this.assertAlive();
    return this.transform.project(lngLat, altitude);
  }
  unproject(point: { x: number; y: number }) {
    this.assertAlive();
    return this.transform.unproject(point);
  }
  lngLatToWorld(lngLat: LngLat, altitude = 0) {
    this.assertAlive();
    return this.transform.lngLatToWorld(lngLat, altitude);
  }
  worldToLngLat(v: Vector3) {
    this.assertAlive();
    return this.transform.worldToLngLat(v);
  }

  get camera() {
    return this.transform.camera;
  }

  createAnchor(lngLat: LngLat, altitude = 0): Group {
    this.assertAlive();
    const group = new Group();
    group.name = 'city-anchor';
    const entry = { group, lngLat: [...lngLat] as LngLat, altitude };
    this.anchors.add(entry);
    group.position.copy(this.transform.lngLatToWorld(lngLat, altitude));
    group.userData.cityAnchor = entry;
    group.addEventListener('removed', () => this.anchors.delete(entry));
    this.anchorsRoot.add(group);
    this.dirty = true;
    return group;
  }

  /** Re-centres the world when the camera is far from the anchor (01 section 6.5). No events are fired. */
  private checkFloatingOrigin() {
    const c = this.transform.lngLatToWorld(this.transform.center);
    if (Math.hypot(c.x, c.z) < FLOATING_ORIGIN_METERS) return;
    this.transform.anchor = [...this.transform.center] as LngLat;
    this.transform.update();
    for (const entry of this.tiles.values()) if (entry.object) this.placeTile(entry);
    for (const a of this.anchors) a.group.position.copy(this.transform.lngLatToWorld(a.lngLat, a.altitude));
  }

  private placeTile(entry: TileEntry) {
    if (!entry.object) return;
    entry.object.group.matrix.fromArray(tileToWorldMatrix(entry.id, this.transform.anchor));
    entry.object.group.matrixWorldNeedsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------- events

  on(type: MapEventType, handler: (e: MapEvent) => void): () => void {
    this.assertAlive();
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  off(type: MapEventType, handler: (e: MapEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  private fire(e: MapEvent) {
    for (const h of [...(this.listeners.get(e.type) ?? [])])
      try {
        h(e);
      } catch (error) {
        if (e.type !== 'error')
          this.fire({
            type: 'error',
            error: { code: 'LISTENER_FAILED', stage: 'event', message: String((error as Error)?.message ?? error) },
          });
      }
  }

  private diagnostic(d: Diagnostic) {
    this.options.onDiagnostic?.(d);
  }

  private handleClick(point: { x: number; y: number }, e: Event, double: boolean) {
    const lngLat = this.unproject(point) ?? undefined;
    const feature = this.queryFeatures(point);
    this.fire({ type: double ? 'dblclick' : 'click', point, ...(lngLat ? { lngLat } : {}), feature, originalEvent: e });
  }

  // ------------------------------------------------------------------------------------------- features

  private toFeature(record: FeatureRecord): Feature {
    return {
      id: record.id,
      layer: record.layer,
      properties: { ...record.properties, ...record.tags },
      provenance: record.provenance,
      lngLat: record.lngLat,
      bounds: record.bounds,
    };
  }

  queryFeatures(point: { x: number; y: number }): Feature | null {
    this.assertAlive();
    const ray = new Raycaster();
    ray.setFromCamera(
      new Vector2((point.x / this.transform.width) * 2 - 1, 1 - (point.y / this.transform.height) * 2),
      this.transform.camera,
    );
    const meshes: Mesh[] = [];
    for (const entry of this.tiles.values()) if (entry.visible && entry.object) meshes.push(...entry.object.meshes);
    const hits = ray.intersectObjects(meshes, false);
    for (const hit of hits) {
      const geometry = (hit.object as Mesh).geometry;
      const ids = geometry.getAttribute('renderId');
      if (!ids || !hit.face) continue;
      const renderId = ids.getX(hit.face.a);
      const tileKeyOf = (hit.object.parent?.userData.tile as string) ?? '';
      const entry = this.tiles.get(tileKeyOf);
      if (entry?.features) entry.renderIndex ??= new Map(entry.features.map((f) => [f.renderId, f]));
      const record = entry?.renderIndex?.get(renderId);
      if (record) return this.toFeature(record);
    }
    return null;
  }

  getFeature(id: string): Feature | null {
    this.assertAlive();
    // Indexed lazily per tile: building a global id map on every upload costs main-thread time.
    for (const entry of this.tiles.values()) {
      if (!entry.features) continue;
      entry.featureIndex ??= new Map(entry.features.map((f) => [f.id, f]));
      const f = entry.featureIndex.get(id);
      if (f) return this.toFeature(f);
    }
    return null;
  }

  setFeatureState(id: string, state: Record<string, unknown>): void {
    this.assertAlive();
    this.featureState.set(id, { ...(this.featureState.get(id) ?? {}), ...state });
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------- overlays

  addMarker(o: MarkerOptions): Marker {
    this.assertAlive();
    const entry = {
      element: o.element,
      lngLat: [...o.lngLat] as LngLat,
      altitude: o.altitude ?? 0,
      anchor: o.anchor ?? 'bottom',
    };
    o.element.style.position = 'absolute';
    o.element.style.left = '0';
    o.element.style.top = '0';
    o.element.style.pointerEvents = 'auto';
    this.overlay.appendChild(o.element);
    this.markers.add(entry);
    this.dirty = true;
    return {
      setLngLat: (l: LngLat) => {
        entry.lngLat = [...l] as LngLat;
        this.dirty = true;
      },
      remove: () => {
        this.markers.delete(entry);
        entry.element.remove();
      },
    };
  }

  addLayer(layer: OverlayLayer): void {
    this.assertAlive();
    if (this.customLayers.has(layer.id))
      throw new MapError('LAYER_EXISTS', 'overlay', `Layer ${layer.id} already exists.`);
    if (layer.type !== 'custom')
      throw new MapError(
        'OVERLAY_UNSUPPORTED',
        'overlay',
        `Overlay type ${layer.type} is not available yet.`,
        'GeoJSON overlays arrive with WP-E; use type "custom".',
      );
    const anchor = this.createAnchor(layer.lngLat, layer.altitude ?? 0);
    anchor.add(layer.object);
    anchor.userData.layerId = layer.id;
    this.customLayers.set(layer.id, anchor);
  }

  removeLayer(id: string): void {
    this.assertAlive();
    const g = this.customLayers.get(id);
    if (!g) return;
    g.removeFromParent();
    this.customLayers.delete(id);
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------- style and filter

  async setStyle(style: string | StyleSpec | StylePack): Promise<void> {
    this.assertAlive();
    const resolved = resolveStyle(style);
    this.styleId = resolved.id;
    this.renderer.setClearColor(new Color(resolved.background));
    this.scene.background = new Color(resolved.background);
    this.scene.fog = new Fog(resolved.background, 1, 2);
    (this.ground.material as MeshBasicMaterial).color = new Color(resolved.ground);
    this.sun.intensity = resolved.sun;
    this.hemi.intensity = resolved.ambient;
    this.materials.restyle(resolved.roles as Record<string, RoleStyle>, resolved.foliage);
    this.dirty = true;
    this.fire({ type: 'styledata' });
  }

  setFilter(filter: ProvenanceFilter): void {
    this.assertAlive();
    this.filter = { ...filter };
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------- loading

  private entry(d: DesiredTile): TileEntry {
    let e = this.tiles.get(d.key);
    if (!e) {
      e = {
        key: d.key,
        id: d.id,
        level: d.level,
        state: 'queued',
        object: null,
        features: null,
        priority: d.priority,
        retries: 0,
        retryAt: 0,
        controller: null,
        cancelWork: null,
        lastWanted: 0,
        shownAt: 0,
        visible: false,
        bytes: 0,
      };
      this.tiles.set(d.key, e);
    }
    e.priority = d.priority;
    return e;
  }

  private load(entry: TileEntry) {
    entry.state = 'loading';
    const controller = new AbortController();
    entry.controller = controller;
    const url = resolveTileUrl(this.tileset, this.tilesetUrl, entry.id.z, entry.id.x, entry.id.y);
    this.requestStats.started++;
    readBinary(url, this.options, controller.signal)
      .then((buffer) => {
        if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        this.requestStats.completed++;
        this.requestStats.bytes += buffer.byteLength;
        entry.controller = null;
        entry.state = 'generating';
        const work = this.pool.run(buffer, entry.priority, this.generationOptions);
        entry.cancelWork = work.cancel;
        return work.promise;
      })
      .then((response) => {
        entry.cancelWork = null;
        if (this.disposed) return;
        if (response.type === 'error')
          throw Object.assign(new Error(response.diagnostic.message), {
            diagnostic: response.diagnostic,
            permanent: true,
          });
        this.uploads.push({ entry, response });
        this.uploads.sort((a, b) => a.entry.priority - b.entry.priority);
        this.dirty = true;
      })
      .catch((error: Error & { diagnostic?: Diagnostic; permanent?: boolean; status?: number }) => {
        entry.controller = null;
        entry.cancelWork = null;
        if (this.disposed) return;
        if (error.name === 'AbortError') {
          this.requestStats.cancelled++;
          if (entry.state !== 'ready') entry.state = 'queued';
          return;
        }
        this.requestStats.failed++;
        entry.retries++;
        if (!error.permanent && entry.retries < MAX_RETRIES) {
          entry.state = 'queued';
          entry.retryAt = performance.now() + 250 * 2 ** entry.retries;
        } else {
          entry.state = 'failed';
          const d: Diagnostic = error.diagnostic ?? {
            code: 'TILE_LOAD_FAILED',
            stage: 'load',
            message: error.message,
            url,
            tileId: entry.key,
          };
          this.diagnostic({ ...d, tileId: entry.key });
          this.fire({ type: 'tileerror', tile: entry.key, error: { ...d, tileId: entry.key } });
        }
        this.dirty = true;
      });
  }

  private cancel(entry: TileEntry) {
    entry.controller?.abort();
    entry.controller = null;
    entry.cancelWork?.();
    entry.cancelWork = null;
    if (entry.state === 'loading' || entry.state === 'generating') entry.state = 'queued';
  }

  private unload(entry: TileEntry) {
    this.cancel(entry);
    if (entry.object) {
      entry.object.group.removeFromParent();
      entry.object.dispose();
      entry.object = null;
    }
    entry.features = null;
    entry.featureIndex = null;
    entry.visible = false;
    entry.bytes = 0;
    if (entry.state === 'ready') entry.state = 'queued';
  }

  private processUploads(now: number) {
    const start = performance.now();
    let spent = 0;
    while (this.uploads.length && (spent < this.budget.uploadMsPerFrame || spent === 0)) {
      const { entry, response } = this.uploads.shift()!;
      if (!this.tiles.has(entry.key) || entry.object) continue;
      const object = buildTileObject(response.generated, this.materials);
      object.group.userData.tile = entry.key;
      entry.object = object;
      entry.features = response.features;
      entry.bytes = object.bytes;
      entry.state = 'ready';
      entry.retries = 0;
      this.placeTile(entry);
      this.dirty = true;
      this.fire({ type: 'tileload', tile: entry.key });
      spent = performance.now() - start;
    }
    this.uploadLastMs = spent;
    this.uploadMaxMs = Math.max(this.uploadMaxMs, spent);
    void now;
  }

  /** Replacement rules (04 section 5.2): never show a region with neither a parent nor complete children. */
  private updateTiles(now: number) {
    const finest = this.tileset.levels[this.tileset.levels.length - 1]!;
    const maxDistance = Math.max(2000, this.transform.cameraToCenterDistance * this.transform.unitsPerPixel * 8);
    const desired = (this.lastDesired = selectTiles(
      this.transform,
      this.tileset,
      this.coverage,
      {
        maximumScreenSpaceError: this.options.maximumScreenSpaceError ?? 16,
        prefetchMargin: this.budget.prefetchMargin,
        hysteresis: this.budget.hysteresis,
        maxDistance,
      },
      this.refined,
    ));
    const wanted = new Set<string>();
    for (const d of desired) {
      const e = this.entry(d);
      e.lastWanted = now;
      wanted.add(d.key);
    }
    this.lastUpdate = now;
    // Ancestors of every desired tile are wanted too: they load first (as fallback cover) and are never evicted
    // while a descendant is wanted, so no region is left without a parent or complete children (04 section 5.2).
    const levelZoomsAll = this.tileset.levels.map((l) => l.zoom);
    const ancestors: DesiredTile[] = [];
    for (const d of desired)
      for (let l = d.level - 1; l >= 0; l--) {
        const id = parentTile(d.id, levelZoomsAll[l]!);
        const key = tileKey(id);
        if (wanted.has(key) || (this.coverage && !this.coverage.has(id))) continue;
        wanted.add(key);
        ancestors.push({ key, id, level: l, priority: d.priority * 0.5, sse: 0 });
      }
    for (const a of ancestors) {
      const e = this.entry(a);
      e.lastWanted = now;
    }
    this.lastDesired = desired.slice();
    desired.unshift(...ancestors.filter((a, i, list) => list.findIndex((b) => b.key === a.key) === i));
    // Fog follows the visible distance limit.
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = maxDistance * 0.55;
      this.scene.fog.far = maxDistance * 1.05;
    }
    // Decide visibility.
    const show = new Set<string>();
    const levelZooms = this.tileset.levels.map((l) => l.zoom);
    for (const d of desired) {
      const e = this.tiles.get(d.key)!;
      if (e.state === 'ready') {
        show.add(d.key);
        continue;
      }
      if (d.level > 0) {
        // Child not ready: keep the parent; hide its other children until all are ready.
        const parent = parentTile(d.id, levelZooms[d.level - 1]!);
        const pk = tileKey(parent);
        if (this.tiles.get(pk)?.state === 'ready') show.add(pk);
      } else {
        // Parent not ready (zooming out): keep any ready children shown until it arrives.
        const next = levelZooms[d.level + 1];
        if (next !== undefined)
          for (const c of childTiles(d.id, next))
            if (this.tiles.get(tileKey(c))?.state === 'ready') show.add(tileKey(c));
      }
    }
    // A parent shown as fallback hides every child of it (avoid overlapping levels).
    for (const key of [...show]) {
      const e = this.tiles.get(key)!;
      const next = levelZooms[e.level + 1];
      if (next === undefined || !show.has(key)) continue;
      const children = childTiles(e.id, next).map(tileKey);
      const wantedChildren = children.filter((c) => wanted.has(c));
      if (wantedChildren.length && wantedChildren.every((c) => this.tiles.get(c)?.state === 'ready')) show.delete(key);
      else for (const c of children) show.delete(c);
    }
    // Minimum residence: keep recently shown tiles a little longer to avoid flicker on small moves.
    for (const e of this.tiles.values())
      if (e.visible && !show.has(e.key) && now - e.shownAt < this.budget.minResidenceMs && e.state === 'ready') {
        // Keep it only if nothing else now covers the same ground (never stack two levels).
        const covered = [...show].some((k) => overlaps(this.tiles.get(k)!.id, e.id));
        if (!covered) show.add(e.key);
      }
    for (const e of this.tiles.values()) {
      const visible = show.has(e.key);
      if (visible && !e.visible && e.object) {
        this.tilesRoot.add(e.object.group);
        e.shownAt = now;
      } else if (!visible && e.visible && e.object) e.object.group.removeFromParent();
      e.visible = visible && !!e.object;
    }
    // Loads: cancel stale work, start the most important queued tiles within concurrency and queue budgets.
    for (const e of this.tiles.values())
      if (!wanted.has(e.key) && (e.state === 'loading' || e.state === 'generating')) {
        this.cancel(e);
      }
    const inFlight = [...this.tiles.values()].filter((e) => e.state === 'loading').length;
    const inWorkers = this.pool.queued + this.pool.running;
    let slots = Math.min(this.budget.concurrentLoads - inFlight, this.budget.workerQueue - inWorkers);
    for (const d of desired) {
      if (slots <= 0) break;
      const e = this.tiles.get(d.key)!;
      if (e.state === 'queued' && now >= e.retryAt) {
        this.load(e);
        slots--;
      }
    }
    // Unload tiles that are neither wanted nor shown, after a delay; then enforce the resident budget (LRU).
    let resident = 0;
    for (const e of this.tiles.values()) resident += e.bytes;
    // Ancestors of visible tiles stay resident so zooming out never shows a region without a parent (AC406).
    const pinned = new Set<string>();
    for (const e of this.tiles.values())
      if (e.visible) for (let l = e.level - 1; l >= 0; l--) pinned.add(tileKey(parentTile(e.id, levelZooms[l]!)));
    const evictable = [...this.tiles.values()]
      .filter((e) => !wanted.has(e.key) && !e.visible && !(pinned.has(e.key) && e.state === 'ready'))
      .sort((a, b) => a.lastWanted - b.lastWanted);
    for (const e of evictable) {
      const keepRoot = e.level === 0 && e.state === 'ready' && resident < this.budget.residentBytes * 0.5;
      if ((now - e.lastWanted > this.budget.unloadDelayMs && !keepRoot) || resident > this.budget.residentBytes) {
        resident -= e.bytes;
        this.unload(e);
        this.tiles.delete(e.key);
      }
    }
    if (!desired.length && !this.emptyNotified && this.transform.zoom < this.tileset.levels[0]!.zoom - 2) {
      this.emptyNotified = true;
      this.diagnostic({
        code: 'ZOOM_BELOW_CONTENT',
        stage: 'select',
        message: `Zoom ${this.transform.zoom.toFixed(1)} is far below the coarsest content level (${this.tileset.levels[0]!.zoom}); showing empty ground.`,
      });
    }
    void finest;
  }

  // ------------------------------------------------------------------------------------------- frame loop

  requestRender(): void {
    this.dirty = true;
  }

  pause(value = true): void {
    this.paused = value;
    if (!value) this.dirty = true;
  }

  resize(): void {
    if (this.disposed) return;
    const r = this.options.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.transform.resize(w, h);
    this.dirty = true;
  }

  private busy(): boolean {
    for (const e of this.tiles.values()) {
      if (e.state === 'loading' || e.state === 'generating') return true;
      // A wanted tile waiting for its retry backoff keeps the loop running.
      if (e.state === 'queued' && e.retries > 0 && e.lastWanted >= this.lastUpdate) return true;
    }
    return this.uploads.length > 0 || this.animation !== null || this.moving;
  }

  private pendingWanted(now: number): boolean {
    for (const e of this.tiles.values()) if (e.lastWanted >= this.lastUpdate && e.state === 'queued') return true;
    return false;
  }

  private tick(time: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.tick(t));
    if (this.paused) return;
    const now = performance.now();
    this.processUploads(now);
    const loading = this.busy();
    if (this.dirty || loading) {
      this.updateTiles(now);
      this.render(time);
      this.dirty = false;
      this.wasIdle = false;
    } else this.lastFrameTime = 0;
    const idle = !this.busy() && !this.pendingWanted(now) && !this.dirty;
    if (idle && !this.wasIdle) {
      this.wasIdle = true;
      this.fire({ type: 'idle' });
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private render(time: number) {
    const t = this.transform;
    const c = t.lngLatToWorld(t.center);
    const radius = Math.max(5000, t.camera.far * 1.2);
    this.ground.position.set(c.x, -0.35, c.z);
    this.ground.scale.setScalar(radius);
    this.sun.position.set(c.x - 400, 900, c.z - 250);
    this.sun.target.position.copy(c);
    this.scene.updateMatrixWorld();
    this.renderer.render(this.scene, t.camera);
    this.frame++;
    if (this.lastFrameTime) {
      this.frameIntervals.push(time - this.lastFrameTime);
      if (this.frameIntervals.length > 600) this.frameIntervals.shift();
    }
    this.lastFrameTime = time;
    this.positionMarkers();
  }

  private positionMarkers() {
    for (const m of this.markers) {
      const p = this.transform.project(m.lngLat, m.altitude);
      if (!p || p.x < -200 || p.y < -200 || p.x > this.transform.width + 200 || p.y > this.transform.height + 200) {
        m.element.style.display = 'none';
        continue;
      }
      m.element.style.display = '';
      const ty = m.anchor === 'bottom' ? '-100%' : m.anchor === 'top' ? '0' : '-50%';
      m.element.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, ${ty})`;
    }
  }

  whenIdle(o: { timeoutMs?: number } = {}): Promise<void> {
    this.assertAlive();
    return new Promise<void>((resolve, reject) => {
      const timeout = o.timeoutMs ?? 30000;
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter((w) => w !== done);
        reject(new MapError('IDLE_TIMEOUT', 'api', `The map did not become idle within ${timeout} ms.`));
      }, timeout);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.idleWaiters.push(done);
      this.wasIdle = false;
      this.dirty = true;
    });
  }

  getStats(o: { raw?: boolean } = {}): MapStats {
    this.assertAlive();
    const info = this.renderer.info;
    const counts = { visible: 0, loaded: 0, loading: 0, queued: 0, failed: 0 };
    let resident = 0;
    for (const e of this.tiles.values()) {
      if (e.visible) counts.visible++;
      if (e.state === 'ready') counts.loaded++;
      if (e.state === 'loading' || e.state === 'generating') counts.loading++;
      if (e.state === 'queued') counts.queued++;
      if (e.state === 'failed') counts.failed++;
      resident += e.bytes;
    }
    const sorted = [...this.pool.timings].sort((a, b) => a - b);
    const q = (p: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : null;
    const iv = [...this.frameIntervals].sort((a, b) => a - b);
    const t = this.transform;
    const stats: MapStats = {
      frame: this.frame,
      fps: iv.length ? 1000 / iv[Math.floor(iv.length / 2)]! : null,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      tiles: counts,
      requests: { ...this.requestStats },
      workers: {
        size: this.pool.size,
        busy: this.pool.running,
        queued: this.pool.queued,
        generateMs: { p50: q(0.5), p95: q(0.95) },
      },
      upload: { lastFrameMs: this.uploadLastMs, maxFrameMs: this.uploadMaxMs },
      residentBytes: resident,
      renderer: {
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      },
      camera: {
        center: [...t.center] as LngLat,
        zoom: t.zoom,
        pitch: t.pitch,
        bearing: t.bearing,
        anchor: [...t.anchor] as LngLat,
      },
    };
    if (o.raw)
      stats.raw = {
        frameIntervals: [...this.frameIntervals],
        generateMs: [...this.pool.timings],
        desired: this.lastDesired.map((d) => d.key),
        tiles: [...this.tiles.values()].map((e) => ({
          key: e.key,
          state: e.state,
          visible: e.visible,
          bytes: e.bytes,
        })),
        style: this.styleId,
        filter: this.filter,
        featureStates: this.featureState.size,
        styles: Object.keys(BUILTIN_STYLES),
      };
    return stats;
  }
}

function overlaps(a: TileId, b: TileId): boolean {
  if (a.z === b.z) return a.x === b.x && a.y === b.y;
  const [hi, lo] = a.z > b.z ? [a, b] : [b, a];
  const d = 2 ** (hi.z - lo.z);
  return Math.floor(hi.x / d) === lo.x && Math.floor(hi.y / d) === lo.y;
}
