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
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
} from 'three';
import type { Material, Object3D } from 'three';
import { installFacadeShader, extendFacadeShader, facadeAttributeDefaults } from '@city-ink/styles/facade-shader';
import { roleStyle } from '@city-ink/styles/spec';
import type { ResolvedStyleSpec, RoleStyle } from '@city-ink/styles/spec';
import { builtinStyle } from '@city-ink/styles/defaults';
import type { GeneratedTile, MeshBatch } from '@city-ink/generators';
import { FeatureStateTexture, patchFeatureState } from './picking/feature-state.js';
import { TREE_STRIDE } from '@city-ink/generators';

export type { RoleStyle } from '@city-ink/styles/spec';

/** A code style pack usable in tile mode (05 section 8): materials per role plus optional streaming hooks. */
export interface TileStylePack {
  id: string;
  supportsTiles?: boolean;
  hostCompatible?: boolean;
  parametersSchema?: { properties?: Record<string, { default?: unknown }> };
  createMaterial(context: {
    object: Object3D;
    role: string;
    semantic: Record<string, unknown>;
    shared: Record<string, { value: unknown }>;
    parameters: Record<string, unknown>;
    sourceMaterial?: Material;
    services: Record<string, unknown>;
  }): Material;
  onTileLoad?(event: { tile: string; group: Group; features: unknown[] }): void;
  onTileUnload?(event: { tile: string; group: Group }): void;
}

const FACADE_ROLE = /^(wall|glass)(\.|$)/;
const GROUND_ROLE = /^(road|ground|water)/;

interface Copy {
  depth: Material | null;
  role: string;
  mesh: Object3D | null;
  state: FeatureStateTexture;
  replace: { value: number };
}

/**
 * Materials keyed by semantic role; rebuilt by setStyle without touching geometry. Each tile draws with its own
 * lightweight copies (same program) so its feature-state and rule textures can be bound (see patchFeatureState).
 * Wall and glass materials carry the phase-one procedural facade shader (windows, finishes, glass) on L0 and L1.
 */
export class MaterialLibrary {
  spec: ResolvedStyleSpec;
  pack: TileStylePack | null = null;
  /** Shared facade uniforms (src/facade-shader.js contract) and the tile-mode extras. */
  readonly facade = {
    windows: { value: 1 },
    provenance: { value: 0 },
    facadeDetail: { value: 0.5 },
    glassReflection: { value: 0.65 },
    toneSize: { value: 4.2 },
    sunDirection: { value: new Vector3(0.5, 0.707, -0.5) },
    projectionScale: { value: 1000 },
  };
  readonly extras = {
    uContactShadow: { value: 0.35 },
    uContactHeight: { value: 4.5 },
    uNightLights: { value: 0 },
    uNightColor: { value: new Color('#ffcf8a') },
  };
  private readonly copies = new Map<Material, Copy>();
  constructor(spec?: ResolvedStyleSpec) {
    this.spec = spec ?? builtinStyle('light')!;
  }

  /** Resolves a role ("road.marking" falls back to "road"). */
  resolve(role: string): RoleStyle {
    return roleStyle(this.spec, role);
  }

  /** A material for one tile or overlay, bound to its feature-state texture; release it with `release`. */
  acquire(role: string, state: FeatureStateTexture, mesh: Object3D | null = null): Material {
    const replace = { value: 0 };
    const m = this.create(role, mesh, replace);
    patchFeatureState(m, state.texture);
    this.patchReplace(m, replace);
    // Shadow depth pass with the same hidden/flatten state (the default depth material would ignore it).
    let depth: Material | null = null;
    if (mesh) {
      depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
      patchFeatureState(depth, state.texture);
      (mesh as Mesh).customDepthMaterial = depth;
    }
    this.copies.set(m, { role, mesh, state, replace, depth });
    if (!this.pack) this.apply(role, m as MeshStandardMaterial, replace);
    return m;
  }

  private create(role: string, mesh: Object3D | null, replace: { value: number }): Material {
    if (this.pack) {
      const defaults = Object.fromEntries(
        Object.entries(this.pack.parametersSchema?.properties ?? {}).map(([k, v]) => [k, v.default]),
      );
      const services = {
        createFacadeMaterial: () => this.facadeMaterial(),
        createFoliageMaterial: (source?: Material) =>
          new MeshStandardMaterial({ color: (source as MeshStandardMaterial)?.color ?? '#8fbf7a', roughness: 0.9 }),
      };
      return this.pack.createMaterial({
        object: mesh ?? new Mesh(),
        role: role === 'tree.crown' ? 'foliage' : role === 'tree.trunk' ? 'foliage' : role,
        semantic: { role },
        shared: this.facade,
        parameters: defaults,
        services,
      });
    }
    void replace;
    if (FACADE_ROLE.test(role)) return this.facadeMaterial();
    return new MeshStandardMaterial({ vertexColors: role !== 'tree.crown' && role !== 'tree.trunk' });
  }

