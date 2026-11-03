export function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b), q = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  return { count: sorted.length, p50: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1) };
}

export class FrameStatistics {
  constructor(limit = 18000) { this.limit = limit; this.reset(); }
  reset() { this.frames = []; this.initialFrame = null; this.lastTime = null; this.last = {}; this.frameCount = 0; }
  record(time, renderer, extra = {}) {
    const intervalMs = this.lastTime == null ? null : time - this.lastTime;
    this.lastTime = time;
    this.last = { time, intervalMs, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lines: renderer.info.render.lines, points: renderer.info.render.points, rendererGeometries: renderer.info.memory.geometries, rendererTextures: renderer.info.memory.textures, rendererPrograms: renderer.info.programs?.length ?? 0, ...extra };
    if (intervalMs == null) this.initialFrame = this.last;
    if (intervalMs != null) { this.frames.push(this.last); if (this.frames.length > this.limit) this.frames.shift(); }
    this.frameCount++;
  }
  snapshot(raw = false) {
    return { frameCount: this.frameCount, windowFrames: this.frames.length, intervalsMs: distribution(this.frames.map(f => f.intervalMs)), longFrames50ms: this.frames.filter(f => f.intervalMs > 50).length, longFrames33ms: this.frames.filter(f => f.intervalMs > 33.3).length, drawCalls: distribution(this.frames.map(f => f.drawCalls)), triangles: distribution(this.frames.map(f => f.triangles)), last: { ...this.last }, ...(raw ? { initialFrame:this.initialFrame?{...this.initialFrame}:null,frames: this.frames.map(f => ({ ...f })) } : {}), gpuTime: { available: false, reason: 'GPU timer queries are not collected; frame intervals are wall-clock requestAnimationFrame intervals.' } };
  }
}
