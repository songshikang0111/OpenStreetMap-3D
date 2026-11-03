import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuFrameTimer } from '../src/runtime/gpu-timer.js';

// A WebGL query lifecycle fixture, not evidence of hardware performance. A query
// becomes ready only when the test simulates a later GPU/browser completion.
function webglFixture({ supported = true, counterBits = 64 } = {}) {
  const extension = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb, QUERY_COUNTER_BITS_EXT: 0x8864 };
  const state = { queries: [], current: null, disjoint: false, lost: false,
    availableReads: 0, resultReads: 0, calls: [], failures: new Map() };
  function fail(name) {
    const count = state.failures.get(name) || 0;
    if (count) {
      state.failures.set(name, count - 1);
      throw new Error(`fixture ${name} failure`);
    }
  }
  const gl = {
    CURRENT_QUERY: 0x8865, QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866,
    getExtension(name) { fail('getExtension'); assert.equal(name, 'EXT_disjoint_timer_query_webgl2'); return supported ? extension : null; },
    isContextLost() { return state.lost; },
    getQuery(target, parameter) {
      fail('getQuery');
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      if (parameter === extension.QUERY_COUNTER_BITS_EXT) return counterBits;
      assert.equal(parameter, gl.CURRENT_QUERY);
      return state.current;
    },
    getParameter(parameter) { fail('getParameter'); assert.equal(parameter, extension.GPU_DISJOINT_EXT); return state.disjoint; },
    createQuery() {
      fail('createQuery');
      const query = { id: state.queries.length, available: false, deleted: false, ended: false };
      state.queries.push(query);
      state.calls.push(['create', query.id]);
      return query;
    },
    beginQuery(target, query) {
      fail('beginQuery');
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert.equal(state.current, null, 'nested elapsed queries must never be submitted');
      assert.equal(query.deleted, false);
      state.current = query;
      state.calls.push(['begin', query.id]);
    },
    endQuery(target) {
      fail('endQuery');
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert(state.current, 'only an active query may end');
      state.current.ended = true;
      state.calls.push(['end', state.current.id]);
      state.current = null;
    },
    getQueryParameter(query, parameter) {
      assert.equal(query.deleted, false);
      assert.equal(query.ended, true);
      if (parameter === gl.QUERY_RESULT_AVAILABLE) {
        fail('available');
        state.availableReads++;
        return query.available;
      }
      fail('result');
      assert.equal(parameter, gl.QUERY_RESULT);
      assert.equal(query.available, true, 'reading an unavailable result could stall the render loop');
      state.resultReads++;
      return query.nanoseconds;
    },
    deleteQuery(query) {
      fail('deleteQuery');
      assert.equal(query.deleted, false, 'each query is deleted exactly once');
      assert.notEqual(state.current, query, 'an active query must end before deletion');
      query.deleted = true;
      state.calls.push(['delete', query.id]);
    },
    finish() { assert.fail('GPU collection must not synchronously wait for completion'); },
    flush() { assert.fail('GPU collection must not force a GPU flush'); },
  };
  return { gl, state, ready(query, nanoseconds) { query.available = true; query.nanoseconds = nanoseconds; } };
}

function frame(timer, time) {
  assert.equal(timer.begin(time), true);
  assert.equal(timer.end(), true);
}

test('unavailable WebGL2 timer reports its reason and never fabricates zero timings', () => {
  for (const gl of [null, {}, webglFixture({ supported: false }).gl, webglFixture({ counterBits: 0 }).gl]) {
    const timer = new GpuFrameTimer(gl);
    assert.equal(timer.begin(20), false);
    assert.equal(timer.end(), false);
    assert.equal(timer.poll(), 0);
    const stats = timer.snapshot({ raw: true });
    assert.equal(stats.available, false);
    assert.match(stats.reason, /WebGL2|unavailable|no usable bits/);
    assert.equal(stats.samples, 0);
    for (const name of ['p50', 'p95', 'p99', 'max']) assert.equal(stats[name], null);
    assert.deepEqual(stats.rawSamples, []);
    assert.equal(stats.created, 0);
    timer.reset();
    timer.dispose();
    timer.dispose();
  }
});

