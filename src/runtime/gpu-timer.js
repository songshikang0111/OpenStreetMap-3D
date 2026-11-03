const EXTENSION = 'EXT_disjoint_timer_query_webgl2';

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
}

/**
 * Non-blocking WebGL2 GPU elapsed-time queries. Wrap the complete render pipeline
 * in begin(frameTime)/end(), then poll on later animation frames. No finish(),
 * flush(), CPU clock fallback, or read of an unavailable QUERY_RESULT is used.
 *
 * Only this collector may manage its queries. An existing TIME_ELAPSED_EXT query
 * owned by another profiler makes that frame skip sampling. Results measure GPU
 * elapsed time between begin/end, not frame intervals or actual GPU memory.
 *
 * reset() clears the sample window and cancels in-flight queries, while retaining
 * lifetime resource/error counters. It can retry initialization after restoration
 * of a lost context. dispose() is terminal and safe to call repeatedly.
 * Specification: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/
 */
export class GpuFrameTimer {
  constructor(gl, { maxPending = 8, maxSamples = 18000 } = {}) {
    this._gl = gl;
    this._maxPending = positiveInteger(maxPending, 8);
    this._maxSamples = positiveInteger(maxSamples, 18000);
    this._extension = null;
    this._available = false;
    this._reason = null;
    this._disposed = false;
    this._active = null;
    this._pending = [];
    this._cleanup = new Set();
    this._samples = [];
    this._sampleCursor = 0;
    this._lastDisjoint = false;
    this._lastError = null;
    this._counts = {
      created: 0, deleted: 0, collected: 0, dropped: 0, budgetDropped: 0,
      disjoint: 0, disjointDropped: 0, invalidResults: 0, occupiedDropped: 0,
      skippedActive: 0, evictedSamples: 0, errors: 0, deleteErrors: 0,
      resetDropped: 0, disposeDropped: 0, errorDropped: 0, resets: 0,
    };
    this._initialize();
  }

  _initialize() {
    this._available = false;
    this._lastDisjoint = false;
    try {
      const gl = this._gl;
      const methods = ['getExtension', 'createQuery', 'beginQuery', 'endQuery',
        'getQuery', 'getQueryParameter', 'getParameter', 'deleteQuery'];
      if (!gl || methods.some(name => typeof gl[name] !== 'function')) {
        this._reason = 'A WebGL2 context with query support is required';
        return;
      }
      if (gl.isContextLost?.()) {
        this._reason = 'WebGL context is lost';
        return;
      }
      this._extension = gl.getExtension(EXTENSION);
      if (!this._extension) {
        this._reason = `${EXTENSION} is unavailable`;
        return;
      }
      const bits = gl.getQuery(this._extension.TIME_ELAPSED_EXT, this._extension.QUERY_COUNTER_BITS_EXT);
      if (!(bits > 0)) {
        this._reason = 'GPU TIME_ELAPSED_EXT counter has no usable bits';
        return;
      }
      this._available = true;
      this._reason = null;
    } catch (error) {
      this._recordError('GPU timer initialization failed', error);
    }
  }

  _recordError(stage, error) {
    this._counts.errors++;
    this._lastError = `${stage}: ${error?.message || String(error)}`;
    this._available = false;
    if (!this._disposed) this._reason = this._lastError;
  }

  _release(entry) {
    if (entry.deleted) return;
    try {
      this._gl.deleteQuery(entry.query);
      entry.deleted = true;
      this._counts.deleted++;
      this._cleanup.delete(entry);
    } catch (error) {
      // Keep a reference for a later reset/dispose retry instead of losing a
      // query whose deletion threw. Sampling stops, so this set stays bounded.
      this._counts.deleteErrors++;
      this._cleanup.add(entry);
      this._recordError('GPU query deletion failed', error);
    }
  }

  _retryCleanup() {
    for (const entry of [...this._cleanup]) this._release(entry);
  }

  _clearInFlight(cause) {
    const entries = this._pending;
    this._pending = [];
    if (this._active) {
      const entry = this._active;
      this._active = null;
      try {
        if (this._gl.getQuery(this._extension.TIME_ELAPSED_EXT, this._gl.CURRENT_QUERY) === entry.query) {
          this._gl.endQuery(this._extension.TIME_ELAPSED_EXT);
        }
      } catch (error) {
        this._recordError('GPU query cancellation failed', error);
      }
      entries.push(entry);
    }
    this._counts.dropped += entries.length;
    this._counts[`${cause}Dropped`] += entries.length;
    for (const entry of entries) this._release(entry);
  }

  _fail(stage, error) {
    this._recordError(stage, error);
    this._clearInFlight('error');
  }

