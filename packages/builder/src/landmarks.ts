// Landmarks (WP-C task C5): official recipes claim buildings and generate trusted geometry, baked into the `landmark`
// mesh layer of the tile that owns the group (03 section 5). Claimed buildings leave the building layer and the
// envelope planning, exactly as in the phase-one scene path.
import { createLandmarkRegistry } from '../../../src/landmark-registry.js';
import type { Phase1Data } from '../../../src/phase1-types.js';
import { phase1IdToFeatureId } from '@city-ink/generators';
import type { LngLat } from '@city-ink/tiles';
import { toLngLat } from './geo.js';

/** Baked landmark mesh in project-local metres (x east, y up above the phase-two ground, z south). */
export interface LandmarkBake {
  recipeId: string;
  recipeVersion: string;
  featureIds: string[];
  /** Per mesh: interleaved positions, normals, colours, triangle indices and the claimed feature it belongs to. */
  meshes: { position: number[]; normal: number[]; color: number[]; index: number[]; featureIndex: number }[];
}

export interface LandmarkPlan {
  claimed: Set<string>;
  bakes: { anchor: LngLat; bake: LandmarkBake }[];
  diagnostics: { code: string; stage: string; message: string }[];
}

const GROUND = 0.45;
const round = (v: number) => Math.round(v * 1e4) / 1e4;

export async function planLandmarks(data: Phase1Data, seed: number): Promise<LandmarkPlan> {
  const registry = createLandmarkRegistry();
  const context = {
    origin: {
      lat: (data.metadata.center as number[] | undefined)?.[0] ?? 0,
      lon: (data.metadata.center as number[] | undefined)?.[1] ?? 0,
    },
    bounds: data.bounds,
    seed,
    policy: 'degraded' as const,
    features: data.buildings,
    objectIds: new Map(data.buildings.map((b, i) => [b.id, i + 1])),
  };
  const plan: LandmarkPlan = { claimed: new Set(), bakes: [], diagnostics: [] };
  const matches = registry
    .match(data.buildings, context)
    .sort((a, b) => (`${a.recipeId}:${a.claimedFeatureIds}` < `${b.recipeId}:${b.claimedFeatureIds}` ? -1 : 1));
  for (const match of matches) {
    const ids = [...match.claimedFeatureIds].sort();
    if (ids.some((id) => plan.claimed.has(id))) continue;
    try {
      const result = await registry.generate(match, context);
      const group = result.group;
      group.updateMatrixWorld(true);
      const meshes: LandmarkBake['meshes'] = [];
      group.traverseVisible((o: any) => {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return;
        const g = o.geometry.index ? o.geometry : o.geometry;
        const pos = g.attributes.position;
        const nor = g.attributes.normal;
        const col = g.attributes.color;
        const m = o.matrixWorld.elements as number[];
        const position: number[] = [];
        const normal: number[] = [];
        const color: number[] = [];
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i),
            y = pos.getY(i),
            z = pos.getZ(i);
          position.push(
            round(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!),
            round(m[1]! * x + m[5]! * y + m[9]! * z + m[13]! - GROUND),
            round(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!),
          );
          if (nor) {
            const nx = nor.getX(i),
              ny = nor.getY(i),
              nz = nor.getZ(i);
            const tx = m[0]! * nx + m[4]! * ny + m[8]! * nz,
              ty = m[1]! * nx + m[5]! * ny + m[9]! * nz,
              tz = m[2]! * nx + m[6]! * ny + m[10]! * nz;
            const l = Math.hypot(tx, ty, tz) || 1;
            normal.push(round(tx / l), round(ty / l), round(tz / l));
          } else normal.push(0, 1, 0);
          if (col) color.push(round(col.getX(i)), round(col.getY(i)), round(col.getZ(i)));
          else color.push(0.86, 0.85, 0.82);
        }
        const index: number[] = g.index
          ? Array.from(g.index.array as ArrayLike<number>)
          : Array.from({ length: pos.count }, (_, i) => i);
        const owner = o.userData?.city?.featureId;
        const featureIndex = Math.max(0, ids.indexOf(owner));
        meshes.push({ position, normal, color, index, featureIndex });
      });
      if (!meshes.length) throw new Error('Generator returned no renderable geometry.');
      for (const id of ids) plan.claimed.add(id);
      const first = data.buildings.find((b) => b.id === ids[0])!;
      plan.bakes.push({
        anchor: toLngLat(data.project, first.center),
        bake: {
          recipeId: match.recipeId,
          recipeVersion: match.recipeVersion,
          featureIds: ids.map(phase1IdToFeatureId),
          meshes,
        },
      });
    } catch (error) {
      plan.diagnostics.push({
        code: 'LANDMARK_FALLBACK',
        stage: 'plan',
        message: `${match.recipeId}: ${(error as Error).message}; the source buildings stay ordinary buildings.`,
      });
    }
  }
  return plan;
}
