// Per-feature state without rebuilding geometry (04 section 6): every tile and overlay owns a small RGBA8 texture
// indexed by renderId. Materials read it in the vertex shader: alpha holds flags (1 hidden, 2 highlight, 4 colour),
// rgb an override colour. Setting a state only rewrites four bytes and re-uploads the texture.
import { Color, DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import type { Material, Mesh, Object3D } from 'three';

export const STATE_WIDTH = 256;
export const FLAG_HIDDEN = 1;
export const FLAG_HIGHLIGHT = 2;
export const FLAG_COLOR = 4;

export interface FeatureStateValue {
  hidden?: boolean;
  highlight?: boolean;
  color?: string | null;
  [key: string]: unknown;
}

export class FeatureStateTexture {
  readonly texture: DataTexture;
  readonly data: Uint8Array;
  constructor(readonly capacity: number) {
    const rows = Math.max(1, Math.ceil((capacity + 1) / STATE_WIDTH));
    this.data = new Uint8Array(STATE_WIDTH * rows * 4);
    this.texture = new DataTexture(this.data, STATE_WIDTH, rows, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  set(renderId: number, state: FeatureStateValue | undefined): void {
    if (renderId < 0 || renderId * 4 + 3 >= this.data.length) return;
    const o = renderId * 4;
    let flags = 0;
    if (state?.hidden) flags |= FLAG_HIDDEN;
    if (state?.highlight) flags |= FLAG_HIGHLIGHT;
    if (state?.color) {
      flags |= FLAG_COLOR;
      const c = new Color(state.color);
      this.data[o] = Math.round(c.r * 255);
      this.data[o + 1] = Math.round(c.g * 255);
      this.data[o + 2] = Math.round(c.b * 255);
    } else this.data[o] = this.data[o + 1] = this.data[o + 2] = 0;
    this.data[o + 3] = flags;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Shared uniforms of all patched materials; their values are switched per drawn object in onBeforeRender. */
export const stateUniforms = {
  featureState: { value: null as DataTexture | null },
  featureStateRows: { value: 1 },
  highlightColor: { value: new Color('#ffb300') },
  highlightIntensity: { value: 0.6 },
};

const VERTEX_DECL = /* glsl */ `
attribute float renderId;
#ifdef USE_INSTANCING
attribute float instanceRenderId;
#endif
uniform sampler2D featureState;
varying vec4 vFeatureState;
`;

const VERTEX_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  float cityRid = instanceRenderId;
#else
  float cityRid = renderId;
#endif
  int cityId = int(cityRid + 0.5);
  vFeatureState = texelFetch(featureState, ivec2(cityId % ${STATE_WIDTH}, cityId / ${STATE_WIDTH}), 0);
  if (int(vFeatureState.a * 255.0 + 0.5) % 2 == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec4 vFeatureState;
uniform vec3 highlightColor;
uniform float highlightIntensity;
`;

/** Patches a built-in material so it honours the per-feature state texture. */
export function patchFeatureState(material: Material): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, stateUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  { int cityFlags = int(vFeatureState.a * 255.0 + 0.5);
    if ((cityFlags / 4) % 2 == 1) diffuseColor.rgb = vFeatureState.rgb; }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  { int cityFlags = int(vFeatureState.a * 255.0 + 0.5);
    if ((cityFlags / 2) % 2 == 1) totalEmissiveRadiance += highlightColor * highlightIntensity; }`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|city-feature-state-v1`;
}

/** Binds an object's state texture before each draw (shared materials need a per-object uniform value). */
export function bindStateTexture(object: Object3D, state: FeatureStateTexture): void {
  object.onBeforeRender = (_r, _s, _c, _g, material) => {
    stateUniforms.featureState.value = state.texture;
    (material as Material & { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
  };
}

export type { Mesh };
