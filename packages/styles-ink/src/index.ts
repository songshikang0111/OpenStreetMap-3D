// Stylised looks for City Ink (05 section 7): the phase-one comic, line, color and white styles and the external
// cel example, made usable with createMap. Explicit import only; createMap never bundles this package (AC708).
//
// The phase-one style descriptors (materials per role) stay in @city-ink/styles so the root package keeps them under
// their original ids (AC707, decision E9); this package adds the tile-mode pipeline: the phase-one InkRenderer
// (outline, screentone, solid black, AO) run over a streaming tile scene.
import { createOfficialStyle } from '@city-ink/styles';
import cel from '@city-ink/styles/cel';
import { InkRenderer, INK_DEFAULTS } from '../../../src/ink-renderer.js';
import { ShaderMaterial, DoubleSide } from 'three';
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three';

/** Package identity, used by diagnostics and tooling. */
export const PACKAGE_NAME = '@city-ink/styles-ink';

export interface TilePipeline {
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
  onTileLoad?(event: { tile: string; group: Object3D }): void;
  onTileUnload?(event: { tile: string; group: Object3D }): void;
}

export interface TileInkStyle {
  id: string;
  version: string;
  supportsTiles: true;
  hostCompatible: boolean;
  /** Facade materials keep the ink signal in the colour target's alpha (read by the ink pipeline). */
  inkAlpha?: boolean;
  parametersSchema: { properties: Record<string, { default?: unknown }> };
  createMaterial(context: Record<string, unknown>): Material;
  createPipeline?(context: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    shared: Record<string, { value: unknown }>;
    parameters: Record<string, unknown>;
  }): TilePipeline;
}

/**
 * The ink pipeline's ID pass, reading tile render ids instead of the phase-one `objectId` attribute, so outlines
 * separate neighbouring buildings inside one role batch. Instanced trees read `instanceRenderId`.
 */
function tileIdMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: `attribute float renderId; attribute float inkClass; varying vec3 vId; varying float vClass;
      #ifdef USE_INSTANCING
      attribute float instanceRenderId;
      #endif
      void main(){vec4 p=vec4(position,1.);
      #ifdef USE_INSTANCING
      float rid=instanceRenderId+4096.;p=instanceMatrix*p;
      #else
      float rid=renderId;
      #endif
      vId=vec3(mod(rid,256.),mod(floor(rid/256.),256.),mod(floor(rid/65536.),256.))/255.;vClass=inkClass;
      gl_Position=projectionMatrix*modelViewMatrix*p;}`,
    fragmentShader: `varying vec3 vId;varying float vClass;void main(){gl_FragColor=vec4(vId,vClass);}`,
    defaultAttributeValues: { renderId: [0], instanceRenderId: [0], inkClass: [4] } as never,
    side: DoubleSide,
  });
}

function inkStyle(id: 'comic' | 'line' | 'color' | 'white', mode: number): TileInkStyle {
  const base = createOfficialStyle(id, mode) as unknown as TileInkStyle;
  return {
    ...base,
    id,
    supportsTiles: true,
    // Post-processing needs its own render targets and the whole frame; it cannot draw inside a MapLibre layer.
    hostCompatible: false,
    inkAlpha: true,
    createMaterial: base.createMaterial.bind(base),
    createPipeline({ renderer, scene, camera, shared, parameters }) {
      const ink = new InkRenderer(renderer, scene, camera, shared);
      ink.idMaterial.dispose();
      ink.idMaterial = tileIdMaterial();
      ink.material.uniforms.mode!.value = mode;
      for (const [key, value] of Object.entries({ ...INK_DEFAULTS, ...parameters }))
        if (ink.material.uniforms[key]) ink.material.uniforms[key]!.value = value;
      return {
        render: () => ink.render(),
        resize: (w, h) => ink.resize(w, h),
        dispose: () => ink.dispose(),
        onTileLoad: ({ group }) => ink.prepareGroup(group),
        onTileUnload: ({ group }) => ink.releaseGroup(group),
      };
    },
  };
}

/** Manga screentone with outlines and solid blacks (phase-one default look). */
export const comic = inkStyle('comic', 0);
/** Architectural line drawing. */
export const line = inkStyle('line', 1);
/** Soft colour with ink edges and AO. */
export const color = inkStyle('color', 2);
/** Neutral clay with AO. */
export const white = inkStyle('white', 3);
/** The external cel-shaded example: materials only, no post-processing, usable in a MapLibre layer. */
export const celShaded: TileInkStyle = {
  ...(cel as unknown as TileInkStyle),
  supportsTiles: true,
  hostCompatible: true,
  createMaterial: (cel as unknown as TileInkStyle).createMaterial,
  createPipeline: undefined,
};
export { celShaded as cel };

export const inkStyles = { comic, line, color, white, cel: celShaded };
