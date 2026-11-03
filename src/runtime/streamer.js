import { Group } from 'three';
import { budgetPlan, projectChunks } from './policy.js';
import { measureGroup, ResourceRegistry } from './resources.js';
import { runtimeError } from './manifest.js';
import { collectDrawUnits, drawUnitCost } from './render-cost.js';

export class ChunkStreamer {
  constructor({ manifest, readAsset, decodeChunk, budget, bindGroup = () => null, prepareGroup, releaseGroup = () => {}, onDiagnostic = () => {}, onProgress = () => {}, now = () => performance.now() }) {
    Object.assign(this, { manifest, readAsset, decodeChunk, budget, bindGroup, prepareGroup, releaseGroup, onDiagnostic, onProgress, now });
    this.group = new Group(); this.group.name = 'City Ink streamed chunks';
    this.registry = new ResourceRegistry(); this.current = new Map(); this.pending = new Map(); this.desired = new Map();
    this.failures = new Map(); this.ready = []; this.disposed = false; this.epoch = 0; this.states = new Map();
    this.unitCache = new Map(); this.residentCache = new Map(); this.standby = new Map();
    this.counters = { loads: 0, unloads: 0, cancelled: 0, failures: 0, fetchedBytes: 0, swaps: 0, peakConcurrentLoads: 0, peakEstimatedResidentBytes: 0 };
    this.firstUsableMs = null; this.started = now(); this.warned = new Set(); this.passMultiplier = 1;
  }
  diagnostic(code, message, details = {}) {
    const key = `${code}:${details.tileId || ''}`;
    if (this.warned.has(key)) return;
    this.warned.add(key); this.onDiagnostic({ code, stage: 'runtime', message, ...details });
  }
  update(camera, height, time = this.now(), { forceLod, renderContext } = {}) {
    if (this.disposed) return;
    this.hasScheduled = true;
    this.renderContext = renderContext;
    const projected = projectChunks(this.manifest.chunks, camera, height, this.budget.prefetchMargin, renderContext, this.unitCache);
    for (const item of projected) {
      const resident = this.current.get(item.chunk.id);
      const coarse = this.standby.get(item.chunk.id) || (renderContext && resident?.index === item.chunk.lods.length - 1 ? resident : null);
      item.residentCosts = item.chunk.lods.map((lod, index) => (resident?.index === index ? resident.estimatedBytes : this.residentCache.get(`${item.chunk.id}:${lod.url}`) ?? Math.ceil((lod.residentBytes ?? lod.bytes) * 1.1)) + (coarse && coarse.index !== index ? coarse.estimatedBytes : 0));
    }
    const plan = budgetPlan(projected, this.states, this.budget, time, renderContext || this.passMultiplier);
    if (forceLod != null) for (const p of plan.requests) p.index = Math.min(p.chunk.lods.length - 1, forceLod);
    this.desired = new Map(plan.requests.map(p => [p.chunk.id, p])); this.plan = plan;
    for (const p of plan.requests) if (this.states.get(p.chunk.id)?.index !== p.index) this.states.set(p.chunk.id, { index: p.index, since: time });
    if (plan.degraded) this.diagnostic('LOD_BUDGET_DOWNGRADE', 'Detail was reduced to preserve coverage within the configured resource budget.');
    if (plan.unavoidable) this.diagnostic('COVERAGE_EXCEEDS_BUDGET', 'Even the coarsest visible coverage exceeds budget. Increase budget or build a smaller supported area.', { totals: plan.totals });
    for (const [id, entry] of this.current) {
      const desired = this.desired.get(id);
      entry.group.visible = !!desired;
      entry.frameMetrics = desired?.costs?.[entry.index];
      if (desired) entry.lastVisible = time;
      else if (time - entry.lastVisible >= this.budget.unloadDelayMs) this.evict(id);
    }
    for (const desired of this.desired.values()) {
      const coarse = this.standby.get(desired.chunk.id);
      if (coarse?.index !== desired.index) continue;
      this.standby.delete(desired.chunk.id);
      const previous = this.current.get(desired.chunk.id); if (previous) this.release(previous);
      coarse.group.visible = true; coarse.lastVisible = time; coarse.frameMetrics = desired.costs?.[coarse.index];
      this.group.add(coarse.group); this.current.set(desired.chunk.id, coarse); this.counters.swaps++;
    }
    for (const [key, task] of this.pending) {
      const desired = this.desired.get(task.chunk.id);
      if (!desired || (task.index !== desired.index && task.index !== task.chunk.lods.length - 1)) this.cancel(key);
    }
    // Evict offscreen cache immediately when it competes with visible coverage.
    if (this.estimatedBytes() > this.budget.residentBytes * .8) {
      for (const [id] of this.current) if (!this.desired.has(id)) this.evict(id);
    }
    this.mountReady(time);
    // Keep a counted coarse representation so sudden camera changes can retain
    // complete coverage while an asynchronous replacement is being decoded.
    if (renderContext && forceLod == null) this.enforceFrameBudget(time);
    this.pump();
    this.counters.peakEstimatedResidentBytes = Math.max(this.counters.peakEstimatedResidentBytes, this.estimatedBytes());
    this.onProgress({ stage: 'stream', loaded: this.current.size, visible: this.desired.size, pending: this.pending.size, complete: this.isSettled() });
  }
  pump() {
    if (this.disposed) return;
    for (const desired of this.desired.values()) {
      if (this.pending.size >= this.budget.concurrentLoads) break;
      const { chunk } = desired, current = this.current.get(chunk.id);
      const index = current ? desired.index : chunk.lods.length - 1;
      if (current?.index === index || [...this.pending.values()].some(p => p.chunk.id === chunk.id)) continue;
      const key = `${chunk.id}:${index}`, failure = this.failures.get(key);
      if (failure && (failure.attempts >= 2 || this.now() < failure.retryAt)) continue;
      const bytes = chunk.lods[index].residentBytes ?? chunk.lods[index].bytes;
      // Replacements retain the old representation until the new one is ready.
      // Reserve headroom where possible; a single atomic swap may temporarily
      // exceed the resident estimate and is explicitly reported.
      if (this.pending.size && this.estimatedBytes() + bytes > this.budget.residentBytes) continue;
      if (this.estimatedBytes() + bytes > this.budget.residentBytes) this.diagnostic('TRANSITION_HEADROOM', 'An atomic LOD swap needs temporary resident headroom; the old representation is retained until replacement is ready.', { tileId: chunk.id, bytes });
      this.start(key, chunk, index);
    }
  }
  start(key, chunk, index) {
    const controller = new AbortController(), task = { key, chunk, index, controller, epoch: this.epoch, started: this.now() };
    this.pending.set(key, task);
    this.counters.peakConcurrentLoads = Math.max(this.counters.peakConcurrentLoads, this.pending.size);
    task.promise = this.fetchDecode(task);
  }
  async fetchDecode(task) {
    const { key, chunk, index, controller } = task, lod = chunk.lods[index]; let group, binding, resources;
    try {
      let payload;
      try { payload = await this.readAsset(lod.url, { signal: controller.signal, responseType: 'arrayBuffer' }); }
      catch (cause) { throw runtimeError('ASSET_REQUEST_FAILED', 'asset', `Unable to load ${lod.url}: ${cause.message}`, { url: lod.url, tileId: chunk.id, cause }); }
      if (controller.signal.aborted || this.disposed) return;
      if (!(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload)) throw runtimeError('INVALID_ASSET_RESPONSE', 'asset', `readAsset must return ArrayBuffer for ${lod.url}.`, { url: lod.url, tileId: chunk.id });
      this.counters.fetchedBytes += payload.byteLength;
      if (lod.hash && globalThis.crypto?.subtle) {
        const expected = lod.hash.replace(/^sha256[:-]/, '').toLowerCase();
        const buffer = ArrayBuffer.isView(payload) ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : payload;
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (expected !== actual) throw runtimeError('ASSET_HASH_MISMATCH', 'decode', `Corrupt resource ${lod.url}.`, { url: lod.url, tileId: chunk.id });
      }
      try { group = await this.decodeChunk(payload, { ...lod, chunk, signal: controller.signal }); }
      catch (cause) { throw runtimeError('ASSET_DECODE_FAILED', 'decode', `Cannot decode ${lod.url}: ${cause.message}`, { url: lod.url, tileId: chunk.id, cause }); }
      if (!group?.isObject3D) throw runtimeError('INVALID_DECODE_RESULT', 'decode', `Decoder did not return a Three.js object for ${lod.url}.`, { url: lod.url });
      if (controller.signal.aborted || this.disposed || task.epoch !== this.epoch) { this.registry.release(this.registry.retain(group)); return; }
      group.matrix.copy(chunk.matrix); group.matrixAutoUpdate = false;
      const original = this.registry.retain(group);
      try { binding = await this.bindGroup(group); }
      catch (cause) { throw runtimeError('STYLE_BIND_FAILED', 'style', `Cannot bind style for ${lod.url}: ${cause.message}`, { url: lod.url, tileId: chunk.id, cause }); }
      finally {
        // Style binders may replace materials / geometries. Retain the result
        // before releasing original decoder resources to protect shared assets.
        resources = this.registry.retain(group); this.registry.release(original);
      }
      await this.prepareGroup?.(group, controller.signal);
      // Preparation may add renderer classification attributes or clone geometry.
      const prepared = this.registry.retain(group); this.registry.release(resources); resources = prepared;
      if (controller.signal.aborted || this.disposed || task.epoch !== this.epoch) { this.releaseGroup(group); binding?.dispose?.(); this.registry.release(resources); return; }
      this.unitCache.set(`${chunk.id}:${lod.url}`, collectDrawUnits(group));
      const estimatedBytes = Math.max(lod.residentBytes ?? lod.bytes, this.groupBytes(group));
      this.residentCache.set(`${chunk.id}:${lod.url}`, estimatedBytes);
      this.ready.push({ ...task, group, binding, resources, metrics: measureGroup(group), estimatedBytes });
      this.failures.delete(key);
      group = null;
    } catch (error) {
      if (group) { this.releaseGroup(group); binding?.dispose?.(); this.registry.release(resources || this.registry.retain(group)); }
      if (!controller.signal.aborted && !this.disposed) {
        const old = this.failures.get(key);
        this.failures.set(key, { attempts: (old?.attempts || 0) + 1, retryAt: this.now() + 1000, error });
        this.counters.failures++; this.onDiagnostic({ code: error.code || 'ASSET_LOAD_FAILED', stage: error.stage || 'asset', tileId: chunk.id, url: lod.url, message: error.message });
      }
    } finally {
      if (!this.ready.some(r => r.key === key)) this.pending.delete(key);
    }
  }
  groupBytes(group) {
    const arrays = new Set(); group.traverse(o => {
      if (o.geometry) for (const a of [...Object.values(o.geometry.attributes), o.geometry.index].filter(Boolean)) arrays.add(a.array || a.data?.array);
      if (o.instanceMatrix) arrays.add(o.instanceMatrix.array);
      if (o.instanceColor) arrays.add(o.instanceColor.array);
    });
    return [...arrays].reduce((sum, a) => sum + (a?.byteLength || 0), 0);
  }
  mountReady(time) {
    // At most one decoded chunk is uploaded / attached in a frame.
    const entry = this.ready.shift(); if (!entry) return;
    this.pending.delete(entry.key);
    const desired = this.desired.get(entry.chunk.id);
    if (!desired || entry.controller.signal.aborted || this.disposed) { this.releaseGroup(entry.group); entry.binding?.dispose?.(); this.registry.release(entry.resources); return; }
    const previous = this.current.get(entry.chunk.id);
    entry.since = time; entry.lastVisible = time; entry.group.visible = true;
    entry.frameMetrics = this.renderContext ? drawUnitCost(this.unitCache.get(`${entry.chunk.id}:${entry.chunk.lods[entry.index].url}`), this.renderContext) : desired.costs?.[entry.index];
    if (desired.costs) desired.costs[entry.index] = entry.frameMetrics;
    this.group.add(entry.group); this.current.set(entry.chunk.id, entry);
    if (entry.index === desired.index) this.states.set(entry.chunk.id, { index: entry.index, since: time });
    entry.resourcesDirty = true;
    if (previous) {
      if (this.renderContext && previous.index === previous.chunk.lods.length - 1) {
        previous.group.removeFromParent(); previous.group.visible = false; this.standby.set(previous.chunk.id, previous);
      } else this.release(previous);
      this.counters.swaps++;
    }
    this.counters.loads++;
    if (this.firstUsableMs == null) this.firstUsableMs = this.now() - this.started;
  }
  release(entry) { entry.group.removeFromParent(); this.releaseGroup(entry.group); entry.binding?.dispose?.(); this.registry.release(entry.resources); this.counters.unloads++; }
  evict(id) { const entry = this.current.get(id); if (!entry) return; this.release(entry); this.current.delete(id); const coarse = this.standby.get(id); if (coarse) { this.release(coarse); this.standby.delete(id); } this.states.delete(id); }
  frameCost() {
    let triangles = this.renderContext?.fixedTriangles || 0, calls = this.renderContext?.fixedCalls || 0;
    for (const e of this.current.values()) if (e.group.visible) { triangles += e.frameMetrics?.frameTriangles ?? e.metrics.triangles * this.passMultiplier; calls += e.frameMetrics?.frameCalls ?? e.metrics.drawCalls * this.passMultiplier; }
    return { triangles, calls };
  }
  enforceFrameBudget(time) {
    for (const desired of [...this.desired.values()].reverse()) {
      const cost = this.frameCost(); if (cost.triangles <= this.budget.visibleTriangles && cost.calls <= this.budget.drawCalls) break;
      const entry = this.current.get(desired.chunk.id), coarse = this.standby.get(desired.chunk.id);
      if (!entry || !coarse) continue;
      const coarseCost = desired.costs[coarse.index], entryCost = desired.costs[entry.index];
      if (coarseCost.frameTriangles > entryCost.frameTriangles || coarseCost.frameCalls > entryCost.frameCalls) continue;
      this.standby.delete(desired.chunk.id); this.release(entry);
      coarse.group.visible = true; coarse.lastVisible = time; coarse.frameMetrics = coarseCost;
      this.group.add(coarse.group); this.current.set(desired.chunk.id, coarse); this.counters.swaps++;
      desired.index = coarse.index; this.states.set(desired.chunk.id, { index: coarse.index, since: -Infinity });
    }
  }
  cancel(key) {
    const task = this.pending.get(key); if (!task || task.controller.signal.aborted) return;
    task.controller.abort(); this.counters.cancelled++;
    // Keep the slot until the transport / decoder acknowledges cancellation.
    // A reader that ignores AbortSignal cannot bypass the concurrency budget.
    const readyIndex = this.ready.findIndex(e => e.key === key);
    if (readyIndex >= 0) { const [entry] = this.ready.splice(readyIndex, 1); this.releaseGroup(entry.group); entry.binding?.dispose?.(); this.registry.release(entry.resources); this.pending.delete(key); }
  }
  estimatedBytes() {
    let bytes = this.extraResidentBytes || 0;
    for (const e of this.current.values()) bytes += e.estimatedBytes;
    for (const e of this.standby.values()) bytes += e.estimatedBytes;
    for (const e of this.pending.values()) bytes += e.chunk.lods[e.index].residentBytes ?? e.chunk.lods[e.index].bytes;
    return bytes;
  }
  isSettled() { return this.pending.size === 0 && [...this.desired.values()].every(p => this.current.get(p.chunk.id)?.index === p.index); }
  getBlockingFailure() {
    for (const desired of this.desired.values()) {
      const index = this.current.has(desired.chunk.id) ? desired.index : desired.chunk.lods.length - 1;
      const failure = this.failures.get(`${desired.chunk.id}:${index}`);
      if (failure?.attempts >= 2) return failure.error;
    }
    return null;
  }
  stats() {
    const levels = {}, visibleIds = [], missingIds = []; let visibleTriangles = 0, sceneDrawCalls = 0, nearDetails = 0;
    for (const [id, e] of this.current) {
      const level = String(e.chunk.lods[e.index].level); levels[level] = (levels[level] || 0) + 1;
      if (e.group.visible) { visibleIds.push(id); visibleTriangles += e.frameMetrics?.triangles ?? e.metrics.triangles; sceneDrawCalls += e.frameMetrics?.drawCalls ?? e.metrics.drawCalls; nearDetails += e.metrics.nearDetails; }
    }
    for (const id of this.desired.keys()) if (!this.current.has(id)) missingIds.push(id);
    return { ...this.counters, ...this.registry.stats(), estimatedResidentBytes: this.estimatedBytes(), byteMetric: 'CPU geometry arrays and manifest residentBytes/encoded bytes estimates; not measured GPU memory', currentChunks: this.current.size, pendingLoads: this.pending.size, visibleChunks: visibleIds.length, missingChunks: missingIds, visibleIds, levels, visibleTriangles, sceneDrawCalls, nearDetails, frameCost: this.frameCost(), desiredLods: [...this.desired.values()].map(p => ({ tileId: p.chunk.id, index: p.index, level: p.chunk.lods[p.index].level })), currentLods: [...this.current.values()].map(e => ({ tileId: e.chunk.id, index: e.index, level: e.chunk.lods[e.index].level })), standbyChunks: this.standby.size, settled: this.isSettled(), firstUsableMs: this.firstUsableMs };
  }
  refreshResources() {
    // Render pipelines can add classification attributes / clone shared buffers
    // on the first render. Account for and release those exact objects too.
    for (const entry of this.current.values()) if (entry.resourcesDirty) {
      const resources = this.registry.retain(entry.group); this.registry.release(entry.resources); entry.resources = resources;
      entry.estimatedBytes = Math.max(entry.chunk.lods[entry.index].residentBytes ?? entry.chunk.lods[entry.index].bytes, this.groupBytes(entry.group));
      this.residentCache.set(`${entry.chunk.id}:${entry.chunk.lods[entry.index].url}`, entry.estimatedBytes);
      entry.metrics = measureGroup(entry.group); entry.resourcesDirty = false;
    }
  }
  async rebind(bindGroup, prepareGroup = this.prepareGroup) {
    this.bindGroup = bindGroup; this.prepareGroup = prepareGroup;
    // Do not mix asynchronous old-style results into the new pipeline.
    this.epoch++;
    for (const key of this.pending.keys()) this.cancel(key);
    this.unitCache.clear(); this.residentCache.clear();
    for (const entry of [...this.current.values(), ...this.standby.values()]) {
      entry.binding?.dispose?.(); entry.binding = await bindGroup(entry.group);
      await prepareGroup?.(entry.group);
      const resources = this.registry.retain(entry.group); this.registry.release(entry.resources); entry.resources = resources;
      entry.metrics = measureGroup(entry.group); entry.estimatedBytes = Math.max(entry.chunk.lods[entry.index].residentBytes ?? entry.chunk.lods[entry.index].bytes, this.groupBytes(entry.group));
      entry.resourcesDirty = true;
      this.unitCache.set(`${entry.chunk.id}:${entry.chunk.lods[entry.index].url}`, collectDrawUnits(entry.group));
      this.residentCache.set(`${entry.chunk.id}:${entry.chunk.lods[entry.index].url}`, entry.estimatedBytes);
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++;
    for (const key of this.pending.keys()) this.cancel(key);
    for (const id of [...this.current.keys()]) this.evict(id);
    await Promise.allSettled([...this.pending.values()].map(p => p.promise));
    for (const entry of this.ready.splice(0)) { this.releaseGroup(entry.group); entry.binding?.dispose?.(); this.registry.release(entry.resources); }
    this.pending.clear(); this.desired.clear(); this.failures.clear(); this.states.clear(); this.unitCache.clear(); this.residentCache.clear(); this.extraResidentBytes = this.extraTriangles = this.extraCalls = this.extraDetails = 0; this.group.removeFromParent();
  }
}
