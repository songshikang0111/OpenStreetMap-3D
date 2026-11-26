// Builds Three.js objects for one generated tile. One mesh per material role batch (≤ 12 draw calls per L1 tile).
import {
  Box3,
  Sphere,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  Vector3,
} from 'three';
import type { DataTexture, Material, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { prepareUpload, type UploadData } from './upload-data.js';
import type { FeatureRecord } from './worker-core.js';
import { installFacadeShader, extendFacadeShader, facadeAttributeDefaults } from '@city-ink/styles/facade-shader';
import { roleStyle } from '@city-ink/styles/spec';
import type { ResolvedStyleSpec, RoleStyle } from '@city-ink/styles/spec';
import { builtinStyle } from '@city-ink/styles/defaults';
import type { GeneratedTile, MeshBatch } from '@city-ink/generators';
import { EMPTY_RULES, FeatureStateTexture, STATE_WIDTH, patchFeatureState } from './picking/feature-state.js';
import { ROLE_LIST, groupOf } from '@city-ink/generators';

export type { RoleStyle } from '@city-ink/styles/spec';

/** A code style pack usable in tile mode (05 section 8): materials per role plus optional streaming hooks. */
export interface TileStylePack {
  id: string;
  version?: string;
  supportsTiles: true;
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
  /** Facade materials keep the phase-one ink signal in alpha (packs with an ink post-processing pipeline). */
  inkAlpha?: boolean;
  createPipeline?(context: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    shared: Record<string, { value: unknown }>;
    parameters: Record<string, unknown>;
  }): TilePipeline;
  onTileLoad?(event: { tile: string; group: Group; features: readonly FeatureRecord[] }): void;
  onTileUnload?(event: { tile: string; group: Group }): void;
}

/** A pack's frame renderer (post-processing); replaces renderer.render for the whole frame. */
export interface TilePipeline {
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
  onTileLoad?(event: { tile: string; group: Group }): void;
  onTileUnload?(event: { tile: string; group: Group }): void;
}

