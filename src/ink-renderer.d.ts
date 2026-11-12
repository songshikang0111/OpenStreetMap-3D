// Type boundary for the phase-two packages (decision E4); the implementation stays in ink-renderer.js.
import type { Camera, Material, Object3D, Scene, ShaderMaterial, WebGLRenderer } from 'three';

export const INK_DEFAULTS: Readonly<Record<string, number>>;
export class InkRenderer {
  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, facadeShared?: Record<string, { value: unknown }>);
  material: ShaderMaterial;
  idMaterial: Material;
  aoEnabled?: boolean;
  prepareScene(): void;
  prepareGroup(group: Object3D): void;
  releaseGroup(group: Object3D): void;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}
