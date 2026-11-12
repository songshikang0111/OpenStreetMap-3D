// GPU picking (04 section 6, WP-E): renders only the pixel under the cursor with id materials into a 1×1 target.
// RGB carries the renderId (24 bits), A the slot of the tile or overlay that owns the mesh.
import { Color, NoBlending, ShaderMaterial, WebGLRenderTarget } from 'three';
import type { Material, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { STATE_WIDTH, bindStateTexture, stateUniforms } from './feature-state.js';
import type { FeatureStateTexture } from './feature-state.js';

export const PICK_LAYER = 31;

const VERTEX = /* glsl */ `
attribute float renderId;
#ifdef USE_INSTANCING
attribute float instanceRenderId;
#endif
uniform sampler2D featureState;
varying float vId;
void main() {
#ifdef USE_INSTANCING
  float rid = instanceRenderId;
  vec4 p = instanceMatrix * vec4(position, 1.0);
#else
  float rid = renderId;
  vec4 p = vec4(position, 1.0);
#endif
  int id = int(rid + 0.5);
  vec4 s = texelFetch(featureState, ivec2(id % ${STATE_WIDTH}, id / ${STATE_WIDTH}), 0);
  if (int(s.a * 255.0 + 0.5) % 2 == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
#ifndef USE_INSTANCING
  if ((int(s.a * 255.0 + 0.5) / 8) % 2 == 1) p.y = min(p.y, 0.3);
#endif
  vId = rid;
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const FRAGMENT = /* glsl */ `
uniform float slot;
varying float vId;
void main() {
  int id = int(vId + 0.5);
  gl_FragColor = vec4(float(id % 256), float((id / 256) % 256), float((id / 65536) % 256), slot) / 255.0;
}`;

export interface Pickable {
  mesh: Mesh;
  slot: number;
  state: FeatureStateTexture;
}

export interface PickResult {
  slot: number;
  renderId: number;
}

export class Picker {
  private readonly target = new WebGLRenderTarget(1, 1);
  private readonly materials = new Map<number, ShaderMaterial>();
  private readonly pixel = new Uint8Array(4);
  /** Main-thread time of the last pick, for diagnostics (AC502). */
  lastMs = 0;

  private material(slot: number): ShaderMaterial {
    let m = this.materials.get(slot);
    if (!m) {
      m = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { featureState: stateUniforms.featureState, slot: { value: slot } },
        blending: NoBlending,
      });
      this.materials.set(slot, m);
    }
    return m;
  }

  pick(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
    items: Pickable[],
  ): PickResult | null {
    const t0 = performance.now();
    const saved: { mesh: Mesh; material: Material | Material[]; layers: number; before: Mesh['onBeforeRender'] }[] = [];
    for (const item of items) {
      saved.push({
        mesh: item.mesh,
        material: item.mesh.material,
        layers: item.mesh.layers.mask,
        before: item.mesh.onBeforeRender,
      });
      const own = item.mesh.userData.pickMaterial as ShaderMaterial | undefined;
      if (own) (own.uniforms.slot as { value: number }).value = item.slot;
      item.mesh.material = own ?? this.material(item.slot);
      item.mesh.layers.set(PICK_LAYER);
      bindStateTexture(item.mesh, item.state);
    }
    const cameraLayers = camera.layers.mask;
    const background = scene.background;
    const fog = scene.fog;
    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    try {
      scene.background = null;
      scene.fog = null;
      camera.layers.set(PICK_LAYER);
      camera.setViewOffset(width, height, Math.floor(x), Math.floor(y), 1, 1);
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.pixel);
    } finally {
      camera.clearViewOffset();
      camera.layers.mask = cameraLayers;
      scene.background = background;
      scene.fog = fog;
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColor, clearAlpha);
      for (const s of saved) {
        s.mesh.material = s.material;
        s.mesh.layers.mask = s.layers;
        s.mesh.onBeforeRender = s.before;
      }
    }
    this.lastMs = performance.now() - t0;
    const [r, g, b, a] = this.pixel;
    if (!a) return null;
    return { slot: a!, renderId: r! + g! * 256 + b! * 65536 };
  }

  dispose(): void {
    this.target.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
