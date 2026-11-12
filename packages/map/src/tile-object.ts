// Builds Three.js objects for one generated tile. One mesh per material role batch (≤ 12 draw calls per L1 tile).
import {
  Box3,
  Sphere,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Material } from 'three';
import type { GeneratedTile, MeshBatch } from '@city-ink/generators';
import { FeatureStateTexture, patchFeatureState } from './picking/feature-state.js';
import { TREE_STRIDE } from '@city-ink/generators';

export interface RoleStyle {
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}

/**
 * Materials keyed by semantic role; rebuilt by setStyle without touching geometry. Each tile draws with its own
 * lightweight copies (same program) so its feature-state texture can be bound (see patchFeatureState).
 */
export class MaterialLibrary {
  private readonly copies = new Map<MeshStandardMaterial, string>();
  private foliage = '#8fbf7a';
  constructor(public roles: Record<string, RoleStyle> = {}) {}

  /** Resolves a role ("road.marking" falls back to "road"). */
  resolve(role: string): RoleStyle {
    let r = role;
    while (r) {
      if (this.roles[r]) return this.roles[r]!;
      const dot = r.lastIndexOf('.');
      r = dot > 0 ? r.slice(0, dot) : '';
    }
    return {};
  }

  /** A material for one tile or overlay, bound to its feature-state texture; release it with `release`. */
  acquire(role: string, state: FeatureStateTexture): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ vertexColors: role !== 'tree.crown' && role !== 'tree.trunk' });
    patchFeatureState(m, state.texture);
    this.apply(role, m);
    this.copies.set(m, role);
    return m;
  }

  release(m: MeshStandardMaterial) {
    if (this.copies.delete(m)) m.dispose();
  }

  get size(): number {
    return this.copies.size;
  }

  private apply(role: string, m: MeshStandardMaterial) {
    if (role === 'tree.crown') {
      m.color = new Color(this.foliage);
      m.roughness = 0.9;
      m.flatShading = true;
      m.needsUpdate = true;
      return;
    }
    if (role === 'tree.trunk') {
      m.color = new Color('#7a6450');
      m.roughness = 1;
      m.needsUpdate = true;
      return;
    }
    const s = this.resolve(role);
    const ground = /^(road|ground|water)/.test(role);
    // Vertex colours carry generator colours; a role colour tints them (white keeps them as generated).
    m.color = new Color(s.color ?? '#ffffff');
    m.roughness = s.roughness ?? (role.startsWith('glass') ? 0.25 : role === 'water' ? 0.15 : 0.9);
    m.metalness = s.metalness ?? (role.startsWith('glass') ? 0.15 : 0.02);
    m.transparent = (s.opacity ?? 1) < 1;
    m.opacity = s.opacity ?? 1;
    m.polygonOffset = ground;
    m.polygonOffsetFactor = ground ? -1 : 0;
    m.polygonOffsetUnits = ground ? -1 : 0;
    m.needsUpdate = true;
  }

  restyle(roles: Record<string, RoleStyle>, crown?: string) {
    this.roles = roles;
    if (crown) this.foliage = crown;
    for (const [m, role] of this.copies) this.apply(role, m);
  }

  dispose() {
    for (const m of this.copies.keys()) m.dispose();
    this.copies.clear();
  }
}

function geometryOf(batch: MeshBatch): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(batch.position, 3));
  g.setAttribute('normal', new BufferAttribute(batch.normal, 3));
  g.setAttribute('color', new BufferAttribute(batch.color, 3));
  g.setAttribute('renderId', new BufferAttribute(batch.renderId, 1));
  if (batch.facade) {
    g.setAttribute('aFacade', new BufferAttribute(batch.facade.aFacade, 4));
    g.setAttribute('aStyle', new BufferAttribute(batch.facade.aStyle, 2));
    g.setAttribute('aLayout', new BufferAttribute(batch.facade.aLayout, 4));
    g.setAttribute('aSurface', new BufferAttribute(batch.facade.aSurface, 2));
  }
  if (batch.index) g.setIndex(new BufferAttribute(batch.index, 1));
  // Bounds come from the worker; recomputing them here would cost milliseconds per tile on the main thread.
  const [x0, y0, z0, x1, y1, z1] = batch.bounds;
  g.boundingBox = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

const crownGeometry = () => new IcosahedronGeometry(1, 1);
const trunkGeometry = () => new CylinderGeometry(0.12, 0.18, 1, 6, 1).translate(0, 0.5, 0);

