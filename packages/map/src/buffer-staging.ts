// WebGLRenderer prepares the attributes of a mesh during projection, before testing material.visible.
// Use the final geometry and attributes so Three owns binding, re-use, context restoration and disposal.
import { BufferGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import type { Camera, WebGLRenderer } from 'three';

export interface AttributeUpload {
  geometry: BufferGeometry;
  names: string[];
  next: number;
}

const quantum = 2 ** 20 * 2;

export function denseAttributes(geometry: BufferGeometry): AttributeUpload | undefined {
  const names = Object.keys(geometry.attributes);
  const bytes = names.reduce((total, name) => total + geometry.attributes[name]!.array.byteLength, 0);
  return bytes >= quantum ? { geometry, names, next: 0 } : undefined;
}

export class BufferStaging {
  private readonly scene = new Scene();
  private readonly empty = new BufferGeometry();
  private readonly material = new MeshBasicMaterial();
  private readonly mesh = new Mesh(this.empty, this.material);
  constructor() {
    this.material.visible = false;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  submit(renderer: WebGLRenderer, camera: Camera, job: AttributeUpload): number {
    const original = job.geometry.attributes;
    const slice: typeof original = {};
    let bytes = 0;
    do {
      const name = job.names[job.next++]!;
      const attribute = original[name]!;
      slice[name] = attribute;
      bytes += attribute.array.byteLength;
    } while (job.next < job.names.length && bytes + original[job.names[job.next]!]!.array.byteLength <= quantum);
    const clear = renderer.autoClear;
    try {
      this.mesh.geometry = job.geometry;
      job.geometry.attributes = slice;
      renderer.autoClear = false;
      renderer.render(this.scene, camera);
    } finally {
      renderer.autoClear = clear;
      job.geometry.attributes = original;
      this.mesh.geometry = this.empty;
    }
    return bytes;
  }

  dispose() {
    this.empty.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}