test('delayed queries are polled once per call and use the complete 64-bit GPU result', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 100);
  const query = fixture.state.queries[0];
  for (let i = 0; i < 4; i++) assert.equal(timer.poll(), 0);
  assert.equal(fixture.state.availableReads, 4);
  assert.equal(fixture.state.resultReads, 0);
  assert.equal(timer.snapshot().pending, 1);
  // This value exceeds 32 bits, catching accidental bitwise truncation.
  fixture.ready(query, 5_123_456_789);
  assert.equal(timer.poll(), 1);
  assert.equal(timer.poll(), 0);
  const stats = timer.snapshot({ raw: true });
  assert.equal(stats.measurement, 'gpu-elapsed');
  assert.equal(stats.unit, 'ms');
  assert.equal(stats.samples, 1);
  assert.equal(stats.p50, 5123.456789);
  assert.deepEqual(stats.rawSamples, [{ time: 100, ms: 5123.456789 }]);
  assert.equal(stats.created, stats.deleted);
  assert.equal(stats.pending, 0);
  assert.equal(fixture.state.resultReads, 1);
  assert.equal(query.deleted, true);
  assert.equal('rawSamples' in timer.snapshot(), false);
  timer.dispose();
});

test('one elapsed query encloses all render passes and nested begin/end is harmless', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  assert.equal(timer.end(), false);
  assert.equal(timer.begin(10), true);
  fixture.state.calls.push(['draw', 'depth']);
  assert.equal(timer.begin(11), false);
  fixture.state.calls.push(['draw', 'light'], ['draw', 'AO'], ['draw', 'final']);
  assert.equal(timer.end(), true);
  assert.equal(timer.end(), false);
  assert.deepEqual(fixture.state.calls, [['create', 0], ['begin', 0], ['draw', 'depth'], ['draw', 'light'], ['draw', 'AO'], ['draw', 'final'], ['end', 0]]);
  assert.equal(timer.snapshot().skippedActive, 1);
  timer.dispose();
  assert.equal(timer.snapshot().unreleased, 0);
});

test('query budget bounds in-flight GPU resources and skipped frames do not become samples', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl, { maxPending: 2 });
  frame(timer, 1);
  assert.equal(timer.begin(2), true);
  let stats = timer.snapshot();
  assert.equal(stats.pending, 1);
  assert.equal(stats.active, true);
  assert.equal(stats.unreleased, 2);
  assert.equal(timer.end(), true);
  for (let i = 0; i < 20; i++) assert.equal(timer.begin(3 + i), false);
  stats = timer.snapshot();
  assert.equal(stats.created, 2);
  assert.equal(stats.budgetDropped, 20);
  assert.equal(stats.dropped, 20);
  assert.equal(stats.samples, 0);
  fixture.ready(fixture.state.queries[0], 2e6);
  fixture.ready(fixture.state.queries[1], 4e6);
  assert.equal(timer.poll(), 2);
  frame(timer, 25);
  stats = timer.snapshot();
  assert.equal(stats.samples, 2);
  assert.equal(stats.p50, 2);
  assert.equal(stats.p95, 4);
  assert.equal(stats.created, 3);
  timer.dispose();
  assert.equal(timer.snapshot().created, timer.snapshot().deleted);
});

test('a disjoint observation drops all unresolved and active queries before reading results', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 1);
  frame(timer, 2);
  assert.equal(timer.begin(3), true);
  fixture.ready(fixture.state.queries[0], 1e6);
  fixture.state.disjoint = true;
  assert.equal(timer.poll(), 0);
  let stats = timer.snapshot();
  assert.equal(stats.disjoint, 1);
  assert.equal(stats.disjointDropped, 3);
  assert.equal(stats.samples, 0);
  assert.equal(stats.pending, 0);
  assert.equal(stats.active, false);
  assert.equal(stats.unreleased, 0);
  assert.equal(fixture.state.resultReads, 0);
  assert.equal(timer.end(), false);
  assert.equal(timer.begin(4), false);
  assert.equal(timer.snapshot().disjointDropped, 4);
  fixture.state.disjoint = false;
  frame(timer, 5);
  fixture.ready(fixture.state.queries[3], 7e6);
  assert.equal(timer.poll(), 1);
  stats = timer.snapshot({ raw: true });
  assert.equal(stats.available, true);
  assert.deepEqual(stats.rawSamples, [{ time: 5, ms: 7 }]);
  timer.dispose();
});