  /** Returns false when sampling is unavailable or this frame was skipped. */
  begin(time) {
    if (this._disposed || !this._available) return false;
    if (this._active) {
      this._counts.skippedActive++;
      return false;
    }
    this.poll();
    if (!this._available) return false;
    if (this._lastDisjoint) {
      this._counts.dropped++;
      this._counts.disjointDropped++;
      return false;
    }
    if (this._pending.length >= this._maxPending) {
      this._counts.dropped++;
      this._counts.budgetDropped++;
      return false;
    }
    try {
      const gl = this._gl;
      if (gl.getQuery(this._extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
        this._counts.dropped++;
        this._counts.occupiedDropped++;
        return false;
      }
      const query = gl.createQuery();
      if (!query) throw new Error('createQuery returned null');
      this._counts.created++;
      this._active = { query, time: Number.isFinite(time) ? time : null, deleted: false };
      gl.beginQuery(this._extension.TIME_ELAPSED_EXT, query);
      return true;
    } catch (error) {
      this._fail('GPU query begin failed', error);
      return false;
    }
  }

  /** End once, in a finally block after every render pass for the frame. */
  end() {
    if (this._disposed || !this._active) return false;
    try {
      const gl = this._gl;
      if (gl.getQuery(this._extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== this._active.query) {
        throw new Error('The active GPU timer query changed before end');
      }
      gl.endQuery(this._extension.TIME_ELAPSED_EXT);
      this._pending.push(this._active);
      this._active = null;
      return true;
    } catch (error) {
      this._fail('GPU query end failed', error);
      return false;
    }
  }

  _store(time, ms) {
    const sample = { time, ms };
    if (this._samples.length < this._maxSamples) this._samples.push(sample);
    else {
      this._samples[this._sampleCursor] = sample;
      this._sampleCursor = (this._sampleCursor + 1) % this._maxSamples;
      this._counts.evictedSamples++;
    }
    this._counts.collected++;
  }

  /** Poll each pending query at most once; never waits for GPU completion. */
  poll() {
    if (this._disposed || !this._available) return 0;
    try {
      if (this._gl.isContextLost?.()) throw new Error('WebGL context is lost');
      this._lastDisjoint = Boolean(this._gl.getParameter(this._extension.GPU_DISJOINT_EXT));
      if (this._lastDisjoint) {
        this._counts.disjoint++;
        this._clearInFlight('disjoint');
        return 0;
      }
    } catch (error) {
      this._fail('GPU query polling failed', error);
      return 0;
    }
    let collected = 0;
    const pending = this._pending;
    this._pending = [];
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      try {
        const gl = this._gl;
        if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) {
          this._pending.push(entry);
          continue;
        }
        const nanoseconds = gl.getQueryParameter(entry.query, gl.QUERY_RESULT);
        if (typeof nanoseconds === 'number' && Number.isFinite(nanoseconds) && nanoseconds >= 0) {
          this._store(entry.time, nanoseconds / 1e6);
          collected++;
        } else {
          this._counts.dropped++;
          this._counts.invalidResults++;
        }
        this._release(entry);
        if (!this._available) {
          this._pending.push(...pending.slice(i + 1));
          this._clearInFlight('error');
          break;
        }
      } catch (error) {
        this._pending.push(entry, ...pending.slice(i + 1));
        this._fail('GPU query result failed', error);
        break;
      }
    }
    return collected;
  }

  reset() {
    if (this._disposed) return;
    this._clearInFlight('reset');
    this._retryCleanup();
    this._samples = [];
    this._sampleCursor = 0;
    this._counts.resets++;
    if (!this._cleanup.size) this._initialize();
  }

  /** Read-only snapshot; null percentiles mean there are no GPU samples. */
  snapshot({ raw = false } = {}) {
    const samples = this._sampleCursor
      ? [...this._samples.slice(this._sampleCursor), ...this._samples.slice(0, this._sampleCursor)]
      : this._samples;
    const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
    const snapshot = {
      available: this._available && !this._disposed,
      reason: this._reason,
      measurement: 'gpu-elapsed', unit: 'ms', samples: sorted.length,
      p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99), max: sorted.length ? sorted[sorted.length - 1] : null,
      pending: this._pending.length, active: Boolean(this._active),
      maxPending: this._maxPending, maxSamples: this._maxSamples,
      disposed: this._disposed, lastDisjoint: this._lastDisjoint,
      unreleased: this._counts.created - this._counts.deleted,
      lastError: this._lastError,
      ...this._counts,
    };
    if (raw) snapshot.rawSamples = samples.map(sample => ({ ...sample }));
    return snapshot;
  }

  dispose() {
    if (!this._disposed) {
      this._disposed = true;
      this._available = false;
      this._reason = 'GPU frame timer is disposed';
      this._clearInFlight('dispose');
    }
    this._retryCleanup();
  }
}
