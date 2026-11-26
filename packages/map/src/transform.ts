// MapLibre-compatible camera model (04 section 4). The world is linear in Web Mercator: one world unit is one metre at
// the anchor latitude, x east, y up, z south (01 section 6). The Three.js camera is the exact image of MapLibre's
// camera under that linear map, so ground points project to the same pixels as in MapLibre (AC404).
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { EARTH_CIRCUMFERENCE, lngLatToMercator, mercatorToLngLat, metersPerMercatorUnit } from '@city-ink/tiles';
import type { LngLat } from '@city-ink/tiles';

export const TILE_SIZE = 512;
/** MapLibre's default vertical field of view (degrees). */
export const DEFAULT_FOV = 36.86989764584402;
export const DEG = Math.PI / 180;

export interface CameraState {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  fov: number;
}

export interface TransformLimits {
  minZoom: number;
  maxZoom: number;
  maxPitch: number;
}

export function wrapBearing(b: number): number {
  const w = ((((b + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

export class Transform {
  /** CSS pixel offset of the padded host centre from the viewport centre. */
  offsetX = 0;
  offsetY = 0;
  width = 1;
  height = 1;
  center: LngLat = [0, 0];
  zoom = 16;
  pitch = 0;
  bearing = 0;
  fov = DEFAULT_FOV;
  /** Floating origin; world coordinates are metres at this latitude relative to it. */
  anchor: LngLat = [0, 0];
  limits: TransformLimits = { minZoom: 0, maxZoom: 22, maxPitch: 80 };
  readonly camera = new PerspectiveCamera(DEFAULT_FOV, 1, 1, 10);
  private readonly viewProjection = new Matrix4();

  get state(): CameraState {
    return {
      center: [...this.center] as LngLat,
      zoom: this.zoom,
      pitch: this.pitch,
      bearing: this.bearing,
      fov: this.fov,
    };
  }

  set(state: Partial<CameraState>): void {
    if (state.center) this.center = [state.center[0], Math.max(-85, Math.min(85, state.center[1]))];
    if (state.zoom !== undefined) this.zoom = Math.max(this.limits.minZoom, Math.min(this.limits.maxZoom, state.zoom));
    if (state.pitch !== undefined) this.pitch = Math.max(0, Math.min(this.limits.maxPitch, state.pitch));
    if (state.bearing !== undefined) this.bearing = wrapBearing(state.bearing);
    if (state.fov !== undefined) this.fov = Math.max(1, Math.min(120, state.fov));
    this.update();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.update();
  }

  get worldSize(): number {
    return TILE_SIZE * 2 ** this.zoom;
  }

  /** Metres per world unit conversion: world units are metres at the anchor latitude. */
  get anchorScale(): number {
    return metersPerMercatorUnit(this.anchor[1]);
  }

  /** MapLibre's camera distance to the centre, in pixels. */
  get cameraToCenterDistance(): number {
    return (0.5 / Math.tan((this.fov * DEG) / 2)) * this.height;
  }

  /** World units per screen pixel at the centre. */
  get unitsPerPixel(): number {
    return this.anchorScale / this.worldSize;
  }

  /** Metres per CSS pixel at the centre (for scale bars and diagnostics). */
  get metersPerPixel(): number {
    return metersPerMercatorUnit(this.center[1]) / this.worldSize;
  }

  lngLatToWorld(lngLat: LngLat, altitude = 0, out = new Vector3()): Vector3 {
    const [mx, my] = lngLatToMercator(lngLat);
    const [ax, ay] = lngLatToMercator(this.anchor);
    const s = this.anchorScale;
    // Altitude in metres at the point's latitude becomes world units like the tile matrices do.
    const altitudeScale = s / metersPerMercatorUnit(lngLat[1]);
    return out.set((mx - ax) * s, altitude * altitudeScale, (my - ay) * s);
  }

  worldToLngLat(v: { x: number; y: number; z: number }): { lngLat: LngLat; altitude: number } {
    const [ax, ay] = lngLatToMercator(this.anchor);
    const s = this.anchorScale;
    const lngLat = mercatorToLngLat(ax + v.x / s, ay + v.z / s);
    return { lngLat, altitude: (v.y * metersPerMercatorUnit(lngLat[1])) / s };
  }

  /** Recomputes the Three.js camera from the MapLibre-style state. */
  update(): void {
    const k = this.unitsPerPixel;
    const D = this.cameraToCenterDistance;
    const p = this.pitch * DEG;
    const b = this.bearing * DEG;
    const c = this.lngLatToWorld(this.center);
    const dx = Math.sin(b),
      dz = -Math.cos(b); // horizontal direction of screen-up on the ground
    const cam = this.camera;
    cam.position.set(c.x - D * Math.sin(p) * dx * k, D * Math.cos(p) * k, c.z - D * Math.sin(p) * dz * k);
    cam.up.set(dx * Math.cos(p), Math.sin(p), dz * Math.cos(p));
    cam.lookAt(c);
    cam.fov = this.fov;
    cam.aspect = this.width / this.height;
    // MapLibre near and far planes (in pixels), scaled to world units; far is extended for fog/horizon tiles.
    const halfFov = Math.atan((this.height / 2 + this.offsetY) / D);
    const groundAngle = Math.PI / 2 + p;
    const topHalf = (Math.sin(halfFov) * D) / Math.sin(Math.max(1e-3, Math.PI - groundAngle - halfFov));
    const furthest = Math.cos(Math.PI / 2 - p) * topHalf + D;
    cam.near = Math.max(0.05, (this.height / 50) * k * 0.25);
    cam.far = Math.max(cam.near * 10, Math.min(furthest * 1.01, D * 40) * k);
    if (this.offsetX || this.offsetY)
      cam.setViewOffset(this.width, this.height, -this.offsetX, -this.offsetY, this.width, this.height);
    else cam.clearViewOffset();
    cam.updateMatrixWorld(true);
    this.viewProjection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /** Screen position (CSS pixels, origin top-left) of a lng/lat at an altitude, or null if behind the camera. */
  project(lngLat: LngLat, altitude = 0): { x: number; y: number } | null {
    const v = this.lngLatToWorld(lngLat, altitude);
    return this.worldToScreen(v);
  }

  worldToScreen(v: Vector3): { x: number; y: number } | null {
    const e = this.viewProjection.elements;
    const x = v.x,
      y = v.y,
      z = v.z;
    const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    if (w <= 1e-9) return null;
    const nx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w;
    const ny = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w;
    return { x: ((nx + 1) / 2) * this.width, y: ((1 - ny) / 2) * this.height };
  }

  /** Intersection of the view ray through a screen point with the ground plane (y = 0), as world coordinates. */
  screenToGround(point: { x: number; y: number }, out = new Vector3()): Vector3 | null {
    const cam = this.camera;
    const nx = (point.x / this.width) * 2 - 1;
    const ny = 1 - (point.y / this.height) * 2;
    const near = new Vector3(nx, ny, -1).unproject(cam);
    const far = new Vector3(nx, ny, 1).unproject(cam);
    const dir = far.sub(near);
    if (dir.y >= -1e-12) return null; // ray does not reach the ground (above the horizon)
    const t = -near.y / dir.y;
    return out.copy(near).addScaledVector(dir, t);
  }

  unproject(point: { x: number; y: number }): LngLat | null {
    const g = this.screenToGround(point);
    return g ? this.worldToLngLat(g).lngLat : null;
  }

  /** Distance from the camera to a world point. */
  distanceTo(v: Vector3): number {
    return this.camera.position.distanceTo(v);
  }

  /**
   * Visible ground polygon in world coordinates (screen corners projected to the ground; above the horizon the rays
   * are cut at `maxDistance` world units from the camera foot).
   */
  groundFootprint(maxDistance: number, margin = 0): Vector3[] {
    const w = this.width,
      h = this.height;
    const mx = w * margin,
      my = h * margin;
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i <= 4; i++) samples.push({ x: -mx + ((w + 2 * mx) * i) / 4, y: -my });
    for (let i = 1; i <= 4; i++) samples.push({ x: w + mx, y: -my + ((h + 2 * my) * i) / 4 });
    for (let i = 3; i >= 0; i--) samples.push({ x: -mx + ((w + 2 * mx) * i) / 4, y: h + my });
    for (let i = 3; i >= 1; i--) samples.push({ x: -mx, y: -my + ((h + 2 * my) * i) / 4 });
    const foot = new Vector3(this.camera.position.x, 0, this.camera.position.z);
    const out: Vector3[] = [];
    const cam = this.camera;
    for (const s of samples) {
      let g = this.screenToGround(s);
      if (!g || g.distanceTo(foot) > maxDistance) {
        // direction of the ray projected on the ground, clamped to the horizon distance
        const nx = (s.x / w) * 2 - 1;
        const ny = 1 - (s.y / h) * 2;
        const far = new Vector3(nx, ny, 1).unproject(cam);
        const dir = far.sub(cam.position);
        dir.y = 0;
        if (dir.lengthSq() < 1e-12) continue;
        g = foot.clone().addScaledVector(dir.normalize(), maxDistance);
      }
      out.push(g);
    }
    return out;
  }

  /** Earth circumference shortcut for callers that need metre conversions. */
  static circumference = EARTH_CIRCUMFERENCE;
}