test('bounded sample window preserves chronology, nearest-rank percentiles, and detached snapshots', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl, { maxSamples: 3 });
  for (const [time, milliseconds] of [[1, 9], [2, 1], [3, 8], [4, 3], [5, 5], [6, 2], [7, 7]]) {
    frame(timer, time);
    fixture.ready(fixture.state.queries.at(-1), milliseconds * 1e6);
    assert.equal(timer.poll(), 1);
  }
  const stats = timer.snapshot({ raw: true });
  assert.equal(stats.samples, 3);
  assert.equal(stats.collected, 7);
  assert.equal(stats.evictedSamples, 4);
  assert.deepEqual(stats.rawSamples, [{ time: 5, ms: 5 }, { time: 6, ms: 2 }, { time: 7, ms: 7 }]);
  assert.equal(stats.p50, 5);
  assert.equal(stats.p95, 7);
  assert.equal(stats.p99, 7);
  assert.equal(stats.max, 7);
  stats.rawSamples[0].ms = 1000;
  stats.rawSamples.push({ time: 20, ms: 20 });
  assert.equal(timer.snapshot({ raw: true }).rawSamples[0].ms, 5);
  timer.dispose();
});

test('reset deletes active and pending queries, retains lifetime counters, and starts a clean sample window', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 1);
  fixture.ready(fixture.state.queries[0], 1e6);
  timer.poll();
  frame(timer, 2);
  timer.begin(3);
  timer.reset();
  let stats = timer.snapshot({ raw: true });
  assert.equal(stats.available, true);
  assert.equal(stats.samples, 0);
  assert.deepEqual(stats.rawSamples, []);
  assert.equal(stats.created, 3);
  assert.equal(stats.deleted, 3);
  assert.equal(stats.resetDropped, 2);
  assert.equal(stats.resets, 1);
  assert.equal(fixture.state.current, null);
  frame(timer, 4);
  fixture.ready(fixture.state.queries[3], 4e6);
  timer.poll();
  stats = timer.snapshot({ raw: true });
  assert.deepEqual(stats.rawSamples, [{ time: 4, ms: 4 }]);
  assert.equal(stats.collected, 2);
  timer.dispose();
});

test('dispose cancels active and pending queries exactly once and cannot be reset into life', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 1);
  timer.begin(2);
  timer.dispose();
  timer.dispose();
  timer.reset();
  assert.equal(timer.begin(3), false);
  assert.equal(timer.end(), false);
  assert.equal(timer.poll(), 0);
  const stats = timer.snapshot();
  assert.equal(stats.disposed, true);
  assert.equal(stats.available, false);
  assert.match(stats.reason, /disposed/);
  assert.equal(stats.created, 2);
  assert.equal(stats.deleted, 2);
  assert.equal(stats.disposeDropped, 2);
  assert.equal(stats.pending, 0);
  assert.equal(stats.active, false);
  assert.equal(stats.unreleased, 0);
  assert.equal(stats.resets, 0);
});

test('another profiler owns its query and is neither nested nor ended by this timer', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  const other = fixture.gl.createQuery();
  fixture.gl.beginQuery(0x88bf, other);
  assert.equal(timer.begin(1), false);
  assert.equal(timer.end(), false);
  timer.reset();
  timer.dispose();
  assert.equal(fixture.state.current, other);
  assert.equal(other.deleted, false);
  assert.equal(timer.snapshot().occupiedDropped, 1);
  assert.equal(timer.snapshot().created, 0);
  fixture.gl.endQuery(0x88bf);
  fixture.gl.deleteQuery(other);
});

test('unexpected replacement of an active query disables collection without ending the replacement', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  timer.begin(1);
  fixture.gl.endQuery(0x88bf);
  const other = fixture.gl.createQuery();
  fixture.gl.beginQuery(0x88bf, other);
  assert.equal(timer.end(), false);
  assert.equal(timer.snapshot().available, false);
  assert.match(timer.snapshot().reason, /active GPU timer query changed/);
  assert.equal(timer.snapshot().unreleased, 0);
  timer.dispose();
  assert.equal(fixture.state.current, other);
  assert.equal(other.deleted, false);
  fixture.gl.endQuery(0x88bf);
  fixture.gl.deleteQuery(other);
});

