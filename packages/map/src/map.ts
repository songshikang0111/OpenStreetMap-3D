import { openTileArchive } from './archive.js';
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
  MeshStandardMaterial,
  MeshDepthMaterial,
  RGBADepthPacking,
  InstancedMesh,
  BoxGeometry,
  Matrix4,
  Object3D,
  PCFShadowMap,
  Raycaster,
  ShadowMaterial,
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
import { MaterialLibrary, prepareTileObject } from './tile-object.js';
import type { TileObject, TilePipeline, TileStylePack } from './tile-object.js';
import { Controls } from './controls.js';
import { Picker } from './picking/picker.js';
import { EMPTY_RULES, FLAG_FLATTEN, FLAG_HIDDEN, RuleTexture, stateUniforms } from './picking/feature-state.js';
import { evaluateExpression, ruleRoleApplies } from '@city-ink/styles/spec';
import { ROLE_LIST, groupOf } from '@city-ink/generators';
import { GpuFrameTimer } from '../../../src/runtime/gpu-timer.js';
import { nearbyFacadeFrames } from '../../../src/facade-layout.js';
import type { NearWall } from '@city-ink/generators';
import type { Pickable } from './picking/picker.js';
import { buildOverlay } from './overlays/overlay.js';
import type { BuiltOverlay } from './overlays/overlay.js';
import { BUILTIN_STYLES, StyleError, resolveStyle } from './styles.js';
import type { ResolvedStyleSpec } from '@city-ink/styles/spec';
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

/** Layers MapLibre draws itself in `ground: 'host'` mode (04 section 8). */
/** Inferred decorations hidden by `ProvenanceFilter.details = false`; kerbs, crossings, lamps and signals stay. */
const OPTIONAL_DETAILS = new Set(['car', 'person', 'bench']);
const HOST_GROUND_LAYERS = new Set(['ground', 'water', 'green', 'road', 'landscape']);

/** Internal options used by the MapLibre layer adapter. */
export interface HostedOptions extends MapOptions {
  hosted?: {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    ground: 'host' | 'self';
    /** Current host camera in MapLibre terms (CSS pixels for the viewport). */
    camera(): {
      center: LngLat;
      zoom: number;
      pitch: number;
      bearing: number;
      fov: number;
      width: number;
      height: number;
    };
    repaint(): void;
  };
}

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
  inferRoofs?: boolean;
  regenerating?: boolean;
  lastWanted: number;
  shownAt: number;
  visible: boolean;
  bytes: number;
  /** Complete facade walls for near-camera frames, sills and balconies (L1 only). */
  nearWalls?: NearWall[] | null;
  /** Copy of the tile bytes, to regenerate without refetching (ProvenanceFilter roofs). */
  buffer?: ArrayBuffer | null;
  /** Rule textures of the current style for this tile. */
  rules?: RuleTexture[];
  /** Incremented per load; completions of an older (cancelled) load are ignored. */
  loadToken?: number;
}

interface PendingUpload {
  /** Replaces an existing object (regeneration after a filter change). */
  replace?: boolean;
  entry: TileEntry;
  token: number;
  preparation?: ReturnType<typeof prepareTileObject>;
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
  try {
    await map.init();
    return map;
  } catch (error) {
    await map.dispose();
    throw error;
  }
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
  private readonly anchors = new Set<{ group: Group; lngLat: LngLat; altitude: number; originScale: number }>();
  private readonly tiles = new Map<string, TileEntry>();
  private readonly uploads: PendingUpload[] = [];
  private readonly refined = new Set<string>();
  private readonly listeners = new Map<MapEventType, Set<(e: MapEvent) => void>>();
  private readonly featureState = new Map<string, Record<string, unknown>>();
  private readonly markers = new Set<{
    element: HTMLElement;
    lngLat: LngLat;
    altitude: number;
    anchor: string;
    occlude: boolean;
  }>();
  private readonly overlays = new Map<string, { built: BuiltOverlay; anchor: Group }>();
  private readonly picker = new Picker();
  private readonly markerRay = new Raycaster();
  private readonly materials = new MaterialLibrary();
  private readonly ground: Mesh;
  /** Receives building shadows where no tile ground polygon covers the base plane. */
  private readonly shadowCatcher: Mesh;
  private spec: ResolvedStyleSpec | null = null;
  private pipeline: TilePipeline | null = null;
  /** Near-camera facade frames, sills and balconies (04 section 5.4 nearDetails budget). */
  private readonly nearFrames: InstancedMesh;
  private nearKey = '';
  private pack: TileStylePack | null = null;
  private readonly sun = new DirectionalLight('#ffffff', 1.2);
  private readonly hemi = new HemisphereLight('#ffffff', '#d8d4c7', 0.9);
  private readonly ambient = new AmbientLight('#ffffff', 0.2);
  private readonly budget: Budget;
  private readonly mobile: boolean;
  private readonly pool: WorkerPool;
  private readonly gpuTimer: GpuFrameTimer;
  private lastDrawCalls = 0;
  private readonly initController = new AbortController();
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
  private readonly hosted: HostedOptions['hosted'] | null;
  private lastDesired: DesiredTile[] = [];
  private lastUpdate = 0;

  private readonly options: MapOptions;

