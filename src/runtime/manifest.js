import { Box3, Matrix4, Vector3 } from 'three';

export function runtimeError(code, stage, message, details = {}) {
  return Object.assign(new Error(message), { code, stage, ...details });
}

export function boundsBox(bounds) {
  let min, max;
  if (Array.isArray(bounds) && bounds.length === 6) { min = bounds.slice(0, 3); max = bounds.slice(3); }
  else if (Array.isArray(bounds) && bounds.length === 4) { min = [bounds[0], 0, bounds[1]]; max = [bounds[2], 500, bounds[3]]; }
  else { min = bounds?.min; max = bounds?.max; }
  if (!min || !max || min.length !== 3 || max.length !== 3 || ![...min, ...max].every(Number.isFinite) || min.some((n, i) => n > max[i])) {
    throw runtimeError('INVALID_BOUNDS', 'manifest', 'Expected finite world-space content bounds.');
  }
  return new Box3(new Vector3(...min), new Vector3(...max));
}

export function chunkMatrix(transform) {
  if (!transform) return new Matrix4();
  if (Array.isArray(transform) && transform.length === 16) return new Matrix4().fromArray(transform);
  if (transform.matrix?.length === 16) return new Matrix4().fromArray(transform.matrix);
  const p = transform.translation || transform.position || (Array.isArray(transform) && transform.length === 3 ? transform : null);
  if (!p || p.length !== 3 || !p.every(Number.isFinite)) throw runtimeError('INVALID_TRANSFORM', 'manifest', 'Chunk transform must be a matrix or translation.');
  return new Matrix4().makeTranslation(...p);
}

export function normalizeManifest(manifest, url) {
  if (manifest?.schemaVersion !== 1) throw runtimeError('UNSUPPORTED_SCENE_VERSION', 'manifest', `Unsupported scene schemaVersion ${manifest?.schemaVersion}.`, { url });
  if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) throw runtimeError('INVALID_MANIFEST', 'manifest', 'Manifest must contain nonempty chunks.', { url });
  const ids = new Set();
  const chunks = manifest.chunks.map(chunk => {
    if (typeof chunk.id !== 'string' || ids.has(chunk.id)) throw runtimeError('INVALID_CHUNK_ID', 'manifest', 'Chunk IDs must be unique strings.', { url });
    ids.add(chunk.id);
    const input = Array.isArray(chunk.lods) ? chunk.lods : Object.entries(chunk.lods || {}).map(([level, lod]) => ({ level, ...lod }));
    const rank = level => ({ near: 0, high: 0, medium: 1, mid: 1, far: 2, low: 2 })[level] ?? Number(level);
    const lods = input.map((lod, i) => {
      if (typeof lod.uri !== 'string' || !Number.isFinite(lod.bytes) || lod.bytes < 0 || !Number.isFinite(lod.triangles) || lod.triangles < 0) {
        throw runtimeError('INVALID_LOD', 'manifest', `Invalid LOD resource in ${chunk.id}.`, { tileId: chunk.id, url });
      }
      return { ...lod, level: lod.level ?? lod.id ?? i, rank: Number.isFinite(rank(lod.level ?? lod.id)) ? rank(lod.level ?? lod.id) : i, url: new URL(lod.uri, url).href };
    }).sort((a, b) => a.rank - b.rank);
    if (!lods.length) throw runtimeError('INVALID_LOD', 'manifest', `No LOD resources for ${chunk.id}.`);
    return { ...chunk, lods, box: boundsBox(chunk.contentBounds), matrix: chunkMatrix(chunk.transform) };
  });
  return { ...manifest, chunks, box: boundsBox(manifest.bounds) };
}

export async function fetchAsset(url, { signal, responseType }) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return responseType === 'json' ? response.json() : response.arrayBuffer();
}