test('invalid GPU results are discarded while an actual zero elapsed result remains valid', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  for (const nanoseconds of [NaN, Infinity, -1, null, '2000000', undefined, 0]) {
    frame(timer, NaN);
    fixture.ready(fixture.state.queries.at(-1), nanoseconds);
    timer.poll();
  }
  const stats = timer.snapshot({ raw: true });
  assert.equal(stats.invalidResults, 6);
  assert.equal(stats.dropped, 6);
  assert.equal(stats.samples, 1);
  assert.equal(stats.p50, 0);
  assert.deepEqual(stats.rawSamples, [{ time: null, ms: 0 }]);
  assert.equal(stats.created, stats.deleted);
  timer.dispose();
});

test('context loss releases pending queries and explicit reset permits restored-context sampling', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 1);
  fixture.state.lost = true;
  assert.equal(timer.poll(), 0);
  let stats = timer.snapshot();
  assert.equal(stats.available, false);
  assert.match(stats.reason, /context is lost/);
  assert.equal(stats.unreleased, 0);
  assert.equal(timer.begin(2), false);
  fixture.state.lost = false;
  timer.reset();
  frame(timer, 3);
  fixture.ready(fixture.state.queries.at(-1), 3e6);
  timer.poll();
  stats = timer.snapshot();
  assert.equal(stats.available, true);
  assert.equal(stats.samples, 1);
  assert.equal(stats.p50, 3);
  timer.dispose();
});

test('GL API exceptions fail closed, clean query ownership, and never escape into rendering', async t => {
  for (const method of ['getParameter', 'getQuery', 'createQuery', 'beginQuery', 'endQuery', 'available', 'result']) {
    await t.test(method, () => {
      const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
      if (method === 'endQuery') timer.begin(1);
      else if (method === 'available' || method === 'result') {
        frame(timer, 1);
        frame(timer, 2);
        timer.begin(3);
        fixture.ready(fixture.state.queries[0], 1e6);
      }
      fixture.state.failures.set(method, 1);
      assert.doesNotThrow(() => {
        if (method === 'endQuery') timer.end();
        else if (method === 'available' || method === 'result') timer.poll();
        else timer.begin(1);
      });
      const stats = timer.snapshot();
      assert.equal(stats.available, false);
      assert.match(stats.reason, /failure/);
      assert.equal(stats.errors, 1);
      assert.equal(stats.unreleased, 0);
      assert.equal(stats.pending, 0);
      assert.equal(stats.active, false);
      timer.dispose();
    });
  }
});

test('extension probing errors and a null query allocation are explicit unavailable states', () => {
  const initialization = webglFixture();
  initialization.state.failures.set('getExtension', 1);
  let timer;
  assert.doesNotThrow(() => { timer = new GpuFrameTimer(initialization.gl); });
  assert.equal(timer.snapshot().available, false);
  assert.match(timer.snapshot().reason, /initialization failed/);
  assert.equal(timer.snapshot().errors, 1);
  timer.reset();
  assert.equal(timer.snapshot().available, true);
  timer.dispose();

  const allocation = webglFixture();
  allocation.gl.createQuery = () => null;
  timer = new GpuFrameTimer(allocation.gl);
  assert.equal(timer.begin(1), false);
  assert.match(timer.snapshot().reason, /createQuery returned null/);
  assert.equal(timer.snapshot().created, 0);
  assert.equal(timer.snapshot().deleted, 0);
  timer.dispose();
});

test('failed query deletion stops allocations and can be retried by repeated dispose', () => {
  const fixture = webglFixture(), timer = new GpuFrameTimer(fixture.gl);
  frame(timer, 1);
  fixture.ready(fixture.state.queries[0], 1e6);
  fixture.state.failures.set('deleteQuery', 2);
  assert.doesNotThrow(() => timer.poll());
  let stats = timer.snapshot();
  assert.equal(stats.available, false);
  assert.equal(stats.unreleased, 1);
  assert.equal(stats.deleteErrors, 1);
  assert.equal(timer.begin(2), false);
  timer.dispose();
  assert.equal(timer.snapshot().unreleased, 1);
  timer.dispose();
  stats = timer.snapshot();
  assert.equal(stats.unreleased, 0);
  assert.equal(stats.created, stats.deleted);
  assert.equal(stats.deleteErrors, 2);
});
