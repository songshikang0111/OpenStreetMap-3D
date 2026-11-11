// Building generation from planned `building` features. Envelope, roof and facade code is the phase-one
// implementation (src/building-envelope.js, src/roofs.js, src/building-mesh.js), so the tile path and the scene path
// share one building generator (WP-C, C1/C10).
import { planBuildingEnvelopes } from '../../../src/building-envelope.js';
import { writeBuildingBody } from '../../../src/building-mesh.js';
import { planRoof } from '../../../src/roofs.js';
import { area as ringArea } from '../../../src/osm.js';
import type { Phase1Building, Ring } from '../../../src/phase1-types.js';
import type { MeshWriter } from '../../../src/generators/mesh-tools.js';
import { featureIdAt, readProvenance, readFeatureMetaAt } from '@city-ink/tiles';
import type { FeatureLayer } from '@city-ink/tiles';
import { BatchSet } from './batch.js';
import { featureIdToPhase1Id } from './ids.js';

/** Phase-one buildings sit on a 0.45 m ground slab; phase-two ground is y = 0. */
export const PHASE1_GROUND_OFFSET = 0.45;

export interface BuildingOptions {
  seed?: number;
  inferRoofs?: boolean;
}

const SOURCE_BY_PROVENANCE = { observed: 'height', derived: 'levels', inferred: 'estimated' } as const;

function ringToMeters(layer: FeatureLayer, ring: number, step: number): Ring {
  const out: Ring = [];
  for (let v = layer.vertexStart[ring]!; v < layer.vertexStart[ring + 1]!; v++)
    out.push([layer.positions[v * 2]! * step, layer.positions[v * 2 + 1]! * step]);
  return out;
}

/** Rebuilds the phase-one building record (local metres of the tile) for feature i. */
export function phase1Building(layer: FeatureLayer, i: number, step: number): Phase1Building {
  const meta = readFeatureMetaAt(layer, i);
  const props = meta.properties ?? {};
  const tags = meta.tags ?? {};
  const firstPart = layer.partStart[i]!;
  const firstRing = layer.ringStart[firstPart]!;
  const lastRing = layer.ringStart[firstPart + 1]!;
  const outer = ringToMeters(layer, firstRing, step);
  const holes: Ring[] = [];
  for (let r = firstRing + 1; r < lastRing; r++) holes.push(ringToMeters(layer, r, step));
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const [x, z] of outer) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const id = featureIdToPhase1Id(meta.id);
  const provenance = readProvenance(layer, i);
  const footprint =
    typeof props.area === 'number' ? props.area : ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0);
  return {
    id,
    osmType: id.startsWith('r') ? 'relation' : 'way',
    osmId: Number(/\d+/.exec(id)?.[0] ?? 0),
    outer,
    holes,
    tags,
    center: [(x0 + x1) / 2, (z0 + z1) / 2],
    area: footprint,
    height: Number(props.height ?? 3),
    minHeight: Number(props.minHeight ?? 0),
    levels: Number(props.levels ?? 1),
    source: SOURCE_BY_PROVENANCE[provenance.height ?? 'inferred'],
    part: Boolean(tags['building:part'] && tags['building:part'] !== 'no'),
  };
}

function appendWriter(
  batches: BatchSet,
  writer: MeshWriter,
  renderId: number,
  roleOverride: string | null,
  layerName: string,
): number {
  let triangles = 0;
  for (const run of writer.materialRuns) {
    const role = roleOverride ?? run.role;
    batches.get(layerName, role).addWriterRun(writer, run.start, run.count, renderId, PHASE1_GROUND_OFFSET);
    triangles += run.count / 3;
  }
  return triangles;
}

export interface BuildingResult {
  buildings: number;
  triangles: number;
  /** Per-feature triangle counts and bounds in tile metres, for comparisons and statistics. */
  perFeature: Map<string, { triangles: number; bounds: [number, number, number, number, number, number] }>;
}

/**
 * Generates every building of a tile. `context` holds footprint proxies of neighbouring buildings owned by other
 * tiles; they shape shared walls and roofs but are not emitted.
 */
export function generateBuildings(
  layer: FeatureLayer,
  context: FeatureLayer | null,
  step: number,
  options: BuildingOptions,
  batches: BatchSet,
  layerName = 'building',
  collect = false,
): BuildingResult {
  const own: Phase1Building[] = [];
  for (let i = 0; i < layer.featureCount; i++) own.push(phase1Building(layer, i, step));
  const neighbours: Phase1Building[] = [];
  if (context) for (let i = 0; i < context.featureCount; i++) neighbours.push(phase1Building(context, i, step));
  const inferRoofs = options.inferRoofs ?? false;
  const all = [...own, ...neighbours];
  const roofPlans = new Map(all.map((b) => [b.id, planRoof(b, { inferRoofs })]));
  const envelopes = planBuildingEnvelopes(
    all.map((b) => {
      const roof = roofPlans.get(b.id)!;
      return roof.supported ? { ...b, height: roof.eave - PHASE1_GROUND_OFFSET } : b;
    }),
  );
  const result: BuildingResult = { buildings: own.length, triangles: 0, perFeature: new Map() };
  own.forEach((building, i) => {
    const renderId = layer.renderId[i]!;
    const before = collect ? batchBounds(batches, layerName) : null;
    const { writer, roofWriter } = writeBuildingBody(building, {
      renderId,
      seed: options.seed ?? 1,
      roofPlan: roofPlans.get(building.id)!,
      envelopePlan: envelopes.get(building.id)!,
    });
    let triangles = appendWriter(batches, writer, renderId, null, layerName);
    triangles += appendWriter(batches, roofWriter, renderId, 'facility', layerName);
    result.triangles += triangles;
    if (collect)
      result.perFeature.set(featureIdAt(layer, i), { triangles, bounds: writerBounds([writer, roofWriter], before) });
  });
  return result;
}

function batchBounds(_batches: BatchSet, _layer: string): null {
  return null;
}

function writerBounds(writers: MeshWriter[], _before: null): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const w of writers)
    for (let i = 0; i < w.positions.length; i += 3) {
      const x = w.positions[i]!,
        y = w.positions[i + 1]! - PHASE1_GROUND_OFFSET,
        z = w.positions[i + 2]!;
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x;
      if (y > b[4]) b[4] = y;
      if (z > b[5]) b[5] = z;
    }
  return b;
}
