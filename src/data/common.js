import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

export class CityError extends Error {
  constructor(code, stage, message, hint = 'Check the input and retry.', details = {}) {
    super(message); Object.assign(this, { code, stage, hint, ...details });
  }
}
export function diagnostic(error, stage = 'task') {
  return { code: error.code || 'TASK_FAILED', stage: error.stage || stage, message: error.message,
    hint: error.hint || 'Check the input and retry.', ...(error.featureId ? { featureId: error.featureId } : {}) };
}
export function checkAbort(signal) { signal?.throwIfAborted(); }
export function stableJSON(value) {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : stableJSON(value)).digest('hex');
export async function readJSON(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function atomicWrite(file, value, { signal } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    checkAbort(signal);
    await writeFile(temp, typeof value === 'string' || value instanceof Uint8Array ? value : stableJSON(value), { signal });
    checkAbort(signal); await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/') || value.split('/').some(s => s === '..' || !s))
    throw new CityError('PATH_ESCAPE', 'path', 'Expected a relative path within the project.', 'Use slash-separated project-relative paths.');
  return value;
}
export async function safePath(root, relative = '.', { allowMissing = false } = {}) {
  if (relative !== '.') relativeFile(relative);
  const base = await realpath(root), target = path.resolve(base, relative);
  let cursor = target;
  while (true) {
    try {
      const actual = await realpath(cursor), rel = path.relative(base, actual);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new CityError('PATH_ESCAPE', 'path', 'Path escapes the allowed root.', 'Choose a path inside the configured workspace.');
      // Reject links even when their current target is within the root.
      let part = base;
      for (const segment of path.relative(base, cursor).split(path.sep).filter(Boolean)) {
        part = path.join(part, segment);
        if ((await lstat(part)).isSymbolicLink()) throw new CityError('PATH_ESCAPE', 'path', 'Symbolic links are not allowed in project paths.');
      }
      return target;
    } catch (e) {
      if (e.code !== 'ENOENT' || !allowMissing) throw e;
      const parent = path.dirname(cursor); if (parent === cursor) throw e; cursor = parent;
    }
  }
}
export function validateArea(area, { maxSideMeters = 5000, maxAreaKm2 = 16 } = {}) {
  if (!area || !['south', 'west', 'north', 'east'].every(k => typeof area[k] === 'number' && Number.isFinite(area[k])) ||
      !(area.south >= -80 && area.south < area.north && area.north <= 80 && area.west >= -180 && area.west < area.east && area.east <= 180))
    throw new CityError('INVALID_AREA', 'area', 'Invalid named WGS84 bbox, polar area or dateline crossing.', 'Provide south < north and west < east between ±80° latitude.');
  const height = (area.north - area.south) * 111320;
  const width = (area.east - area.west) * 111320 * Math.cos((area.north + area.south) / 2 * Math.PI / 180);
  if (Math.max(height, width) > maxSideMeters || width * height > maxAreaKm2 * 1e6)
    throw new CityError('AREA_LIMIT', 'area', `Area exceeds ${maxSideMeters} m per side or ${maxAreaKm2} km².`, 'Use a small local area; regional PBF extraction is not supported yet.');
  return area;
}
export const bboxArray = a => [a.south, a.west, a.north, a.east];
export const centerOf = a => ({ lat: (a.south + a.north) / 2, lon: (a.west + a.east) / 2 });
