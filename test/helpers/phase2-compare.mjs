// AC306 helper: per-building bounds and triangle counts from the phase-one direct path and from tiles.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOSM } from '../../src/osm.js';
import { normalizeRaw } from '../../src/core/contract.js';
import { planRoof } from '../../src/roofs.js';
import { planBuildingEnvelopes } from '../../src/building-envelope.js';
import { writeBuildingBody } from '../../src/building-mesh.js';
import { decodeTile, gridStepMeters, tileMetersToLngLat, featureIdAt } from '../../packages/tiles/dist/index.js';
import { BatchSet, generateBuildings, phase1IdToFeatureId } from '../../packages/generators/dist/index.js';

const OFFSET = 0.45;

function boundsOf(writers) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const w of writers) {
    triangles += w.positions.length / 9;
    for (let i = 0; i < w.positions.length; i += 3) {
      const p = [w.positions[i], w.positions[i + 1] - OFFSET, w.positions[i + 2]];
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], p[k]);
        b[k + 3] = Math.max(b[k + 3], p[k]);
      }
    }
  }
  return { bounds: b, triangles };
}

/** Phase-one direct generation, exactly as buildCity does it (all buildings, envelope over the whole area). */
export async function phase1Buildings(inputFile, bbox) {
  const raw = JSON.parse(await readFile(inputFile, 'utf8'));
  const [south, west, north, east] = bbox ? [bbox[1], bbox[0], bbox[3], bbox[2]] : raw.metadata.bbox;
  const origin = bbox
    ? { lat: (south + north) / 2, lon: (west + east) / 2 }
    : { lat: raw.metadata.center[0], lon: raw.metadata.center[1] };
  const data = parseOSM(normalizeRaw(raw, { area: { south, west, north, east }, origin }), 1);
  const roofPlans = new Map(data.buildings.map((b) => [b.id, planRoof(b, { inferRoofs: false })]));
  const envelopes = planBuildingEnvelopes(
    data.buildings.map((b) =>
      roofPlans.get(b.id).supported ? { ...b, height: roofPlans.get(b.id).eave - OFFSET } : b,
    ),
  );
  const out = new Map();
  data.buildings.forEach((b, i) => {
    const { writer, roofWriter } = writeBuildingBody(b, {
      renderId: i + 1,
      seed: 1,
      roofPlan: roofPlans.get(b.id),
      envelopePlan: envelopes.get(b.id),
    });
    out.set(phase1IdToFeatureId(b.id), boundsOf([writer, roofWriter]));
  });
  return { data, buildings: out };
}

/** Tile path: per-building bounds converted into the phase-one project frame. */
export async function tileBuildings(dir, report, project) {
  const out = new Map();
  for (const key of Object.keys(report.hashes).filter((k) => k.startsWith('16/'))) {
    const tile = decodeTile(await readFile(path.join(dir, key)));
    const layer = tile.layers.building;
    if (!layer) continue;
    const step = gridStepMeters(tile.id, tile.extentLog2);
    const context = tile.layers.buildingContext ?? null;
    const result = generateBuildings(layer, context, step, { seed: 1 }, new BatchSet(), 'building', true);
    for (let i = 0; i < layer.featureCount; i++) {
      const id = featureIdAt(layer, i);
      const f = result.perFeature.get(id);
      const [x0, , z0, x1, , z1] = f.bounds;
      const corners = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ].map(([x, z]) => {
        const [lng, lat] = tileMetersToLngLat(tile.id, x, z);
        return project.point({ lat, lon: lng });
      });
      const xs = corners.map((c) => c[0]),
        zs = corners.map((c) => c[1]);
      out.set(id, {
        bounds: [Math.min(...xs), f.bounds[1], Math.min(...zs), Math.max(...xs), f.bounds[4], Math.max(...zs)],
        triangles: f.triangles,
      });
    }
  }
  return out;
}

export function compareBuildings(direct, tiles) {
  const rows = [];
  for (const [id, a] of direct) {
    const b = tiles.get(id);
    if (!b) {
      rows.push({ id, missing: true });
      continue;
    }
    const dBounds = Math.max(...a.bounds.map((v, k) => Math.abs(v - b.bounds[k])));
    const dTriangles = Math.abs(a.triangles - b.triangles) / Math.max(1, a.triangles);
    rows.push({ id, dBounds, dTriangles, triangles: [a.triangles, b.triangles] });
  }
  return rows;
}
