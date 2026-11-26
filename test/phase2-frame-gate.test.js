import assert from 'node:assert/strict';
import test from 'node:test';
import { countFrameViolations, gradeReplay } from '../scripts/benchmark-tiles/frame-gate.mjs';

const budget = {
  drawCalls: 1200,
  visibleTriangles: 600000,
  residentBytes: 128 * 2 ** 20,
  workerQueue: 12,
  pixelRatio: 2,
};
const sample = {
  t: 1,
  dt: null,
  draws: 2,
  tris: 20,
  resident: 50,
  workerQueue: 0,
  visible: 1,
  prepareMs: 1,
  firstBufferMs: 2,
};
const options = { acceptance: false, mobile: false, canonicalRoute: true, wholeCity: true, completedLoops: 1 };

function summary() {
  return {
    frameViolations: countFrameViolations([sample], budget, 4),
    tileErrors: [],
    contextLost: false,
    environment: {
      device: 'laptop',
      cpu: 'CPU',
      gpu: 'Radeon 780M',
      browser: 'Chrome/158',
      viewport: [1280, 720],
      devicePixelRatio: 1,
      rendererPixelRatio: 1,
      quality: 'balanced',
    },
    tileset: { name: 'city', buildReportSha256: 'f'.repeat(64), servedReportSha256: 'f'.repeat(64) },
    sdkCommit: 'a'.repeat(40),
    route: { lapMs: 60000, plannedMs: 60000 },
    durationMs: 60010,
    frames: 3500,
    frameIntervalMs: { count: 3499, p95: 16.70000000001 },
    gpuTimer: { available: false, reason: 'extension unavailable' },
    longFramesPerMinute: 2,
    firstUsableMs: 1000,
    workerDecodeGenerateMs: { count: 200, p95: 90 },
    firstScreenEncodedBytes: 500000,
  };
}

test('one bad frame survives aggregation, including first WebGL buffer submission', () => {
  const bad = {
    ...sample,
    t: 20,
    dt: 19,
    visible: 0,
    resident: budget.residentBytes + 1,
    prepareMs: 3,
    firstBufferMs: 2,
  };
  const next = { ...sample, t: 36, dt: 16, draws: NaN };
  const s = summary();
  s.frameViolations = countFrameViolations([sample, bad, next], budget, 4);
  const v = gradeReplay(s, budget, options);
  assert.equal(v.passed, false);
  for (const key of ['blankFrames', 'residentFrames', 'uploadFrames', 'invalidSamplesFrames'])
    assert.ok(v.failures.includes(key));
});

test('diagnostic completion and ten-minute acceptance require separate evidence', () => {
  const s = summary();
  assert.deepEqual(gradeReplay(s, budget, options).failures, []);
  const accept = { ...options, acceptance: true };
  assert.deepEqual(gradeReplay(s, budget, accept).failures, ['duration', 'route']);
  s.durationMs = 600010;
  s.route.plannedMs = 600000;
  assert.ok(gradeReplay(s, budget, { ...accept, completedLoops: 10 }).passed);
  s.tileErrors.push('load failed');
  s.contextLost = true;
  s.environment.device = 'unspecified';
  s.tileset.servedReportSha256 = '0'.repeat(64);
  s.workerDecodeGenerateMs = { count: 0, p95: null };
  const v = gradeReplay(s, budget, accept);
  for (const key of ['tileErrors', 'context', 'environment', 'dataIdentity', 'workerSamples', 'workerP95Ms', 'route'])
    assert.ok(v.failures.includes(key));
});

test('the WebGL meter forwards the original call and separates stores inside and after the upload slice', async () => {
  const { measureBufferCreation } = await import('../apps/demo/buffer-meter.js');
  const args = [];
  const gl = {
    bufferData(...parameters) {
      args.push(parameters);
      return 7;
    },
  };
  const original = gl.bufferData;
  const meter = measureBufferCreation(gl);
  const data = new Uint16Array(64);
  assert.equal(gl.bufferData(1, data, 0, 10, 12), 7);
  const boundary = performance.now();
  gl.bufferData(1, 32, 0);
  const frame = meter.take(boundary);
  assert.equal(frame.firstBufferCalls, 2);
  assert.equal(frame.firstBufferBytes, 56);
  assert.ok(frame.insideSliceMs <= frame.firstBufferMs);
  assert.deepEqual(args[0], [1, data, 0, 10, 12]);
  assert.equal(meter.take().firstBufferCalls, 0);
  meter.dispose();
  assert.equal(gl.bufferData, original);
});

test('a long-frame burst in one replay minute cannot pass on a ten-minute average', () => {
  const s = summary();
  const frames = [sample, ...[61000, 61100, 61200, 61300].map((t) => ({ ...sample, t, dt: 100 }))];
  s.frameViolations = countFrameViolations(frames, budget, 4);
  s.longFramesPerMinute = 0.4;
  assert.equal(s.frameViolations.maxLongFramesInMinute, 4);
  assert.deepEqual(gradeReplay(s, budget, options).failures, ['longFramesInWorstMinute']);
});