export interface TileObject {
  group: Group;
  bytes: number;
  triangles: number;
  drawCalls: number;
  meshes: Mesh[];
  /** Per-feature state (hidden, highlight, colour) indexed by renderId. */
  state: FeatureStateTexture;
  /** Meshes that take part in picking (trunks excluded). */
  pickable: Mesh[];
  dispose(): void;
}

export function buildTileObject(generated: GeneratedTile, materials: MaterialLibrary, capacity?: number): TileObject {
  const group = new Group();
  group.matrixAutoUpdate = false;
  let bytes = 0;
  let triangles = 0;
  const meshes: Mesh[] = [];
  let maxId = capacity ?? 0;
  if (capacity === undefined) {
    for (const b of generated.batches) for (const r of b.renderId) if (r > maxId) maxId = r;
    for (const r of generated.trees.renderId) if (r > maxId) maxId = r;
  }
  const state = new FeatureStateTexture(maxId);
  const pickable: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  for (const batch of generated.batches) {
    const geometry = geometryOf(batch);
    disposables.push(geometry);
    const material = materials.acquire(batch.role, state);
    disposables.push({ dispose: () => materials.release(material) });
    const mesh = new Mesh(geometry, material);
    mesh.name = `${batch.layer}:${batch.role}`;
    mesh.userData.layer = batch.layer;
    mesh.userData.role = batch.role;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = !/^(road|ground|water)/.test(batch.role);
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    pickable.push(mesh);
    for (const a of Object.values(geometry.attributes))
      bytes += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
    if (geometry.index) bytes += (geometry.index.array as Uint32Array).byteLength;
    triangles += (batch.index ? batch.index.length : batch.vertexCount) / 3;
  }
  const trees = generated.trees;
  if (trees.count) {
    const crownMaterial = materials.acquire('tree.crown', state);
    const trunkMaterial = materials.acquire('tree.trunk', state);
    disposables.push({ dispose: () => (materials.release(crownMaterial), materials.release(trunkMaterial)) });
    const crowns = new InstancedMesh(crownGeometry(), crownMaterial, trees.count);
    const trunks = new InstancedMesh(trunkGeometry(), trunkMaterial, trees.count);
    crowns.instanceMatrix.setUsage(DynamicDrawUsage);
    const m = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < trees.count; i++) {
      const o = i * TREE_STRIDE;
      const [x, y, z, h, r, shape] = [
        trees.data[o]!,
        trees.data[o + 1]!,
        trees.data[o + 2]!,
        trees.data[o + 3]!,
        trees.data[o + 4]!,
        trees.data[o + 5]!,
      ];
      const narrow = shape === 2 || shape === 4;
      const crownR = narrow ? r * 0.55 : r;
      const crownH = narrow ? h * 0.45 : Math.min(h * 0.55, r * 1.6);
      m.compose(new Vector3(x, y + h - crownH, z), q, new Vector3(crownR, crownH, crownR));
      crowns.setMatrixAt(i, m);
      m.compose(new Vector3(x, y, z), q, new Vector3(1, h - crownH * 0.9, 1));
      trunks.setMatrixAt(i, m);
    }
    crowns.userData.layer = trunks.userData.layer = 'tree';
    crowns.userData.renderIds = trees.renderId;
    crowns.castShadow = true;
    crowns.computeBoundingSphere();
    trunks.computeBoundingSphere();
    const instanceIds = new InstancedBufferAttribute(new Float32Array(trees.renderId), 1);
    crowns.geometry.setAttribute('instanceRenderId', instanceIds);
    trunks.geometry.setAttribute('instanceRenderId', instanceIds);
    pickable.push(crowns);
    group.add(crowns, trunks);
    disposables.push(crowns.geometry, trunks.geometry, { dispose: () => (crowns.dispose(), trunks.dispose()) });
    bytes += trees.count * 16 * 4 * 2 + trees.data.byteLength;
    triangles +=
      trees.count *
      (crowns.geometry.index ? crowns.geometry.index.count / 3 : crowns.geometry.attributes.position!.count / 3);
  }
  return {
    group,
    bytes,
    triangles,
    drawCalls: meshes.length + (trees.count ? 2 : 0),
    meshes,
    state,
    pickable,
    dispose() {
      for (const d of disposables) d.dispose();
      state.dispose();
      group.clear();
    },
  };
}

export type { Material };
