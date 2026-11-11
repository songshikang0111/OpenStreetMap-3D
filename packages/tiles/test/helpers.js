// Deterministic random tile generator shared by the tiles tests.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const ROLES = ['wall', 'roof', 'glass', 'landmark', 'structure'];
const PROV = ['observed', 'derived', 'inferred'];

export function randomFeatureLayer(r, geometry, count, { elevation = false } = {}) {
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const features = [];
  for (let i = 0; i < count; i++) {
    const parts = geometry === 'point' ? 1 : int(1, 3);
    const geom = [];
    const elev = [];
    for (let p = 0; p < parts; p++) {
      const rings = geometry === 'polygon' ? int(1, 3) : 1;
      const rs = [];
      const es = [];
      for (let k = 0; k < rings; k++) {
        const n = geometry === 'point' ? 1 : geometry === 'line' ? int(2, 12) : int(3, 20);
        const ring = [];
        const e = [];
        for (let v = 0; v < n; v++) {
          ring.push(int(-32768, 32767), int(-32768, 32767));
          e.push(Math.round((r() * 300 - 20) * 16) / 16);
        }
        rs.push(ring);
        es.push(e);
      }
      geom.push(rs);
      elev.push(es);
    }
    const id = `${['node', 'way', 'relation', 'generated'][int(0, 3)]}/${int(1, 2 ** 40)}${r() < 0.2 ? `#${int(0, 50)}` : ''}`;
    const f = {
      id,
      renderId: i,
      geometry: geom,
      properties: {
        height: r() < 0.1 ? null : Math.fround(r() * 300),
        kind: r() < 0.2 ? null : ['a', 'b', 'café', '高楼'][int(0, 3)],
        lanes: r() < 0.3 ? null : int(0, 8),
        layer: r() < 0.3 ? null : int(-5, 5),
      },
      provenance: r() < 0.5 ? { height: PROV[int(0, 2)], kind: PROV[int(0, 2)] } : {},
      tags: r() < 0.5 ? { name: `n${int(0, 99)}`, building: 'yes' } : {},
    };
    if (elevation) f.elevation = elev;
    features.push(f);
  }
  return {
    type: 'features',
    geometry,
    elevation,
    attributes: [
      { name: 'height', type: 'f32' },
      { name: 'kind', type: 'string' },
      { name: 'lanes', type: 'u32' },
      { name: 'layer', type: 'i32' },
    ],
    provenanceKeys: ['height', 'kind'],
    features,
  };
}

export function randomMeshLayer(r, vertexCount = 30, featureCount = 3, span = 400) {
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const position = [];
  const normal = [];
  const vertexFeature = [];
  const shade = [];
  for (let v = 0; v < vertexCount; v++) {
    position.push((r() - 0.5) * span, r() * 200, (r() - 0.5) * span);
    const n = [r() - 0.5, r() - 0.5, r() - 0.5];
    const l = Math.hypot(...n) || 1;
    normal.push(n[0] / l, n[1] / l, n[2] / l);
    vertexFeature.push(int(0, featureCount - 1));
    shade.push(Math.fround(r()), Math.fround(r()));
  }
  const index = [];
  for (let t = 0; t < vertexCount; t++)
    index.push(int(0, vertexCount - 1), int(0, vertexCount - 1), int(0, vertexCount - 1));
  const features = [];
  for (let i = 0; i < featureCount; i++)
    features.push({ id: `way/${int(1, 1e9)}`, renderId: 1000 + i, properties: { name: `L${i}` }, tags: {} });
  return {
    type: 'mesh',
    position,
    normal,
    index,
    vertexFeature,
    submeshes: [
      { materialRole: ROLES[int(0, 4)], featureIndex: 0, indexStart: 0, indexCount: 3 * Math.floor(vertexCount / 2) },
      {
        materialRole: ROLES[int(0, 4)],
        featureIndex: featureCount - 1,
        indexStart: 3 * Math.floor(vertexCount / 2),
        indexCount: index.length - 3 * Math.floor(vertexCount / 2),
      },
    ],
    vertexAttributes: { facadeShade: { itemSize: 2, array: shade } },
    attributes: [{ name: 'name', type: 'string' }],
    features,
  };
}