  private facadeMaterial(): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.04 });
    const withDefaults = m as unknown as { defaultAttributeValues: Record<string, unknown> };
    withDefaults.defaultAttributeValues = { ...withDefaults.defaultAttributeValues, ...facadeAttributeDefaults };
    m.onBeforeCompile = (shader) => {
      installFacadeShader(shader, this.facade);
      extendFacadeShader(shader, this.extras);
    };
    m.customProgramCacheKey = () => 'city-tile-facade-v1';
    return m;
  }

  /** "replace" roles ignore generator vertex colours; "multiply" roles keep them tinted by the role colour. */
  private patchReplace(m: Material, replace: { value: number }) {
    const previous = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      previous.call(m, shader, renderer);
      shader.uniforms.cityReplaceColor = replace;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float cityReplaceColor;')
        .replace(
          '#include <color_fragment>',
          'vec3 cityRoleColor = diffuseColor.rgb;\n#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, cityRoleColor, cityReplaceColor);',
        );
    };
  }

  release(m: Material) {
    const copy = this.copies.get(m);
    if (!copy) return;
    this.copies.delete(m);
    copy.depth?.dispose();
    for (const key of (m.userData.cityOwnedTextures as string[] | undefined) ?? [])
      (m as unknown as Record<string, { dispose?(): void }>)[key]?.dispose?.();
    m.dispose();
  }

  get size(): number {
    return this.copies.size;
  }

  private apply(role: string, m: MeshStandardMaterial, replace: { value: number }) {
    const styleRole = role === 'tree.crown' ? 'foliage' : role === 'tree.trunk' ? 'foliage.trunk' : role;
    const s = this.resolve(styleRole);
    const multiply = s.inherit || s.blend === 'multiply';
    replace.value = multiply || role.startsWith('tree.') ? 0 : 1;
    m.color = new Color(s.inherit ? '#ffffff' : (s.color ?? '#ffffff'));
    const glassy = role.startsWith('glass');
    m.roughness = s.roughness ?? (role === 'water' ? 0.15 : glassy ? 0.76 : 0.9);
    m.metalness = s.metalness ?? (glassy ? 0.04 : 0.02);
    m.emissive = new Color(s.emissive ?? '#000000');
    m.emissiveIntensity = s.emissiveIntensity ?? 1;
    const opacity = s.opacity ?? 1;
    m.transparent = opacity < 1 || this.ruleOpacityRoles.has(role);
    m.opacity = opacity;
    m.flatShading = role === 'tree.crown';
    const ground = GROUND_ROLE.test(role);
    m.polygonOffset = ground;
    m.polygonOffsetFactor = ground ? -1 : 0;
    m.polygonOffsetUnits = ground ? -1 : 0;
    m.needsUpdate = true;
  }

  /** Material roles that some style rule makes translucent (they need blending). */
  ruleOpacityRoles = new Set<string>();

  /** Applies a new style. Spec→spec restyles in place; switching to or from a code pack replaces mesh materials. */
  restyle(spec: ResolvedStyleSpec, pack: TileStylePack | null = null) {
    const modeChanged = Boolean(pack) !== Boolean(this.pack) || (pack && pack !== this.pack);
    this.spec = spec;
    this.pack = pack;
    if (!modeChanged) {
      for (const [m, c] of this.copies) this.apply(c.role, m as MeshStandardMaterial, c.replace);
      return;
    }
    for (const [old, c] of [...this.copies]) {
      if (!c.mesh) {
        if (!pack) this.apply(c.role, old as MeshStandardMaterial, c.replace);
        continue;
      }
      const ruleState = (old.userData.featureStateUniforms as { ruleState: { value: unknown } }).ruleState.value;
      const next = this.acquire(c.role, c.state, c.mesh);
      (next.userData.featureStateUniforms as { ruleState: { value: unknown } }).ruleState.value = ruleState;
      (c.mesh as Mesh).material = next;
      this.release(old);
    }
  }

  /** Materials currently bound to a mesh (for rule textures). */
  entries(): IterableIterator<[Material, Copy]> {
    return this.copies.entries();
  }

  dispose() {
    for (const m of [...this.copies.keys()]) this.release(m);
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
    const mesh = new Mesh(geometry);
    const material = materials.acquire(batch.role, state, mesh);
    mesh.material = material;
    disposables.push({ dispose: () => materials.release(mesh.material as Material) });
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
    const crowns = new InstancedMesh(crownGeometry(), undefined, trees.count);
    const trunks = new InstancedMesh(trunkGeometry(), undefined, trees.count);
    crowns.material = materials.acquire('tree.crown', state, crowns);
    trunks.material = materials.acquire('tree.trunk', state, trunks);
    disposables.push({
      dispose: () => (materials.release(crowns.material as Material), materials.release(trunks.material as Material)),
    });
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
    trunks.castShadow = true;
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
