// Per-feature state without rebuilding geometry (04 section 6): every tile and overlay owns a small RGBA8 texture
// indexed by renderId. Materials read it in the vertex shader: alpha holds flags (1 hidden, 2 highlight, 4 colour),
// rgb an override colour. Setting a state only rewrites four bytes and re-uploads the texture.
import { Color, DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import type { Material, Mesh, Object3D } from 'three';

export const STATE_WIDTH = 256;
export const FLAG_HIDDEN = 1;
export const FLAG_HIGHLIGHT = 2;
export const FLAG_COLOR = 4;
/** Set by the ProvenanceFilter: the feature is drawn as a footprint on the ground (05 section 5). */
export const FLAG_FLATTEN = 8;

export interface FeatureStateValue {
  hidden?: boolean;
  highlight?: boolean;
  color?: string | null;
  [key: string]: unknown;
}

export class FeatureStateTexture {
  readonly texture: DataTexture;
  readonly data: Uint8Array;
  /** Flags owned by the ProvenanceFilter, merged with the user state flags. */
  private readonly filterFlags: Uint8Array;
  private readonly userFlags: Uint8Array;
  constructor(readonly capacity: number) {
    const rows = Math.max(1, Math.ceil((capacity + 1) / STATE_WIDTH));
    this.data = new Uint8Array(STATE_WIDTH * rows * 4);
    this.filterFlags = new Uint8Array(STATE_WIDTH * rows);
    this.userFlags = new Uint8Array(STATE_WIDTH * rows);
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
    this.userFlags[renderId] = flags;
    this.data[o + 3] = flags | this.filterFlags[renderId]!;
    this.texture.needsUpdate = true;
  }

  /** Replaces the filter flags of a feature (FLAG_HIDDEN, FLAG_FLATTEN); user state flags are kept. */
  setFilter(renderId: number, flags: number): void {
    if (renderId < 0 || renderId >= this.filterFlags.length) return;
    if (this.filterFlags[renderId] === flags) return;
    this.filterFlags[renderId] = flags;
    this.data[renderId * 4 + 3] = this.userFlags[renderId]! | flags;
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

/** A 1x1 texture meaning "no style rule applies" (05 section 4 rules are evaluated per tile into RuleTexture). */
export const EMPTY_RULES = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
EMPTY_RULES.needsUpdate = true;

/**
 * Per-feature style-rule results of one tile and role: rgb = colour, a = 0 (no rule) or 1 + opacity·126, plus 128 when
 * the colour is set. Written when a tile loads or the style changes, never per frame.
 */
export class RuleTexture {
  readonly texture: DataTexture;
  readonly data: Uint8Array;
  /** Bit mask of the role indices a feature's override applies to (r: roles 0-7, g: roles 8-15). */
  readonly mask: DataTexture;
  readonly maskData: Uint8Array;
  constructor(capacity: number) {
    const rows = Math.max(1, Math.ceil((capacity + 1) / STATE_WIDTH));
    this.data = new Uint8Array(STATE_WIDTH * rows * 4);
    this.maskData = new Uint8Array(STATE_WIDTH * rows * 4);
    this.texture = new DataTexture(this.data, STATE_WIDTH, rows, RGBAFormat, UnsignedByteType);
    this.mask = new DataTexture(this.maskData, STATE_WIDTH, rows, RGBAFormat, UnsignedByteType);
    for (const t of [this.texture, this.mask]) {
      t.magFilter = t.minFilter = NearestFilter;
      t.generateMipmaps = false;
    }
  }
  setMask(renderId: number, mask: number) {
    if (renderId < 0 || renderId * 4 + 3 >= this.maskData.length) return;
    this.maskData[renderId * 4] = mask & 255;
    this.maskData[renderId * 4 + 1] = (mask >> 8) & 255;
  }
  set(renderId: number, color: string | undefined, opacity: number | undefined) {
    if (renderId < 0 || renderId * 4 + 3 >= this.data.length) return;
    const o = renderId * 4;
    if (color) {
      const c = new Color(color);
      this.data[o] = Math.round(c.r * 255);
      this.data[o + 1] = Math.round(c.g * 255);
      this.data[o + 2] = Math.round(c.b * 255);
    }
    this.data[o + 3] = 1 + Math.round(Math.max(0, Math.min(1, opacity ?? 1)) * 126) + (color ? 128 : 0);
  }
  commit() {
    this.texture.needsUpdate = true;
    this.mask.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
    this.mask.dispose();
  }
}

const VERTEX_DECL = /* glsl */ `
attribute float renderId;
#ifdef USE_INSTANCING
attribute float instanceRenderId;
#endif
uniform sampler2D featureState;
uniform sampler2D ruleState;
varying vec4 vFeatureState;
varying vec4 vRuleState;
`;

const VERTEX_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  float cityRid = instanceRenderId;
#else
  float cityRid = renderId;
#endif
  int cityId = int(cityRid + 0.5);
  vFeatureState = texelFetch(featureState, ivec2(cityId % ${STATE_WIDTH}, cityId / ${STATE_WIDTH}), 0);
  ivec2 citySize = textureSize(ruleState, 0);
  vRuleState = citySize.x > 1 ? texelFetch(ruleState, ivec2(cityId % ${STATE_WIDTH}, cityId / ${STATE_WIDTH}), 0) : vec4(0.0);
  if (int(vFeatureState.a * 255.0 + 0.5) % 2 == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if ((int(vFeatureState.a * 255.0 + 0.5) / 8) % 2 == 1) transformed.y = min(transformed.y, 0.3);
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec4 vFeatureState;
varying vec4 vRuleState;
uniform vec3 highlightColor;
uniform float highlightIntensity;
`;

/**
 * Patches a built-in material so it honours a per-feature state texture. three.js only re-uploads uniforms of
 * built-in materials when the material changes between draws, so every tile or overlay gets its own material
 * instance carrying its own texture; the program is shared through the cache key, so nothing recompiles.
 */
export function patchFeatureState(material: Material, texture: DataTexture | null = null): void {
  const own = {
    featureState: { value: texture },
    ruleState: { value: EMPTY_RULES as DataTexture },
    highlightColor: stateUniforms.highlightColor,
    highlightIntensity: stateUniforms.highlightIntensity,
  };
  material.userData.featureStateUniforms = own;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  { int cityRule = int(vRuleState.a * 255.0 + 0.5);
    if (cityRule > 0) {
      if (cityRule >= 128) diffuseColor.rgb = vRuleState.rgb;
      diffuseColor.a *= float((cityRule % 128) - 1) / 126.0;
    }
    int cityFlags = int(vFeatureState.a * 255.0 + 0.5);
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
  material.customProgramCacheKey = () => `${key()}|city-feature-state-v2`;
}

/** Binds an object's state texture before each draw (shared materials need a per-object uniform value). */
export function bindStateTexture(object: Object3D, state: FeatureStateTexture): void {
  object.onBeforeRender = (_r, _s, _c, _g, material) => {
    stateUniforms.featureState.value = state.texture;
    (material as Material & { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
  };
}

export type { Mesh };
