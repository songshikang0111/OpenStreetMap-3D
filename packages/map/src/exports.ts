import type { BufferAttribute, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { TileGlb, geometryArrays } from '@city-ink/generators/glb';
import type { LngLat, Tileset } from '@city-ink/tiles';
import { FLAG_FLATTEN, FLAG_HIDDEN } from './picking/feature-state.js';
import type { TileObject } from './tile-object.js';

/** Compact visible indices and attributes together so bounds and exported vertices describe the same geometry. */
function filteredGeometry(geometry: ReturnType<typeof geometryArrays>, ids: BufferAttribute, state: Uint8Array) {
  const index = geometry.index!;
  const remap = new Int32Array(ids.count).fill(-1);
  const kept = new Uint32Array(index.length);
  let vertices = 0,
    indices = 0;
  for (let i = 0; i < index.length; i += 3) {
    if (state[ids.getX(index[i]!) * 4 + 3]! & FLAG_HIDDEN) continue;
    for (let k = i; k < i + 3; k++) {
      const source = index[k]!;
      if (remap[source] === -1) remap[source] = vertices++;
      kept[indices++] = remap[source]!;
    }
  }
  const position = new Float32Array(vertices * 3);
  const normal = geometry.normal && new Float32Array(vertices * 3);
  const color = geometry.color && new Float32Array(vertices * 3);
  for (let from = 0; from < remap.length; from++) {
    const to = remap[from]!;
    if (to === -1) continue;
    for (let axis = 0; axis < 3; axis++) {
      position[to * 3 + axis] = geometry.position[from * 3 + axis]!;
      if (normal) normal[to * 3 + axis] = geometry.normal![from * 3 + axis]!;
      if (color) color[to * 3 + axis] = geometry.color![from * 3 + axis]!;
    }
    if (state[ids.getX(from) * 4 + 3]! & FLAG_FLATTEN) position[to * 3 + 1] = Math.min(position[to * 3 + 1]!, 0.3);
  }
  return { position, normal, color, index: kept.subarray(0, indices) };
}

export function loadedTileGLB(tileset: Tileset, origin: LngLat, tiles: [string, TileObject][], maxBytes: number) {
  const parts: Blob[] = [];
  const writer = new TileGlb(tileset, origin, 'loaded', (bytes) => parts.push(new Blob([bytes])), maxBytes);
  for (const [key, obj] of tiles) {
    const parent = writer.tile(key, obj.group.matrix.toArray());
    const state = obj.state.data;
    const hasFilter = state.some((byte, i) => i % 4 === 3 && !!(byte & (FLAG_HIDDEN | FLAG_FLATTEN)));
    for (const child of obj.group.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.visible) continue;
      let geo = geometryArrays(mesh.geometry);
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
        if (ids && geo.index && hasFilter) geo = filteredGeometry(geo, ids as BufferAttribute, state);
      }
      const color = (mesh.material as MeshStandardMaterial).color;
      writer.mesh(parent, mesh.name, geo, color?.toArray(), matrices);
    }
  }
  return new Blob([writer.header(), ...parts], { type: 'model/gltf-binary' });
}
