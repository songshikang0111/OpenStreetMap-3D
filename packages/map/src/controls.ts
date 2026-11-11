// Mouse and touch interaction (04 section 4): drag to pan, wheel to zoom about the cursor, right/ctrl drag to rotate
// and pitch, one-finger pan, two-finger pinch/rotate, two-finger vertical drag to pitch, pan inertia.
import { Vector3 } from 'three';
import type { Transform } from './transform.js';

export interface ControlHost {
  transform: Transform;
  element: HTMLElement;
  /** Applies a camera change and fires move events. */
  move(
    change: { center?: [number, number]; zoom?: number; pitch?: number; bearing?: number },
    originalEvent?: Event,
  ): void;
  begin(originalEvent?: Event): void;
  end(originalEvent?: Event): void;
  stopAnimation(): void;
  click(point: { x: number; y: number }, originalEvent: Event, double: boolean): void;
  pointerMove(point: { x: number; y: number }, originalEvent: Event): void;
}

export interface ControlOptions {
  dragPan: boolean;
  scrollZoom: boolean;
  dragRotate: boolean;
  touchZoomRotate: boolean;
  touchPitch: boolean;
  inertia: boolean;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
  ctrl: boolean;
  type: string;
}

export class Controls {
  private readonly pointers = new Map<number, Pointer>();
  private grab: Vector3 | null = null;
  private velocity: { x: number; z: number; t: number }[] = [];
  private inertiaFrame = 0;
  private moved = false;
  private lastClick = 0;
  private twoFinger: {
    dist: number;
    angle: number;
    midY: number;
    zoom: number;
    bearing: number;
    pitch: number;
  } | null = null;
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private readonly host: ControlHost,
    public options: ControlOptions,
  ) {
    const el = host.element;
    const on = (type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.listeners.push([type, fn as EventListener, opts]);
    };
    el.style.touchAction = 'none';
    on('pointerdown', (e: PointerEvent) => this.down(e));
    on('pointermove', (e: PointerEvent) => this.moveEvent(e));
    on('pointerup', (e: PointerEvent) => this.up(e));
    on('pointercancel', (e: PointerEvent) => this.up(e));
    on('wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on('contextmenu', (e: Event) => e.preventDefault());
  }

  private point(e: { clientX: number; clientY: number }) {
    const r = this.host.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    const p = this.point(e);
    this.host.element.setPointerCapture?.(e.pointerId);
    cancelAnimationFrame(this.inertiaFrame);
    this.host.stopAnimation();
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      ...p,
      startX: p.x,
      startY: p.y,
      button: e.button,
      ctrl: e.ctrlKey || e.metaKey,
      type: e.pointerType,
    });
    this.moved = false;
    this.velocity = [];
    if (this.pointers.size === 1) this.grab = this.host.transform.screenToGround(p);
    if (this.pointers.size === 2) this.startTwoFinger();
    this.host.begin(e);
  }

  private startTwoFinger() {
    const [a, b] = [...this.pointers.values()];
    const t = this.host.transform;
    this.twoFinger = {
      dist: Math.hypot(b!.x - a!.x, b!.y - a!.y),
      angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
      midY: (a!.y + b!.y) / 2,
      zoom: t.zoom,
      bearing: t.bearing,
      pitch: t.pitch,
    };
    this.grab = t.screenToGround({ x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
  }

  /** Moves the centre so that the world point `grab` lies under `screen`. */
  private keepUnder(grab: Vector3, screen: { x: number; y: number }, e: Event) {
    const t = this.host.transform;
    const now = t.screenToGround(screen);
    if (!now) return;
    const c = t.lngLatToWorld(t.center);
    c.x += grab.x - now.x;
    c.z += grab.z - now.z;
    this.velocity.push({ x: grab.x - now.x, z: grab.z - now.z, t: performance.now() });
    if (this.velocity.length > 8) this.velocity.shift();
    this.host.move({ center: t.worldToLngLat(c).lngLat }, e);
  }

  private moveEvent(e: PointerEvent) {
    const p = this.point(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      this.host.pointerMove(p, e);
      return;
    }
    const dx = p.x - ptr.x,
      dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    if (Math.hypot(p.x - ptr.startX, p.y - ptr.startY) > 3) this.moved = true;
    const t = this.host.transform;
    if (this.pointers.size === 1) {
      const rotate = ptr.button === 2 || ptr.ctrl;
      if (rotate && this.options.dragRotate) {
        this.host.move({ bearing: t.bearing - dx * 0.4, pitch: t.pitch - dy * 0.3 }, e);
      } else if (this.options.dragPan && this.grab) this.keepUnder(this.grab, p, e);
      return;
    }
    if (this.pointers.size === 2 && this.twoFinger) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const s = this.twoFinger;
      const change: Parameters<ControlHost['move']>[0] = {};
      // Two-finger vertical drag with a constant distance pitches; otherwise pinch-zoom and rotate.
      const pitchGesture = this.options.touchPitch && Math.abs(dist - s.dist) < 12 && Math.abs(mid.y - s.midY) > 8;
      if (pitchGesture) change.pitch = s.pitch - (mid.y - s.midY) * 0.3;
      else if (this.options.touchZoomRotate) {
        change.zoom = s.zoom + Math.log2(Math.max(1, dist) / Math.max(1, s.dist));
        change.bearing = s.bearing - ((angle - s.angle) * 180) / Math.PI;
      }
      this.host.move(change, e);
      if (!pitchGesture && this.grab) this.keepUnder(this.grab, mid, e);
    }
  }

  private up(e: PointerEvent) {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      const rest = [...this.pointers.values()][0]!;
      this.grab = this.host.transform.screenToGround(rest);
      this.twoFinger = null;
    }
    if (this.pointers.size) return;
    this.twoFinger = null;
    if (ptr && !this.moved && e.type === 'pointerup') {
      const now = performance.now();
      const double = now - this.lastClick < 300;
      this.lastClick = double ? 0 : now;
      this.host.click(this.point(e), e, double);
      if (double && this.options.scrollZoom) this.zoomAt(this.point(e), 1, e);
    }
    if (this.moved && this.options.inertia) this.startInertia(e);
    else this.host.end(e);
  }

  private startInertia(e: Event) {
    const now = performance.now();
    const recent = this.velocity.filter((v) => now - v.t < 120);
    if (recent.length < 2) {
      this.host.end(e);
      return;
    }
    const span = Math.max(16, now - recent[0]!.t);
    let vx = recent.reduce((s, v) => s + v.x, 0) / span;
    let vz = recent.reduce((s, v) => s + v.z, 0) / span;
    let last = now;
    const step = () => {
      const t = performance.now();
      const dt = t - last;
      last = t;
      const decay = Math.exp(-dt / 220);
      vx *= decay;
      vz *= decay;
      const tr = this.host.transform;
      const c = tr.lngLatToWorld(tr.center);
      c.x += vx * dt;
      c.z += vz * dt;
      this.host.move({ center: tr.worldToLngLat(c).lngLat }, e);
      if (Math.hypot(vx, vz) * 16 > tr.unitsPerPixel * 0.5) this.inertiaFrame = requestAnimationFrame(step);
      else this.host.end(e);
    };
    this.inertiaFrame = requestAnimationFrame(step);
  }

  zoomAt(point: { x: number; y: number }, delta: number, e: Event) {
    const t = this.host.transform;
    const grab = t.screenToGround(point);
    this.host.move({ zoom: t.zoom + delta }, e);
    if (grab) this.keepUnder(grab, point, e);
  }

  private wheel(e: WheelEvent) {
    if (!this.options.scrollZoom) return;
    e.preventDefault();
    cancelAnimationFrame(this.inertiaFrame);
    this.host.stopAnimation();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const delta = (-e.deltaY * scale) / 450;
    this.host.begin(e);
    this.zoomAt(this.point(e), Math.max(-1, Math.min(1, delta)), e);
    this.host.end(e);
  }

  dispose() {
    cancelAnimationFrame(this.inertiaFrame);
    for (const [type, fn, opts] of this.listeners) this.host.element.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }
}
