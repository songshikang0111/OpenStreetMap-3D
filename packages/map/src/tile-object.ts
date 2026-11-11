// Builds Three.js objects for one generated tile. One mesh per material role batch (≤ 12 draw calls per L1 tile).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Material } from 'three';
import type { GeneratedTile, MeshBatch } from '@city-ink/generators';
import { TREE_STRIDE } from '@city-ink/generators';

export interface RoleStyle {
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}

/** Shared materials keyed by semantic role; rebuilt by setStyle without touching geometry. */
export class MaterialLibrary {
  private readonly map = new Map<string, MeshStandardMaterial>();
  readonly crown: MeshStandardMaterial;
  readonly trunk: MeshStandardMaterial;
  constructor(public roles: Record<string, RoleStyle> = {}) {
    this.crown = new MeshStandardMaterial({ color: '#8fbf7a', roughness: 0.9, flatShading: true });
    this.trunk = new MeshStandardMaterial({ color: '#7a6450', roughness: 1 });
  }

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

  get(role: string): MeshStandardMaterial {
    let m = this.map.get(role);
    if (!m) {
      m = new MeshStandardMaterial({ vertexColors: true });
      this.apply(role, m);
      this.map.set(role, m);
    }
    return m;
  }

  private apply(role: string, m: MeshStandardMaterial) {
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
    for (const [role, m] of this.map) this.apply(role, m);
    if (crown) this.crown.color = new Color(crown);
  }

  dispose() {
    for (const m of this.map.values()) m.dispose();
    this.map.clear();
    this.crown.dispose();
    this.trunk.dispose();
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
  g.computeBoundingSphere();
  g.computeBoundingBox();
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
  dispose(): void;
}

export function buildTileObject(generated: GeneratedTile, materials: MaterialLibrary): TileObject {
  const group = new Group();
  group.matrixAutoUpdate = false;
  let bytes = 0;
  let triangles = 0;
  const meshes: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  for (const batch of generated.batches) {
    const geometry = geometryOf(batch);
    disposables.push(geometry);
    const mesh = new Mesh(geometry, materials.get(batch.role));
    mesh.name = `${batch.layer}:${batch.role}`;
    mesh.userData.layer = batch.layer;
    mesh.userData.role = batch.role;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = !/^(road|ground|water)/.test(batch.role);
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    for (const a of Object.values(geometry.attributes))
      bytes += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
    if (geometry.index) bytes += (geometry.index.array as Uint32Array).byteLength;
    triangles += (batch.index ? batch.index.length : batch.vertexCount) / 3;
  }
  const trees = generated.trees;
  if (trees.count) {
    const crowns = new InstancedMesh(crownGeometry(), materials.crown, trees.count);
    const trunks = new InstancedMesh(trunkGeometry(), materials.trunk, trees.count);
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
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

export type { Material };