  constructor(options: MapOptions) {
    this.options = { ...options };
    this.mobile = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
    const quality = options.quality ?? (this.mobile ? 'low' : 'balanced');
    this.budget =
      typeof quality === 'string' ? { ...QUALITY_BUDGETS[quality] } : { ...QUALITY_BUDGETS.balanced, ...quality };
    const container = options.container;
    this.hosted = (options as HostedOptions).hosted ?? null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (this.hosted) {
      // MapLibre layer mode: share the host's canvas and WebGL context; the host owns size, clearing and the loop.
      this.canvas = this.hosted.canvas;
      this.renderer = new WebGLRenderer({ canvas: this.canvas, context: this.hosted.gl });
      this.renderer.autoClear = false;
      this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
      this.canvas.tabIndex = 0;
      container.appendChild(this.canvas);
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.budget.pixelRatio));
    }
    this.renderer.info.autoReset = false;
    this.gpuTimer = new GpuFrameTimer(this.renderer.getContext());
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    container.appendChild(this.overlay);
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
    this.shadowCatcher = new Mesh(this.ground.geometry, new ShadowMaterial({ color: '#000000', opacity: 0.22 }));
    this.shadowCatcher.receiveShadow = true;
    // Ink pipelines read these as paper-coloured ground (phase-one class 5).
    this.ground.userData.inkClass = this.shadowCatcher.userData.inkClass = 5;
    this.ground.name = 'ground plane';
    this.shadowCatcher.renderOrder = -1;
    this.sun.position.set(-0.5, 0.8, -0.3);
    // Shadows (06 section 3 shadowQuality): one sun shadow map fitted around the camera target every frame.
    this.renderer.shadowMap.enabled = this.budget.shadowQuality > 0;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.sun.castShadow = this.budget.shadowQuality > 0;
    const mapSize = this.budget.shadowQuality >= 2 ? 4096 : 2048;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.0004;
    this.nearFrames = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: '#dadbd4', roughness: 0.83 }),
      Math.max(1, this.budget.nearDetails),
    );
    this.nearFrames.name = 'Nearby frames, sills and balconies (inferred)';
    this.nearFrames.userData.inkClass = 4;
    this.nearFrames.castShadow = this.nearFrames.receiveShadow = true;
    this.nearFrames.count = 0;
    this.nearFrames.frustumCulled = false;
    this.nearFrames.matrixAutoUpdate = false;
    // An owned depth material, so dispose() releases the shadow program too (three's shared one never is).
    this.nearFrames.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.scene.add(
      this.ground,
      this.shadowCatcher,
      this.nearFrames,
      this.tilesRoot,
      this.anchorsRoot,
      this.sun,
      this.sun.target,
      this.hemi,
      this.ambient,
    );
    this.tilesRoot.matrixAutoUpdate = false;
    const hw = (globalThis.navigator?.hardwareConcurrency ?? 4) - 1;
    const size = Math.max(1, Math.floor(options.workers ?? Math.min(4, hw)));
    this.pool = new WorkerPool(size, () => defaultWorker(options.workerUrl));
    this.resizeObserver =
      !this.hosted && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(container);
    if (this.hosted) this.ground.visible = this.shadowCatcher.visible = false;
  }

  // ------------------------------------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    const controller = this.initController;
    if (
      typeof this.options.tiles === 'string' &&
      !this.options.readAsset &&
      new URL(this.options.tiles, globalThis.location?.href ?? 'http://localhost/').pathname.endsWith('.archive')
    ) {
      Object.assign(this.options, await openTileArchive(this.options.tiles, controller.signal));
    }
    let json: unknown = this.options.tiles;
    if (typeof this.options.tiles === 'string') {
      this.tilesetUrl = new URL(this.options.tiles, globalThis.location?.href ?? 'http://localhost/').href;
      json = await readJSON(this.tilesetUrl, this.options, controller.signal);
    } else this.tilesetUrl = globalThis.location?.href ?? 'http://localhost/';
    this.assertAlive();
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
      this.assertAlive();
      this.diagnostic({
        code: 'COVERAGE_UNAVAILABLE',
        stage: 'tileset',
        message: `Coverage index could not be read: ${(error as Error).message}`,
        hint: 'Every tile in bounds will be requested.',
      });
    }
    this.assertAlive();
    const build = this.tileset.build?.options ?? {};
    this.tilesetInferRoofs = Boolean(build.inferRoofs);
    this.generationOptions = {
      seed: this.tileset.build?.seed ?? 1,
      inferRoofs: this.tilesetInferRoofs && this.options.filter?.roofs?.inferred !== false,
    };
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
    this.assertAlive();
    if (this.options.attributionControl !== false) this.addAttribution();
    if (this.hosted) {
      this.syncHostCamera();
      return;
    }
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
    div.style.cssText = `position:absolute;${this.hosted ? 'left' : 'right'}:0;bottom:0;padding:2px 6px;font:11px/1.4 system-ui,sans-serif;background:rgba(255,255,255,.75);color:#333;pointer-events:auto`;
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
    this.initController.abort();
    this.gpuTimer.dispose();
    cancelAnimationFrame(this.raf);
    this.stopAnimation();
    this.controls?.dispose();
    this.resizeObserver?.disconnect();
    this.pool.terminate();
    for (const entry of this.tiles.values()) this.unload(entry);
    this.tiles.clear();
    for (const o of this.overlays.values()) o.built.dispose();
    this.overlays.clear();
    this.picker.dispose();
    this.pipeline?.dispose();
    this.pipeline = null;
    this.nearFrames.geometry.dispose();
    (this.nearFrames.material as MeshStandardMaterial).dispose();
    this.nearFrames.customDepthMaterial?.dispose();
    this.nearFrames.dispose();
    this.materials.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as MeshBasicMaterial).dispose();
    (this.shadowCatcher.material as ShadowMaterial).dispose();
    this.sun.shadow.map?.dispose();
    EMPTY_RULES.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    if (!this.hosted) {
      this.renderer.forceContextLoss?.();
      this.canvas.remove();
    } else this.renderer.resetState();
    this.overlay.remove();
    this.attribution?.remove();
    this.markers.clear();
    this.anchorsRoot.clear();
    this.anchors.clear();
    this.featureState.clear();
    for (const upload of this.uploads) upload.preparation?.return(undefined);
    this.uploads.length = 0;
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
    return this.anchorAt(lngLat, altitude, 0);
  }

  /** originScale > 0: content is in Mercator-relative metres at that scale and is rescaled to the world unit. */
  private anchorAt(lngLat: LngLat, altitude: number, originScale: number): Group {
    const group = new Group();
    group.name = 'city-anchor';
    const entry = { group, lngLat: [...lngLat] as LngLat, altitude, originScale };
    this.anchors.add(entry);
    this.placeAnchor(entry);
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
    for (const a of this.anchors) this.placeAnchor(a);
  }

  private placeAnchor(a: { group: Group; lngLat: LngLat; altitude: number; originScale: number }) {
    a.group.position.copy(this.transform.lngLatToWorld(a.lngLat, a.altitude));
    if (a.originScale > 0) a.group.scale.setScalar(this.transform.anchorScale / a.originScale);
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

  /** Dispatches an event to listeners (used by the MapLibre adapter for host clicks). */
  emit(e: MapEvent): void {
    this.fire(e);
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
    const items: Pickable[] = [];
    const slots: ({ kind: 'tile'; entry: TileEntry } | { kind: 'overlay'; built: BuiltOverlay })[] = [];
    for (const entry of this.tiles.values()) {
      if (!entry.visible || !entry.object || slots.length >= 254) continue;
      slots.push({ kind: 'tile', entry });
      for (const mesh of entry.object.pickable) items.push({ mesh, slot: slots.length, state: entry.object.state });
    }
    for (const { built } of this.overlays.values()) {
      if (slots.length >= 254) break;
      slots.push({ kind: 'overlay', built });
      for (const mesh of built.pickMeshes) items.push({ mesh, slot: slots.length, state: built.state });
    }
    if (!items.length) return null;
    this.scene.updateMatrixWorld();
    if (this.hosted) this.renderer.resetState();
    const hit = this.picker.pick(
      this.renderer,
      this.scene,
      this.transform.camera,
      point.x,
      point.y,
      this.transform.width,
      this.transform.height,
      items,
    );
    if (!hit) return null;
    const owner = slots[hit.slot - 1];
    if (!owner) return null;
    if (owner.kind === 'overlay') {
      const f = owner.built.features[Math.max(0, hit.renderId - 1)];
      return f
        ? { id: f.id, layer: owner.built.id, properties: { ...f.properties }, provenance: {}, lngLat: f.lngLat }
        : null;
    }
    const entry = owner.entry;
    if (entry.features) entry.renderIndex ??= new Map(entry.features.map((f) => [f.renderId, f]));
    const record = entry.renderIndex?.get(hit.renderId);
    return record ? this.toFeature(record) : null;
  }

  /** Main-thread time of the last pick in milliseconds (AC502 diagnostics). */
  get lastPickMs(): number {
    return this.picker.lastMs;
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
    const merged = { ...(this.featureState.get(id) ?? {}), ...state };
    this.featureState.set(id, merged);
    // Applied to every loaded copy (L0 and L1, overlays) without touching geometry.
    for (const entry of this.tiles.values()) {
      if (!entry.object || !entry.features) continue;
      entry.featureIndex ??= new Map(entry.features.map((f) => [f.id, f]));
      const record = entry.featureIndex.get(id);
      if (record) entry.object.state.set(record.renderId, merged);
    }
    this.nearKey = '';
    for (const { built } of this.overlays.values())
      built.features.forEach((f, i) => {
        if (f.id === id) built.state.set(i + 1, merged);
      });
    this.dirty = true;
  }

  private applyStates(entry: TileEntry) {
    if (!this.featureState.size || !entry.object || !entry.features) return;
    entry.featureIndex ??= new Map(entry.features.map((f) => [f.id, f]));
    for (const [id, state] of this.featureState) {
      const record = entry.featureIndex.get(id);
      if (record) entry.object.state.set(record.renderId, state);
    }
  }

  // ------------------------------------------------------------------------------------------- overlays

  addMarker(o: MarkerOptions): Marker {
    this.assertAlive();
    const entry = {
      element: o.element,
      lngLat: [...o.lngLat] as LngLat,
      altitude: o.altitude ?? 0,
      anchor: o.anchor ?? 'bottom',
      occlude: o.occlude ?? false,
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
    if (this.overlays.has(layer.id)) throw new MapError('LAYER_EXISTS', 'overlay', `Layer ${layer.id} already exists.`);
    let built: BuiltOverlay;
    try {
      built = buildOverlay(layer);
    } catch (error) {
      const e = error as Error & { code?: string };
      throw new MapError(
        e.code ?? 'OVERLAY_DATA_INVALID',
        'overlay',
        e.message,
        'Overlays take GeoJSON in [lng, lat] order.',
      );
    }
    const altitude = layer.type === 'custom' ? (layer.altitude ?? 0) : 0;
    const anchor = this.anchorAt(built.origin, altitude, built.originScale);
    anchor.userData.layerId = layer.id;
    anchor.add(built.group);
    built.features.forEach((f, i) => {
      const s = this.featureState.get(f.id);
      if (s) built.state.set(i + 1, s);
    });
    this.overlays.set(layer.id, { built, anchor });
    this.dirty = true;
  }

  removeLayer(id: string): void {
    this.assertAlive();
    const o = this.overlays.get(id);
    if (!o) return;
    o.anchor.removeFromParent();
    o.built.dispose();
    this.overlays.delete(id);
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------- style and filter

  async setStyle(style: string | StyleSpec | StylePack): Promise<void> {
    this.assertAlive();
    let resolved;
    try {
      resolved = resolveStyle(style, Boolean(this.hosted));
    } catch (error) {
      if (error instanceof StyleError) {
        const e = new MapError(error.code, 'style', error.message, error.hint);
        Object.assign(e, { errors: error.errors });
        this.diagnostic({ code: error.code, stage: 'style', message: error.message, hint: error.hint });
        throw e;
      }
      throw error;
    }
    const { spec, pack } = resolved;
    // Streaming hooks see every resident tile: the old pack is told they leave, the new one that they arrive.
    if (pack !== this.pack)
      for (const e of this.tiles.values())
        if (e.object) this.pack?.onTileUnload?.({ tile: e.key, group: e.object.group });
    const previousPack = this.pack;
    this.spec = spec;
    this.pack = pack;
    this.styleId = pack ? pack.id : spec.id;
    const env = spec.environment;
    this.renderer.setClearColor(new Color(env.background));
    // In a host map the host draws the background and its own fog.
    this.scene.background = this.hosted ? null : new Color(env.background);
    this.scene.fog = this.hosted || !env.fog ? null : new Fog(env.fog.color ?? env.background, 1, 2);
    (this.ground.material as MeshBasicMaterial).color = new Color(groundColor(spec));
    this.sun.color = new Color(env.sun.color);
    this.sun.intensity = env.sun.intensity * 1.6;
    this.hemi.color = new Color(env.ambient.color);
    this.hemi.groundColor = new Color(env.ambient.ground);
    this.hemi.intensity = env.ambient.intensity;
    this.ambient.intensity = 0.15;
    const az = (env.sun.azimuth * Math.PI) / 180,
      alt = (env.sun.altitude * Math.PI) / 180;
    // Azimuth clockwise from north; world x is east, z is south.
    this.sunDirection.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)).normalize();
    this.budgetSettled = null;
    this.sun.castShadow = env.shadows && this.budget.shadowQuality > 0;
    this.shadowCatcher.visible = this.sun.castShadow && !this.hosted;
    (this.shadowCatcher.material as ShadowMaterial).opacity = env.background < '#555555' ? 0.35 : 0.2;
    const f = this.materials.facade,
      x = this.materials.extras;
    f.windows.value = spec.facade.windows ? 1 : 0;
    f.facadeDetail.value = Math.min(1, 0.5 * spec.facade.density);
    f.sunDirection.value.copy(this.sunDirection);
    // The analytic glass environment is a daylight sky; on a dark background it made curtain walls glow. Scale the
    // reflection with the background luminance (dark style ≈ 0.2, light styles 0.65 as in phase one).
    const bg = new Color(env.background);
    f.glassReflection.value = Math.min(0.65, 0.15 + (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) * 0.6);
    x.uContactShadow.value = env.ambientOcclusion;
    x.uNightLights.value = spec.facade.nightLights ? 1 : 0;
    stateUniforms.highlightColor.value.set(spec.featureState.highlight.emissive);
    stateUniforms.highlightIntensity.value = spec.featureState.highlight.emissiveIntensity;
    this.materials.ruleOpacityRoles = new Set(
      spec.rules.flatMap((r) =>
        Object.entries(r.set)
          .filter(([, v]) => v.opacity !== undefined && v.opacity < 1)
          .flatMap(([k]) => (k === 'wall' ? ['wall', 'glass'] : [k])),
      ),
    );
    this.materials.restyle(spec, pack);
    for (const e of this.tiles.values()) this.applyRules(e);
    if (pack && pack !== previousPack)
      for (const e of this.tiles.values())
        if (e.object && e.features) pack.onTileLoad?.({ tile: e.key, group: e.object.group, features: e.features });
    this.pipeline?.dispose();
    this.pipeline = null;
    if (pack?.createPipeline && !this.hosted) {
      this.pipeline = pack.createPipeline({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.transform.camera,
        shared: this.materials.facade,
        parameters: this.materials.packParameters(),
      });
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      this.pipeline.resize(size.x, size.y);
    }
    // With a pipeline the base plane itself receives the sun shadow in the ink light pass.
    this.ground.receiveShadow = Boolean(this.pipeline);
    if (this.pipeline) this.shadowCatcher.visible = false;
    this.dirty = true;
    this.fire({ type: 'styledata' });
  }

  private readonly sunDirection = new Vector3(0.5, 0.7, -0.5);

  setFilter(filter: ProvenanceFilter): void {
    this.assertAlive();
    this.filter = { ...filter };
    for (const e of this.tiles.values()) this.applyFilter(e);
    // Roof inference is a generator option: regenerate loaded tiles from their cached bytes (no new requests).
    const inferRoofs = this.tilesetInferRoofs && this.filter.roofs?.inferred !== false;
    if (inferRoofs !== Boolean(this.generationOptions.inferRoofs)) {
      this.generationOptions = { ...this.generationOptions, inferRoofs };
    }
    this.dirty = true;
  }

  private tilesetInferRoofs = false;

  /** Buildings in loaded L1 tiles, and how many the ProvenanceFilter draws as footprints (AC706). */
  private buildingCounts() {
    let total = 0,
      flattened = 0;
    const finest = this.tileset.levels.length - 1;
    for (const e of this.tiles.values()) {
      if (e.level !== finest || !e.object || !e.features) continue;
      for (const f of e.features)
        if (f.layer === 'building') {
          total++;
          if (e.object.state.data[f.renderId * 4 + 3]! & FLAG_FLATTEN) flattened++;
        }
    }
    return { total, flattened, shown: total - flattened };
  }

  private filteredFeatureCounts() {
    let hiddenTrees = 0,
      hiddenDetails = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.object || !tile.features) continue;
      for (const f of tile.features) {
        if (!(tile.object.state.data[f.renderId * 4 + 3]! & FLAG_HIDDEN)) continue;
        if (f.layer === 'tree') hiddenTrees++;
        if (f.layer === 'detail' || f.layer === 'landscape') hiddenDetails++;
      }
    }
    return { hiddenTrees, hiddenDetails };
  }

  /** Screen-space-error multiplier driven by the visible-triangle budget (06 section 3, budget-driven degradation). */
  private sseScale = 1;
  private lastBudgetCheck = 0;
  private visibleTriangles = 0;

  /**
   * Keeps the estimated colour and shadow passes within the triangle and draw-call budgets. Over budget the
   * refinement threshold grows so distant areas stay at the coarser level; well under budget it relaxes again.
   * Adjusted at most every 300 ms, with a dead band, so tiles do not flip back and forth.
   */
  private adaptToBudget(now: number) {
    // Hysteresis: once settled, sub-5 m camera jitter or tiny zoom changes neither re-tier nor change the threshold.
    const eyeNow = this.transform.camera.position;
    const shown = [...this.tiles.values()].filter((e) => e.visible && e.object);
    let neededBytes = 0;
    for (const e of this.tiles.values()) if (e.visible || e.lastWanted === now) neededBytes += e.bytes;
    const shownKey = shown.map((e) => e.key).join() + `#${this.objectsVersion}/${this.nearFrames.count}/${neededBytes}`;
    const settled = this.budgetSettled;
    if (
      settled &&
      ((this.lastRendered <= this.budget.visibleTriangles && this.lastDrawCalls <= this.budget.drawCalls) ||
        this.sseScale >= 16) &&
      !this.budgetPending &&
      settled.key === shownKey &&
      settled.eye.distanceTo(eyeNow) < 5 &&
      Math.abs(settled.zoom - this.transform.zoom) < 0.05
    )
      return;
    // Per-tile detail tiers by distance (06 section 3, budget-driven degradation): the nearest tiles keep everything;
    // farther tiles first drop their structure group (facade trims, roof plant, parapets, piers); only when every
    // tile is already reduced does the refinement threshold grow so that whole regions fall back to the coarser level.
    // The estimate below counts whole tiles; the renderer also draws what the estimate misses (frustum and light
    // frustum differ). Scale the budget by the measured/estimated ratio of the last colour+shadow frame.
    const correction = this.lastEstimate > 0 && this.lastRendered > 0 ? this.lastRendered / this.lastEstimate : 1;
    // 5% headroom: the shadow pass varies with the light frustum from frame to frame.
    const budget = (this.budget.visibleTriangles * 0.95) / Math.min(3, Math.max(1, correction));
    const drawCorrection = this.lastDrawEstimate > 0 ? Math.max(1, this.lastDrawCalls / this.lastDrawEstimate) : 1;
    const drawBudget = this.budget.drawCalls / drawCorrection;
    const eye = eyeNow;
    const shadows = this.sun.castShadow && this.renderer.shadowMap.enabled;
    // Budget counts every triangle the GPU draws: the colour pass plus the shadow depth pass of shadow casters.
    const tris = (m: Mesh) =>
      ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3) *
      ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
    let total = this.nearFrames.count * 12 * (shadows ? 2 : 1);
    let draws =
      Number(this.ground.visible) +
      Number(this.shadowCatcher.visible) +
      (this.nearFrames.count ? (shadows ? 2 : 1) : 0);
    const ranked: { e: TileEntry; tiers: number[]; draws: number[]; d: number }[] = [];
    for (const e of shown) {
      const o = e.object!;
      let colour = 0,
        optional = 0,
        caster = 0;
      let baseDraws = 0,
        optionalDraws = 0,
        shadowDraws = 0;
      o.group.traverse((obj) => {
        const m = obj as Mesh;
        if (!m.isMesh || !m.geometry) return;
        const n = tris(m);
        const layer = String(m.userData.layer);
        if (layer === 'structure') {
          optional += n;
          optionalDraws++;
        } else if (m.visible) {
          colour += n;
          baseDraws++;
          if (shadows && (m.userData.castsShadow ?? m.castShadow)) {
            caster += n;
            shadowDraws++;
          }
        }
      });
      // tier 0: everything; tier 1: no structure group; tier 2: tier 1 without casting shadows
      const tiers = [colour + optional + (shadows ? caster : 0), colour + (shadows ? caster : 0), colour];
      const centre = o.meshes[0]?.geometry.boundingSphere
        ? o.meshes[0].geometry.boundingSphere.center.clone().applyMatrix4(o.group.matrixWorld)
        : o.group.getWorldPosition(new Vector3());
      ranked.push({
        e,
        tiers,
        draws: [baseDraws + optionalDraws + shadowDraws, baseDraws + shadowDraws, baseDraws],
        d: centre.distanceTo(eye),
      });
    }
    ranked.sort((x, y) => x.d - y.d);
    // Nearest first: each tile takes the richest tier that still leaves room for every farther tile at tier 2.
    let remaining = ranked.reduce((n, r) => n + r.tiers[2]!, 0);
    let remainingDraws = ranked.reduce((n, r) => n + r.draws[2]!, 0);
    let reduced = 0;
    for (const r of ranked) {
      remaining -= r.tiers[2]!;
      remainingDraws -= r.draws[2]!;
      const fits = (tier: number) =>
        total + r.tiers[tier]! + remaining <= budget && draws + r.draws[tier]! + remainingDraws <= drawBudget;
      const tier = fits(0) ? 0 : fits(1) ? 1 : 2;
      const o = r.e.object!;
      o.group.traverse((obj) => {
        const m = obj as Mesh;
        if (!m.isMesh) return;
        if (m.userData.layer === 'structure') m.visible = tier === 0;
        else if (m.userData.castsShadow !== undefined || m.castShadow) {
          m.userData.castsShadow ??= m.castShadow;
          m.castShadow = Boolean(m.userData.castsShadow) && tier < 2;
        }
      });
      total += r.tiers[tier]!;
      draws += r.draws[tier]!;
      if (tier) reduced++;
    }
    this.reducedTiles = reduced;
    this.visibleTriangles = total;
    this.lastEstimate = total;
    this.lastDrawEstimate = draws;
    const pressure = Math.max(total / budget, draws / drawBudget, neededBytes / this.budget.residentBytes);
    // Keep frames coming while over budget so the adjustment converges (the loop otherwise sleeps when idle).
    // Refinement is all-or-nothing per parent tile, so relaxing can jump straight back over budget. Relax only when
    // the last over-budget view cost would now fit, or the camera has moved enough to change the tile set.
    const t = this.transform;
    const cam = this.overBudgetAt;
    const moved =
      !cam ||
      Math.abs(cam.zoom - t.zoom) > 0.5 ||
      Math.hypot(cam.center[0] - t.center[0], cam.center[1] - t.center[1]) > 0.004;
    const canRelax = pressure < 0.55 && this.sseScale > 1 && moved;
    this.budgetPending = (pressure > 1 && this.sseScale < 16) || canRelax;
    this.budgetSettled = this.budgetPending ? null : { key: shownKey, eye: eyeNow.clone(), zoom: this.transform.zoom };
    if (now - this.lastBudgetCheck < 300) return;
    this.lastBudgetCheck = now;
    if (pressure > 1) {
      this.sseScale = Math.min(16, this.sseScale * 1.35);
      this.overBudgetAt = { zoom: t.zoom, center: [...t.center] as LngLat };
    } else if (canRelax) {
      this.sseScale = Math.max(1, this.sseScale / 1.2);
      if (moved) this.overBudgetAt = null;
    }
  }

  private budgetSettled: { key: string; eye: Vector3; zoom: number } | null = null;
  /** Incremented whenever a tile object is created or replaced (budget tiers must be re-applied). */
  private objectsVersion = 0;
  /** L1 tiles currently drawn without their structure group. */
  private reducedTiles = 0;
  private recheckedTriangles = 0;
  private recheckedDraws = 0;
  private lastEstimate = 0;
  private lastDrawEstimate = 0;
  private lastRendered = 0;
  private overBudgetAt: { zoom: number; center: LngLat } | null = null;

  /** True while the budget adjustment has not converged; keeps the frame loop running. */
  private budgetPending = false;

  private needsRegeneration(entry: TileEntry) {
    return (
      entry.state === 'ready' &&
      entry.buffer &&
      !entry.regenerating &&
      entry.inferRoofs !== this.generationOptions.inferRoofs
    );
  }

  private regenerate(entry: TileEntry) {
    const token = (entry.loadToken = (entry.loadToken ?? 0) + 1);
    entry.regenerating = true;
    entry.inferRoofs = this.generationOptions.inferRoofs;
    const work = this.pool.run(entry.buffer!.slice(0), entry.priority, this.generationOptions);
    entry.cancelWork = work.cancel;
    void work.promise
      .then((response) => {
        if (entry.loadToken !== token || this.disposed) return;
        if (response.type === 'error')
          throw Object.assign(new Error(response.diagnostic.message), { diagnostic: response.diagnostic });
        this.uploads.push({ entry, response, token, replace: true });
      })
      .catch((error: Error & { diagnostic?: Diagnostic }) => {
        if (entry.loadToken !== token || this.disposed) return;
        const d = {
          ...(error.diagnostic ?? { code: 'TILE_GENERATE_FAILED', stage: 'generate', message: error.message }),
          tileId: entry.key,
        };
        this.diagnostic(d);
        this.fire({ type: 'tileerror', tile: entry.key, error: d });
      })
      .finally(() => {
        if (entry.loadToken !== token || this.disposed) return;
        entry.regenerating = false;
        entry.cancelWork = null;
        this.dirty = true;
        this.hosted?.repaint();
      });
  }

  /**
   * Evaluates the style's `rules` for one tile into rule textures (05 section 4: at load and style change, not per
   * frame). One texture pair per material-group mesh: the override colour/opacity per feature and the mask of role
   * indices it applies to (a rule on `wall` tints wall and glass vertices, not the roof of the same building).
   */
  private applyRules(entry: TileEntry) {
    if (!entry.object) return;
    for (const r of entry.rules ?? []) r.dispose();
    entry.rules = [];
    const rules = this.pack ? [] : (this.spec?.rules ?? []);
    for (const mesh of entry.object.meshes) {
      const uniforms = (mesh.material as { userData: { cityRuleUniforms?: Record<string, { value: unknown }> } })
        .userData.cityRuleUniforms;
      if (!uniforms) continue;
      const group = String(mesh.userData.layer);
      const groupRoles = ROLE_LIST.map((r, i) => [r, i] as const).filter(
        ([r]) => groupOf(r) === (group === 'detail' ? 'structure' : group),
      );
      const applicable = rules.filter((rule) =>
        Object.keys(rule.set).some((k) => groupRoles.some(([r]) => ruleRoleApplies(k, r))),
      );
      if (!applicable.length || !entry.features) {
        uniforms.ruleColor!.value = EMPTY_RULES;
        uniforms.ruleMask!.value = EMPTY_RULES;
        continue;
      }
      const texture = new RuleTexture(entry.object.state.capacity);
      for (const f of entry.features)
        for (const rule of applicable) {
          if (f.layer !== rule.layer || !evaluateExpression(rule.when as never, f)) continue;
          let color: string | undefined,
            opacity: number | undefined,
            mask = 0;
          for (const [k, v] of Object.entries(rule.set))
            for (const [r, i] of groupRoles)
              if (ruleRoleApplies(k, r)) {
                mask |= 1 << i;
                color = v.color ?? color;
                opacity = v.opacity ?? opacity;
              }
          if (!mask) continue;
          texture.set(f.renderId, color, opacity);
          texture.setMask(f.renderId, mask);
        }
      texture.commit();
      entry.rules.push(texture);
      uniforms.ruleColor!.value = texture.texture;
      uniforms.ruleMask!.value = texture.mask;
    }
  }

  /** Applies the ProvenanceFilter to one loaded tile without refetching or regenerating it (05 section 5). */
  private applyFilter(entry: TileEntry, fresh = false) {
    if (!entry.object) return;
    const details = this.filter.details !== false;
    // Buildings whose height is less certain than required are drawn as footprints; inferred trees can be hidden.
    const rank = { observed: 0, derived: 1, inferred: 2 } as const;
    const min = this.filter.buildings?.minHeightProvenance;
    const hideTrees = this.filter.trees?.inferred === false;
    if (fresh && !min && !hideTrees && details) return;
    if (entry.features)
      for (const f of entry.features) {
        let flags = 0;
        if (f.layer === 'building' && min) {
          const prov = (f.provenance.height ?? 'inferred') as keyof typeof rank;
          if (rank[prov] > rank[min]) flags |= FLAG_FLATTEN;
        } else if (f.layer === 'tree' && hideTrees && f.provenance.position === 'inferred') flags |= FLAG_HIDDEN;
        else if (
          !details &&
          (f.layer === 'landscape' || (f.layer === 'detail' && OPTIONAL_DETAILS.has(String(f.properties.kind))))
        )
          flags |= FLAG_HIDDEN;
        entry.object.state.setFilter(f.renderId, flags);
      }
    this.nearKey = '';
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
    const token = (entry.loadToken = (entry.loadToken ?? 0) + 1);
    const current = () => entry.loadToken === token;
    entry.state = 'loading';
    const controller = new AbortController();
    entry.controller = controller;
    const url = resolveTileUrl(this.tileset, this.tilesetUrl, entry.id.z, entry.id.x, entry.id.y);
    this.requestStats.started++;
    readBinary(url, this.options, controller.signal)
      .then((buffer) => {
        if (controller.signal.aborted || !current())
          throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        this.requestStats.completed++;
        this.requestStats.bytes += buffer.byteLength;
        entry.controller = null;
        entry.state = 'generating';
        entry.buffer = buffer.slice(0);
        entry.inferRoofs = this.generationOptions.inferRoofs;
        const work = this.pool.run(buffer, entry.priority, this.generationOptions);
        entry.cancelWork = work.cancel;
        return work.promise;
      })
      .then((response) => {
        if (!current()) return;
        entry.cancelWork = null;
        if (this.disposed) return;
        if (response.type === 'error')
          throw Object.assign(new Error(response.diagnostic.message), {
            diagnostic: response.diagnostic,
            permanent: true,
          });
        this.uploads.push({ entry, response, token });
        this.uploads.sort((a, b) => a.entry.priority - b.entry.priority);
        this.dirty = true;
      })
      .catch((error: Error & { diagnostic?: Diagnostic; permanent?: boolean; status?: number }) => {
        if (!current()) {
          if (error.name === 'AbortError') this.requestStats.cancelled++;
          return;
        }
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
    entry.loadToken = (entry.loadToken ?? 0) + 1;
    entry.controller?.abort();
    entry.controller = null;
    entry.cancelWork?.();
    entry.cancelWork = null;
    if (entry.state === 'loading' || entry.state === 'generating') entry.state = 'queued';
  }

  private unload(entry: TileEntry) {
    this.cancel(entry);
    if (entry.object) {
      this.pack?.onTileUnload?.({ tile: entry.key, group: entry.object.group });
      this.pipeline?.onTileUnload?.({ tile: entry.key, group: entry.object.group });
      entry.object.group.removeFromParent();
      entry.object.dispose();
      entry.object = null;
    }
    entry.features = null;
    entry.nearWalls = null;
    entry.buffer = null;
    for (const r of entry.rules ?? []) r.dispose();
    entry.rules = [];
    this.nearKey = '';
    entry.featureIndex = null;
    entry.visible = false;
    entry.bytes = 0;
    if (entry.state === 'ready') entry.state = 'queued';
  }

  private processUploads(now: number) {
    const start = performance.now();
    let spent = 0;
    while (this.uploads.length && (spent < this.budget.uploadMsPerFrame || spent === 0)) {
      const job = this.uploads[0]!;
      const { entry, response, replace, token } = job;
      if (entry.loadToken !== token || !!entry.object !== !!replace) {
        job.preparation?.return(undefined);
        this.uploads.shift();
        spent = performance.now() - start;
        continue;
      }
      const previous = entry.object;
      if (!job.preparation) {
        const capacity = response.features.reduce((m, f) => Math.max(m, f.renderId), 0);
        job.preparation = prepareTileObject(response.generated, this.materials, capacity, response.upload);
      }
      const result = job.preparation.next();
      spent = performance.now() - start;
      if (!result.done) continue;
      this.uploads.shift();
      const object = result.value;
      if (!object) continue;
      object.group.userData.tile = entry.key;
      if (this.hosted && this.hosted.ground === 'host')
        for (const mesh of object.meshes)
          if (HOST_GROUND_LAYERS.has(String(mesh.userData.layer))) {
            mesh.visible = false;
            object.pickable.splice(object.pickable.indexOf(mesh), 1);
          }
      if (previous) {
        this.pack?.onTileUnload?.({ tile: entry.key, group: previous.group });
        this.pipeline?.onTileUnload?.({ tile: entry.key, group: previous.group });
        const shown = previous.group.parent !== null;
        previous.group.removeFromParent();
        previous.dispose();
        for (const r of entry.rules ?? []) r.dispose();
        entry.rules = [];
        if (shown) this.tilesRoot.add(object.group);
      }
      entry.object = object;
      this.objectsVersion++;
      entry.features = response.features;
      entry.renderIndex = entry.featureIndex = null;
      entry.nearWalls = response.generated.nearWalls ?? null;
      this.nearKey = '';
      this.applyStates(entry);
      this.applyFilter(entry, true);
      this.applyRules(entry);
      entry.bytes = object.bytes + (entry.buffer?.byteLength ?? 0) + object.state.data.byteLength;
      entry.state = 'ready';
      entry.retries = 0;
      this.placeTile(entry);
      this.pack?.onTileLoad?.({ tile: entry.key, group: object.group, features: entry.features });
      this.pipeline?.onTileLoad?.({ tile: entry.key, group: object.group });
      this.dirty = true;
      this.fire({ type: 'tileload', tile: entry.key });
      spent = performance.now() - start;
    }
    this.uploadLastMs = spent;
    this.uploadMaxMs = Math.max(this.uploadMaxMs, spent);
    void now;
  }

  /** Replacement rules (04 section 5.2): never show a region with neither a parent nor complete children. */
  private selectionTime = 0;

  private updateTiles(now: number) {
    this.selectionTime = now;
    const finest = this.tileset.levels[this.tileset.levels.length - 1]!;
    const maxDistance = Math.max(2000, this.transform.cameraToCenterDistance * this.transform.unitsPerPixel * 8);
    const desired = (this.lastDesired = selectTiles(
      this.transform,
      this.tileset,
      this.coverage,
      {
        maximumScreenSpaceError: (this.options.maximumScreenSpaceError ?? 16) * this.sseScale,
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
      const fog = this.spec?.environment.fog;
      this.scene.fog.near = maxDistance * (fog?.start ?? 0.55);
      this.scene.fog.far = maxDistance * (fog?.end ?? 1.05);
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
    let slots = Math.min(this.budget.concurrentLoads - inFlight, this.budget.workerQueue - inWorkers - inFlight);
    for (const d of desired) {
      if (slots <= 0) break;
      const e = this.tiles.get(d.key)!;
      if (e.state === 'queued' && now >= e.retryAt) {
        this.load(e);
        slots--;
      }
    }
    // Keep existing geometry visible until its replacement is ready. Regenerate from cached bytes
    // within the same worker budget, including tiles whose first load began before the filter changed.
    let generationSlots =
      this.budget.workerQueue -
      this.pool.running -
      this.pool.queued -
      [...this.tiles.values()].filter((e) => e.state === 'loading').length;
    for (const e of this.tiles.values()) {
      if (generationSlots <= 0) break;
      if (this.needsRegeneration(e)) {
        this.regenerate(e);
        generationSlots--;
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

  private syncHostCamera() {
    const h = this.hosted!;
    const c = h.camera();
    if (c.width !== this.transform.width || c.height !== this.transform.height) {
      this.transform.resize(c.width, c.height);
      this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
      this.renderer.setSize(c.width, c.height, false);
    }
    this.transform.limits = { minZoom: 0, maxZoom: 24, maxPitch: 90 };
    this.applyCamera({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing });
    if (Math.abs(this.transform.fov - c.fov) > 1e-9) this.transform.set({ fov: c.fov });
  }

  /** Called by the MapLibre layer from its render hook: sync the camera, stream, draw into the host's context. */
  hostedRender(): void {
    if (this.disposed || !this.hosted || !this.tileset) return;
    const now = performance.now();
    this.syncHostCamera();
    this.processUploads(now);
    this.updateTiles(now);
    this.renderer.resetState();
    // Our depth range differs from the host's: start from a clear depth buffer and clear it again afterwards so host
    // layers above the city (labels, markers) are never hidden by the city's depth values (AC803).
    const gl = this.hosted.gl;
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.render(now);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.renderer.resetState();
    this.dirty = false;
    const idle = !this.busy() && !this.pendingWanted(now) && !this.budgetPending;
    if (!idle) {
      this.wasIdle = false;
      this.hosted.repaint();
    } else if (!this.wasIdle) {
      this.wasIdle = true;
      this.fire({ type: 'idle' });
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  requestRender(): void {
    this.assertAlive();
    this.dirty = true;
    this.hosted?.repaint();
  }

  pause(value = true): void {
    this.assertAlive();
    this.paused = value;
    if (!value) this.dirty = true;
  }

  resize(): void {
    if (this.disposed) return;
    if (this.hosted) {
      this.syncHostCamera();
      return;
    }
    const r = this.options.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    let pixelRatio = Math.min(globalThis.devicePixelRatio || 1, this.budget.pixelRatio);
    if (this.mobile) pixelRatio = Math.min(pixelRatio, Math.sqrt(2_500_000 / (w * h)));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.transform.resize(w, h);
    this.budgetSettled = null;
    if (this.pipeline) {
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      this.pipeline.resize(size.x, size.y);
    }
    this.dirty = true;
  }

  private busy(): boolean {
    for (const e of this.tiles.values()) {
      if (e.state === 'loading' || e.state === 'generating' || e.regenerating || this.needsRegeneration(e)) return true;
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
    if (this.dirty || loading || this.budgetPending) {
      this.updateTiles(now);
      this.render(time);
      this.dirty = false;
      this.wasIdle = false;
    } else this.lastFrameTime = 0;
    const idle = !this.busy() && !this.pendingWanted(now) && !this.dirty && !this.budgetPending;
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
    // Ink pipelines tone distant ground; keep paper (not a grey band) at the horizon by bounding the base plane.
    const radius = this.pipeline
      ? Math.max(1200, t.cameraToCenterDistance * t.unitsPerPixel * 2.5)
      : Math.max(5000, t.camera.far * 1.2);
    this.ground.position.set(c.x, -0.35, c.z);
    this.ground.scale.setScalar(radius);
    this.shadowCatcher.position.set(c.x, -0.3, c.z);
    this.shadowCatcher.scale.setScalar(radius);
    // Fit the sun's shadow camera around the view target; the extent follows the camera distance.
    const reach = Math.min(1600, Math.max(180, t.cameraToCenterDistance * t.unitsPerPixel * 1.6));
    const texel = (2 * reach) / this.sun.shadow.mapSize.x;
    const cx = Math.round(c.x / texel) * texel,
      cz = Math.round(c.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx, 0, cz).addScaledVector(this.sunDirection, reach * 2);
    const cam = this.sun.shadow.camera;
    if (cam.right !== reach) {
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.near = 1;
      cam.far = reach * 4.5;
      cam.updateProjectionMatrix();
      this.sun.shadow.normalBias = texel * 1.5;
    }
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.materials.facade.projectionScale.value = size.y / (2 * Math.tan((t.fov * Math.PI) / 360));
    for (const { built } of this.overlays.values()) built.update(size, this.renderer.getPixelRatio());
    this.scene.updateMatrixWorld();
    this.updateNearDetails();
    this.adaptToBudget(this.selectionTime);
    this.renderer.info.reset();
    const sampled = this.gpuTimer.begin(time);
    try {
      if (this.pipeline) this.pipeline.render();
      else this.renderer.render(this.scene, t.camera);
    } finally {
      if (sampled) this.gpuTimer.end();
    }
    this.lastRendered = this.renderer.info.render.triangles;
    this.lastDrawCalls = this.renderer.info.render.calls;
    if (
      this.budgetSettled &&
      this.sseScale < 16 &&
      (this.lastRendered > this.budget.visibleTriangles || this.lastDrawCalls > this.budget.drawCalls) &&
      (this.recheckedTriangles !== this.lastRendered || this.recheckedDraws !== this.lastDrawCalls)
    ) {
      this.recheckedTriangles = this.lastRendered;
      this.recheckedDraws = this.lastDrawCalls;
      this.budgetPending = true;
    }
    this.frame++;
    if (this.lastFrameTime) {
      this.frameIntervals.push(time - this.lastFrameTime);
      if (this.frameIntervals.length > 600) this.frameIntervals.shift();
    }
    this.lastFrameTime = time;
    this.positionMarkers();
  }

  /**
   * Phase-one near attachments: window frames, sills and balconies on complete walls within ~160 m of a low camera,
   * rebuilt when the camera moves 25 m or the visible tiles change, capped by the nearDetails budget.
   */
  private updateNearDetails() {
    const cam = this.transform.camera.position;
    const visible = [...this.tiles.values()].filter((e) => e.visible && e.object && e.nearWalls?.length);
    const key = `${Math.round(cam.x / 25)},${Math.round(cam.y / 25)},${Math.round(cam.z / 25)}|${visible.map((e) => e.key).join(',')}`;
    if (key === this.nearKey) return;
    this.nearKey = key;
    let count = 0;
    // Near attachments take at most a fifth of the triangle budget (12 triangles per instance).
    const limit = Math.min(this.budget.nearDetails, Math.floor((this.budget.visibleTriangles * 0.2) / 12));
    if (limit > 0 && this.filter.details !== false) {
      const inverse = new Matrix4();
      const local = new Vector3();
      const dummy = new Object3D();
      const m = new Matrix4();
      const byDistance = visible
        .map((e) => ({ e, d: e.object!.group.getWorldPosition(new Vector3()).distanceTo(cam) }))
        .sort((a, b) => a.d - b.d);
      for (const { e } of byDistance) {
        if (count >= limit) break;
        const group = e.object!.group;
        inverse.copy(group.matrixWorld).invert();
        local.copy(cam).applyMatrix4(inverse);
        if (local.y >= 180) continue;
        const flags = e.object!.state.data;
        const walls = e.nearWalls!.filter((w) => (flags[w.renderId * 4 + 3]! & (FLAG_HIDDEN | FLAG_FLATTEN)) === 0);
        for (const f of nearbyFacadeFrames(walls, { x: local.x, y: local.y + 0.45, z: local.z }, limit - count)) {
          dummy.position.set(f.x, f.y - 0.45, f.z);
          dummy.rotation.set(0, f.angle, 0);
          dummy.scale.set(f.w, f.h, f.d);
          dummy.updateMatrix();
          m.multiplyMatrices(group.matrixWorld, dummy.matrix);
          this.nearFrames.setMatrixAt(count++, m);
        }
      }
    }
    if (count !== this.nearFrames.count) this.budgetPending = true;
    this.nearFrames.count = count;
    this.nearFrames.instanceMatrix.needsUpdate = true;
  }

  /** Occlusion is opt-in. Test visible building shells up to the marker, respecting hidden/flattened features. */
  private markerOccluded(lngLat: LngLat, altitude: number) {
    const eye = this.transform.camera.position;
    const toward = this.transform.lngLatToWorld(lngLat, altitude).sub(eye);
    const distance = toward.length();
    if (distance <= 0.1) return false;
    const ray = this.markerRay;
    ray.set(eye, toward.divideScalar(distance));
    ray.far = distance - 0.1;
    for (const tile of this.tiles.values()) {
      if (!tile.visible || !tile.object) continue;
      for (const mesh of tile.object.meshes) {
        if (!mesh.visible || (mesh.userData.layer !== 'building' && mesh.userData.layer !== 'landmark')) continue;
        const ids = mesh.geometry.getAttribute('renderId');
        for (const hit of ray.intersectObject(mesh, false)) {
          if (!hit.face) continue;
          const flags = tile.object.state.data[4 * ids.getX(hit.face.a) + 3]!;
          if ((flags & (FLAG_HIDDEN | FLAG_FLATTEN)) === 0) return true;
        }
      }
    }
    return false;
  }

  private positionMarkers() {
    for (const m of this.markers) {
      const p = this.transform.project(m.lngLat, m.altitude);
      if (!p || p.x < -200 || p.y < -200 || p.x > this.transform.width + 200 || p.y > this.transform.height + 200) {
        m.element.style.display = 'none';
        continue;
      }
      if (m.occlude && this.markerOccluded(m.lngLat, m.altitude)) {
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
      this.hosted?.repaint();
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
      drawCalls: this.lastDrawCalls,
      triangles: this.lastRendered,
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
        gpu: this.gpuTimer.snapshot({ raw: true }),
        frameIntervals: [...this.frameIntervals],
        generateMs: [...this.pool.timings],
        workerSamples: this.pool.samples.map((sample) => ({ ...sample })),
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
        pack: this.pack?.id ?? null,
        nearDetails: this.nearFrames.count,
        visibleTriangles: this.visibleTriangles,
        reducedTiles: this.reducedTiles,
        sseScale: this.sseScale,
        buildings: this.buildingCounts(),
        featureVisibility: this.filteredFeatureCounts(),
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

/** Colour of the base plane under all tiles: the ground role colour (tinted generator pavement for "multiply"). */
function groundColor(spec: ResolvedStyleSpec): string {
  const r = spec.roles.ground ?? {};
  if (r.blend === 'multiply' || r.inherit) {
    const base = new Color('#f3f2ee');
    return '#' + base.multiply(new Color(r.color ?? '#ffffff')).getHexString();
  }
  return r.color ?? '#f3f2ee';
}
