import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeTile, decodeTile } from '../packages/tiles/dist/index.js';
import { phase1Building } from '../packages/generators/dist/index.js';
import { buildingWallLengths } from '../packages/builder/dist/building-wall-lengths.js';
import { planBuildingEnvelopes } from '../src/building-envelope.js';
import { writeBuildingBody } from '../src/building-mesh.js';
import { planRoof } from '../src/roofs.js';

test('a quantized entrance tie retains the source facade and legacy tiles use the decoded outline', () => {
  // Before snapping the north-south wall wins by 10.4 cm. After snapping the east-west wall wins the 10 cm tie.
  const source = [
    [0, 0],
    [12.001, 0],
    [12.001, 12.105],
    [0, 12.105],
  ];
  const flat = [0, 0, 1201, 0, 1201, 1209, 0, 1209];
  const local = { point: ({ lat, lon }) => [lon, lat] };
  const hints = buildingWallLengths([source], [flat], 0.01, local, 15, 0);
  assert.ok(hints);
  const quantized = source.map((_, i) => [flat[2 * i] * 0.01, flat[2 * i + 1] * 0.01]);
  assert.equal(buildingWallLengths([quantized], [flat], 0.01, local, 15, 0), null);
  const feature = (metric) => {
    const properties = { height: 15, minHeight: 0, levels: 5, area: 145, ...(metric ? { wallLengths: metric } : {}) };
    const bytes = encodeTile({
      id: { z: 16, x: 1, y: 1 },
      profile: 'full',
      layers: {
        building: {
          type: 'features',
          geometry: 'polygon',
          features: [{ id: 'way/7', renderId: 1, geometry: [[flat]], properties }],
        },
      },
    });
    return phase1Building(decodeTile(bytes).layers.building, 0, 0.01);
  };
  const bounds = (building) => {
    const { writer } = writeBuildingBody(building, {
      renderId: 1,
      roofPlan: planRoof(building),
      envelopePlan: planBuildingEnvelopes([building]).get(building.id),
    });
    const xs = writer.positions.filter((_, i) => i % 3 === 0),
      zs = writer.positions.filter((_, i) => i % 3 === 2);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  };
  const legacy = feature(null),
    expected = bounds({ ...legacy, outer: source });
  const distance = (record) => Math.max(...bounds(record).map((v, i) => Math.abs(v - expected[i])));
  assert.ok(distance(legacy) > 1);
  assert.ok(distance(feature(hints)) < 0.02);
  assert.deepEqual(bounds(feature('malformed')), bounds(legacy));
});
