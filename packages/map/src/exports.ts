import type { InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { TileGlb, geometryArrays } from '@city-ink/generators/glb';
import type { LngLat, Tileset } from '@city-ink/tiles';
import { FLAG_FLATTEN, FLAG_HIDDEN } from './picking/feature-state.js';
import type { TileObject } from './tile-object.js';

export function loadedTileGLB(tileset: Tileset, origin: LngLat, tiles: [string, TileObject][], maxBytes: number) {
  const parts: Blob[] = [];
  const writer = new TileGlb(tileset, origin, 'loaded', (bytes) => parts.push(new Blob([bytes])), maxBytes);
  for (const [key, obj] of tiles) {
    const parent = writer.tile(key, obj.group.matrix.toArray());
    const state = obj.state.data;
    for (const child of obj.group.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.visible) continue;
      const geo = geometryArrays(mesh.geometry);
      const inst = mesh as InstancedMesh;
      let matrices: Float32Array | undefined;
      if (inst.isInstancedMesh) {
        const values = inst.instanceMatrix.array as Float32Array;
        const ids = mesh.geometry.getAttribute('instanceRenderId');
        const shown: number[] = [];
        for (let i = 0; i < inst.count; i++) if (!(state[ids.getX(i) * 4 + 3]! & FLAG_HIDDEN)) shown.push(i);
        if (shown.length === inst.count) matrices = values.subarray(0, 16 * inst.count);
        else {
          matrices = new Float32Array(16 * shown.length);
          for (const [n, i] of shown.entries()) matrices.set(values.subarray(16 * i, 16 * i + 16), 16 * n);
        }
      } else {
        const ids = mesh.geometry.getAttribute('renderId');
        if (ids && geo.index && state.some((byte, i) => i % 4 === 3 && !!(byte & (FLAG_HIDDEN | FLAG_FLATTEN)))) {
          const position = geo.position.slice();
          for (let i = 0; i < ids.count; i++)
            if (state[ids.getX(i) * 4 + 3]! & FLAG_FLATTEN) position[i * 3 + 1] = Math.min(position[i * 3 + 1]!, 0.3);
          const kept = [];
          for (let i = 0; i < geo.index.length; i += 3)
            if (!(state[ids.getX(geo.index[i]!) * 4 + 3]! & FLAG_HIDDEN))
              kept.push(geo.index[i]!, geo.index[i + 1]!, geo.index[i + 2]!);
          geo.index = Uint32Array.from(kept);
          geo.position = position;
        }
      }
      const color = (mesh.material as MeshStandardMaterial).color;
      writer.mesh(parent, mesh.name, geo, color?.toArray(), matrices);
    }
  }
  return new Blob([writer.header(), ...parts], { type: 'model/gltf-binary' });
}