const FACADE_ROLE = /^(wall|glass)(\.|$)/;
const GROUND_ROLE = /^(road|ground|water)/;
/** Material groups of generated batches (decision E15); `tree.*` materials stay per role. */
const GROUPS = new Set(['building', 'structure', 'ground', 'landmark', 'detail']);
const N_ROLES = ROLE_LIST.length;

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
    this.fillRoleTable();
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
    if (GROUPS.has(role)) this.patchRoles(m);
    else this.patchReplace(m, replace);
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

  /** Per-role style table shared by all group materials (uniform arrays indexed by the vertex roleIndex). */
  readonly roles = {
    cityRoleColor: { value: ROLE_LIST.map(() => new Color('#ffffff')) },
    cityRoleReplace: { value: new Float32Array(N_ROLES) },
    cityRoleRoughness: { value: new Float32Array(N_ROLES).fill(0.9) },
    cityRoleMetalness: { value: new Float32Array(N_ROLES).fill(0.02) },
    cityRoleOpacity: { value: new Float32Array(N_ROLES).fill(1) },
  };

  private fillRoleTable() {
    ROLE_LIST.forEach((role, i) => {
      const st = this.resolve(role);
      this.roles.cityRoleColor.value[i]!.set(st.inherit ? '#ffffff' : (st.color ?? '#ffffff'));
      this.roles.cityRoleReplace.value[i] = st.inherit || st.blend === 'multiply' ? 0 : 1;
      const glassy = role === 'glass';
      this.roles.cityRoleRoughness.value[i] = st.roughness ?? (role === 'water' ? 0.15 : glassy ? 0.76 : 0.9);
      this.roles.cityRoleMetalness.value[i] = st.metalness ?? (glassy ? 0.04 : 0.02);
      this.roles.cityRoleOpacity.value[i] = st.opacity ?? 1;
    });
  }

  /**
   * Group materials: the role of each vertex selects its colour (replace or multiply), roughness, metalness and
   * opacity from the shared table, and style-rule overrides apply only to the roles named by the rule (rule mask).
   */
  private patchRoles(m: Material) {
    const rule = { ruleColor: { value: EMPTY_RULES as DataTexture }, ruleMask: { value: EMPTY_RULES as DataTexture } };
    m.userData.cityRuleUniforms = rule;
    const previous = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      previous.call(m, shader, renderer);
      Object.assign(shader.uniforms, this.roles, rule);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float roleIndex;
uniform sampler2D ruleColor;
uniform sampler2D ruleMask;
varying float vCityRole;
varying vec4 vCityRule;
varying vec4 vCityRuleMask;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vCityRole = roleIndex;
  { int rid = int(renderId + 0.5); ivec2 cell = ivec2(rid % ${STATE_WIDTH}, rid / ${STATE_WIDTH});
    bool rules = textureSize(ruleColor, 0).x > 1;
    vCityRule = rules ? texelFetch(ruleColor, cell, 0) : vec4(0.0);
    vCityRuleMask = rules ? texelFetch(ruleMask, cell, 0) : vec4(0.0); }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
#define CITY_ROLES ${N_ROLES}
uniform vec3 cityRoleColor[CITY_ROLES];
uniform float cityRoleReplace[CITY_ROLES];
uniform float cityRoleRoughness[CITY_ROLES];
uniform float cityRoleMetalness[CITY_ROLES];
uniform float cityRoleOpacity[CITY_ROLES];
varying float vCityRole;
varying vec4 vCityRule;
varying vec4 vCityRuleMask;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  { int cr = int(vCityRole + 0.5);
    vec3 rc = cityRoleColor[cr];
    diffuseColor.rgb = mix(diffuseColor.rgb * rc, rc, cityRoleReplace[cr]);
    diffuseColor.a *= cityRoleOpacity[cr];
    int mask = int(vCityRuleMask.r * 255.0 + 0.5) + 256 * int(vCityRuleMask.g * 255.0 + 0.5);
    int rf = int(vCityRule.a * 255.0 + 0.5);
    if (rf > 0 && (mask / int(pow(2.0, float(cr)) + 0.5)) % 2 == 1) {
      if (rf >= 128) diffuseColor.rgb = vCityRule.rgb;
      diffuseColor.a *= float((rf % 128) - 1) / 126.0;
    } }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n  roughnessFactor = cityRoleRoughness[int(vCityRole + 0.5)];',
        )
        .replace(
          '#include <metalnessmap_fragment>',
          '#include <metalnessmap_fragment>\n  metalnessFactor = cityRoleMetalness[int(vCityRole + 0.5)];',
        );
    };
    const key = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => `${key()}|city-roles-v1`;
  }

  private create(role: string, mesh: Object3D | null, replace: { value: number }): Material {
    if (this.pack) {
      const defaults = Object.fromEntries(
        Object.entries(this.pack.parametersSchema?.properties ?? {}).map(([k, v]) => [k, v.default]),
      );
      const services = {
        createFacadeMaterial: () => this.facadeMaterial(Boolean(this.pack?.inkAlpha)),
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
    if (role === 'building' || FACADE_ROLE.test(role)) return this.facadeMaterial();
    return new MeshStandardMaterial({ vertexColors: role !== 'tree.crown' && role !== 'tree.trunk' });
  }

  /** Default parameter values of the current pack. */
  packParameters(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.pack?.parametersSchema?.properties ?? {}).map(([k, v]) => [k, v.default]),
    );
  }

  private facadeMaterial(inkAlpha = false): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.04 });
    const withDefaults = m as unknown as { defaultAttributeValues: Record<string, unknown> };
    withDefaults.defaultAttributeValues = { ...withDefaults.defaultAttributeValues, ...facadeAttributeDefaults };
    m.onBeforeCompile = (shader) => {
      installFacadeShader(shader, this.facade);
      if (!inkAlpha) extendFacadeShader(shader, this.extras);
    };
    m.customProgramCacheKey = () => (inkAlpha ? 'city-tile-facade-ink-v1' : 'city-tile-facade-v1');
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
    if (GROUPS.has(role)) {
      m.color = new Color('#ffffff');
      m.vertexColors = true;
      m.roughness = 0.9;
      m.metalness = 0.02;
      m.emissive = new Color('#000000');
      const groupRoles = ROLE_LIST.map((r, i) => [r, i] as const).filter(
        ([r]) => groupOf(r) === (role === 'detail' ? 'structure' : role),
      );
      m.transparent = groupRoles.some(
        ([r, i]) => this.roles.cityRoleOpacity.value[i]! < 1 || this.ruleOpacityRoles.has(r),
      );
      m.opacity = 1;
      const ground = role === 'ground';
      m.polygonOffset = ground;
      m.polygonOffsetFactor = ground ? -1 : 0;
      m.polygonOffsetUnits = ground ? -1 : 0;
      m.needsUpdate = true;
      return;
    }
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
    this.fillRoleTable();
    if (!modeChanged) {
      for (const [m, c] of this.copies) this.apply(c.role, m as MeshStandardMaterial, c.replace);
      return;
    }
    for (const [old, c] of [...this.copies]) {
      if (!c.mesh) {
        if (!pack) this.apply(c.role, old as MeshStandardMaterial, c.replace);
        continue;
      }
      const rules = old.userData.cityRuleUniforms as Record<string, { value: unknown }> | undefined;
      const next = this.acquire(c.role, c.state, c.mesh);
      const nextRules = next.userData.cityRuleUniforms as Record<string, { value: unknown }> | undefined;
      if (rules && nextRules) for (const k of Object.keys(rules)) nextRules[k]!.value = rules[k]!.value;
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

function geometryOf(batch: MeshBatch, ink: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(batch.position, 3));
  g.setAttribute('normal', new BufferAttribute(batch.normal, 3));
  g.setAttribute('color', new BufferAttribute(batch.color, 3));
  g.setAttribute('renderId', new BufferAttribute(batch.renderId, 1));
  g.setAttribute('roleIndex', new BufferAttribute(batch.roleIndex, 1));
  // Per-vertex phase-one ink class for the ink pipelines (one batch now holds several roles).
  g.setAttribute('inkClass', new BufferAttribute(ink, 1));
  if (batch.facade) {
    g.setAttribute('aFacade', new BufferAttribute(batch.facade.aFacade, 4));
    g.setAttribute('aStyle', new BufferAttribute(batch.facade.aStyle, 2));
    g.setAttribute('aLayout', new BufferAttribute(batch.facade.aLayout, 4));
    g.setAttribute('aSurface', new BufferAttribute(batch.facade.aSurface, 2));
  }
  g.setIndex(new BufferAttribute(batch.index, 1));
  // Bounds come from the worker; recomputing them here would cost milliseconds per tile on the main thread.
  const [x0, y0, z0, x1, y1, z1] = batch.bounds;
  g.boundingBox = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

/** Phase-one ink classes: 1 building, 2 tree, 3 road (3.2 walkway, 3.5 paint), 4 structure, 5 ground, 6 water. */
function inkClassOf(layer: string, role: string): number {
  if (layer === 'building' || layer === 'landmark') return 1;
  if (role === 'road.marking') return 3.5;
  if (role.startsWith('road')) return 3;
  if (role === 'ground.pavement' || role === 'ground.plaza') return 3.2;
  if (role === 'water') return 6;
  if (role.startsWith('ground')) return 5;
  return 4;
}

const crownGeometry = () => new IcosahedronGeometry(1, 1);
const trunkGeometry = () => new CylinderGeometry(0.12, 0.18, 1, 6, 1).translate(0, 0.5, 0);

let treeInstanceTriangles: number | undefined;

/** Same geometry arrays and instance matrices counted by TileObject.bytes, available before uploading. */
export function tileCost(
  generated: GeneratedTile,
  capacity: number,
  sourceBytes: number,
  hostGround?: ReadonlySet<string>,
) {
  let bytes = sourceBytes + Math.max(1, Math.ceil((capacity + 1) / STATE_WIDTH)) * STATE_WIDTH * 4;
  let triangles = 0,
    draws = 0;
  for (const b of generated.batches) {
    for (const a of [b.position, b.normal, b.color, b.renderId, b.roleIndex, b.index]) bytes += a.byteLength;
    if (b.facade) for (const a of Object.values(b.facade)) bytes += a.byteLength;
    bytes += b.vertexCount * Float32Array.BYTES_PER_ELEMENT; // ink class
    if (b.layer !== 'structure' && !hostGround?.has(b.layer)) {
      triangles += b.index.length / 3;
      draws++;
    }
  }
  const trees = generated.trees;
  if (trees.count) {
    if (treeInstanceTriangles === undefined) {
      treeInstanceTriangles = 0;
      for (const g of [crownGeometry(), trunkGeometry()]) {
        treeInstanceTriangles += (g.index?.count ?? g.attributes.position!.count) / 3;
        g.dispose();
      }
    }
    triangles += trees.count * treeInstanceTriangles;
    draws += 2;
    bytes += trees.count * 16 * 4 * 2 + trees.data.byteLength;
  }
  return { bytes, triangles, draws };
}

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

export function* prepareTileObject(
  generated: GeneratedTile,
  materials: MaterialLibrary,
  capacity?: number,
  upload: UploadData = prepareUpload(generated),
): Generator<BufferGeometry, TileObject | undefined, void> {
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
  let completed = false;
  const dispose = () => {
    for (const d of disposables) d.dispose();
    state.dispose();
    group.clear();
  };
  try {
    for (const [index, batch] of generated.batches.entries()) {
      const geometry = geometryOf(batch, upload.ink[index]!);
      disposables.push(geometry);
      const mesh = new Mesh(geometry);
      mesh.name = `${batch.layer}:${batch.role}`;
      // Semantics read by code style packs and the ink pipeline (phase-one conventions).
      if (batch.layer === 'building') {
        mesh.userData.city = { shader: 'facade-v6' };
        mesh.userData.generatedFacade = true;
      }
      mesh.userData.inkClass = inkClassOf(batch.layer, batch.role);
      mesh.userData.perVertexInkClass = true;
      const material = materials.acquire(batch.role, state, mesh);
      mesh.material = material;
      disposables.push({ dispose: () => materials.release(mesh.material as Material) });
      mesh.name = `${batch.layer}:${batch.role}`;
      mesh.userData.layer = batch.layer;
      mesh.userData.role = batch.role;
      mesh.matrixAutoUpdate = false;
      // Trims, roof plant and parapets add little to shadows and a lot to the depth pass.
      mesh.castShadow = batch.layer === 'building' || batch.layer === 'landmark';
      mesh.receiveShadow = true;
      group.add(mesh);
      meshes.push(mesh);
      pickable.push(mesh);
      for (const a of Object.values(geometry.attributes))
        bytes += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
      if (geometry.index) bytes += (geometry.index.array as Uint32Array).byteLength;
      triangles += batch.index.length / 3;
      yield geometry;
    }
    const trees = generated.trees;
    if (trees.count) {
      const crowns = new InstancedMesh(crownGeometry(), undefined, 0);
      crowns.name = 'tree crowns';
      crowns.userData.inkClass = 2;
      crowns.userData.city = { shader: 'foliage-v1' };
      const trunks = new InstancedMesh(trunkGeometry(), undefined, 0);
      crowns.material = materials.acquire('tree.crown', state, crowns);
      trunks.material = materials.acquire('tree.trunk', state, trunks);
      disposables.push({
        dispose: () => (materials.release(crowns.material as Material), materials.release(trunks.material as Material)),
      });
      crowns.count = trunks.count = trees.count;
      crowns.instanceMatrix = new InstancedBufferAttribute(upload.crowns, 16);
      trunks.instanceMatrix = new InstancedBufferAttribute(upload.trunks, 16);
      const [x0, y0, z0, x1, y1, z1] = upload.bounds;
      const bounds = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
      crowns.boundingSphere = bounds.getBoundingSphere(new Sphere());
      trunks.boundingSphere = crowns.boundingSphere.clone();
      crowns.userData.layer = trunks.userData.layer = 'tree';
      crowns.userData.renderIds = trees.renderId;
      crowns.castShadow = true;
      trunks.castShadow = true;
      const instanceIds = new InstancedBufferAttribute(trees.renderId, 1);
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
    completed = true;
    return {
      group,
      bytes,
      triangles,
      drawCalls: meshes.length + (trees.count ? 2 : 0),
      meshes,
      state,
      pickable,
      dispose,
    };
  } finally {
    if (!completed) dispose();
  }
}

export type { Material };
