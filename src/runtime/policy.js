import { Frustum, Matrix4, Sphere, Vector3 } from 'three';
import { drawUnitCost } from './render-cost.js';

export const DEFAULT_BUDGET = Object.freeze({
  residentBytes: 128 * 1024 * 1024, visibleTriangles: 600000, drawCalls: 1200,
  concurrentLoads: 3, pixelRatio: 1.5, nearDetails: 18000, shadowQuality: 1, aoQuality: 1,
  hysteresis: .18, minResidenceMs: 750, unloadDelayMs: 1200, prefetchMargin: .15,
});
export function createBudget(input = {}) {
  const budget = { ...DEFAULT_BUDGET, ...input };
  for (const [key, value] of Object.entries(budget)) if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid budget.${key}`);
  if (budget.concurrentLoads < 1 || budget.pixelRatio <= 0 || budget.hysteresis >= 1) throw new TypeError('Invalid load, pixel ratio or hysteresis budget.');
  budget.concurrentLoads = Math.floor(budget.concurrentLoads);
  return budget;
}

export function projectChunks(chunks, camera, height, margin = 0, context, unitCache) {
  camera.updateMatrixWorld(true);
  const projection = camera.projectionMatrix.clone();
  projection.elements[0] /= 1 + margin; projection.elements[5] /= 1 + margin;
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(projection, camera.matrixWorldInverse));
  const center = new Vector3(), size = new Vector3();
  const scale = height * camera.projectionMatrix.elements[5] * .5;
  return chunks.map(chunk => {
    chunk.box.getCenter(center); chunk.box.getSize(size);
    const distance = Math.max(.1, chunk.box.distanceToPoint(camera.position));
    const depth = Math.max(.1, -center.clone().applyMatrix4(camera.matrixWorldInverse).z);
    const visible = frustum.intersectsBox(chunk.box);
    const costs = visible ? chunk.lods.map(lod => {
      const units = unitCache?.get(`${chunk.id}:${lod.url}`) || lod.drawUnits;
      if (context) return drawUnitCost(units || [{ sphere: chunk.box.getBoundingSphere(new Sphere()), triangles: lod.triangles, drawCalls: lod.drawCalls ?? 1 }], context);
      return units ? units.reduce((sum, unit) => { if (frustum.intersectsSphere(unit.sphere)) { sum.triangles += unit.triangles; sum.drawCalls += unit.drawCalls; } return sum; }, { triangles: 0, drawCalls: 0 }) : { triangles: lod.triangles, drawCalls: lod.drawCalls ?? 1 };
    }) : [];
    return { chunk, visible, pixels: size.length() * scale / Math.max(distance, depth), distance, scale, costs };
  });
}

export function chooseLod(projected, state, budget, now) {
  const { chunk, pixels, scale, distance } = projected;
  let index = chunk.lods.length - 1;
  // Default thresholds are CSS px. Explicit geometric error is in metres.
  for (let i = 0; i < chunk.lods.length - 1; i++) {
    const lod = chunk.lods[i], threshold = lod.minScreenPixels ?? lod.selection?.minScreenPixels ?? (i === 0 ? 900 : 220);
    const current = state?.index ?? chunk.lods.length - 1;
    const factor = i < current ? 1 + budget.hysteresis : 1 - budget.hysteresis;
    const next = chunk.lods[i + 1];
    const error = next.selection?.geometricErrorMeters ?? next.geometricError ?? next.errorMeters;
    const maxError = next.selection?.maxScreenSpaceError ?? next.maxScreenError;
    const wantsDetail = Number.isFinite(error) && Number.isFinite(maxError)
      ? error * scale / Math.max(distance, .1) > maxError * factor
      : pixels > threshold * factor;
    if (wantsDetail) { index = i; break; }
  }
  if (state && now - state.since < budget.minResidenceMs) return state.index;
  return index;
}

export function budgetPlan(projected, states, budget, now, passMultiplier = 1) {
  const profile = typeof passMultiplier === 'object' ? passMultiplier : null;
  const multiplier = profile ? 1 : passMultiplier;
  const requests = projected.filter(p => p.visible).map(p => ({ ...p, index: chooseLod(p, states.get(p.chunk.id), budget, now) }));
  const total = () => requests.reduce((sum, p) => {
    const lod = p.chunk.lods[p.index];
    const cost = p.costs?.[p.index];
    sum.bytes += p.residentCosts?.[p.index] ?? lod.residentBytes ?? lod.bytes; sum.triangles += cost?.frameTriangles ?? (cost?.triangles ?? lod.triangles) * multiplier;
    sum.calls += cost?.frameCalls ?? (cost?.drawCalls ?? lod.drawCalls ?? 1) * multiplier; sum.details += lod.nearDetails ?? 0;
    return sum;
  }, { bytes: 0, triangles: profile?.fixedTriangles || 0, calls: profile?.fixedCalls || 0, details: 0 });
  const over = s => s.bytes > budget.residentBytes || s.triangles > budget.visibleTriangles || s.calls > budget.drawCalls || s.details > budget.nearDetails;
  let totals = total(), degraded = false;
  // First remove expensive near accessories, then simplify the least prominent
  // chunks. Every visible chunk retains at least its coarsest representation.
  while (over(totals)) {
    const candidates = requests.filter(p => p.index < p.chunk.lods.length - 1)
      .sort((a, b) => (a.index === 0 ? -1 : 1) - (b.index === 0 ? -1 : 1) || a.pixels - b.pixels);
    if (!candidates.length) break;
    candidates[0].index++; degraded = true; totals = total();
  }
  // Budget admission has the same dead band as screen-error selection. A
  // previously downgraded target cannot re-enter at the exact budget boundary.
  for (const p of requests) {
    const state = states.get(p.chunk.id);
    if (!state || p.index >= state.index) continue;
    if (totals.triangles > budget.visibleTriangles * (1 - budget.hysteresis) || totals.calls > budget.drawCalls * (1 - budget.hysteresis)) {
      p.index = state.index; totals = total();
    }
  }
  return { requests: requests.sort((a, b) => b.pixels - a.pixels), totals, degraded, unavoidable: over(totals) };
}
