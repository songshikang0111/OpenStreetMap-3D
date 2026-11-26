import { createMap, QUALITY_BUDGETS } from '@city-ink/map';
import beijing from '../../scripts/benchmark-tiles/paths/beijing-cbd-grow-9.json';
import kyoto from '../../scripts/benchmark-tiles/paths/kyoto-gion-grow-9.json';

import enkhuizen from '../../scripts/benchmark-tiles/paths/enkhuizen.json';
import municipality from '../../scripts/benchmark-tiles/paths/enkhuizen-municipality.json';
import { countFrameViolations, gradeReplay } from '../../scripts/benchmark-tiles/frame-gate.mjs';
import { measureBufferCreation } from './buffer-meter.js';

const plans = new Map([beijing, kyoto, enkhuizen, municipality].map((plan) => [plan.tileset, plan]));
const params = new URLSearchParams(location.search);
const form = document.querySelector('form');
const status = document.getElementById('status');
const output = document.querySelector('textarea');
const nextFrame = () => new Promise(requestAnimationFrame);

function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const q = (p) => sorted[Math.ceil(p * sorted.length) - 1] ?? null;
  return { count: sorted.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
}

// The automation can supply a repository path file; manual runs use the same bundled camera plans.
async function replay(plan, quality, loops) {
  const tiles = new URL(`./tiles/${encodeURIComponent(plan.tileset)}/tileset.json`, location.href);
  const map = await createMap({
    container: document.getElementById('map'),
    tiles: tiles.href,
    quality,
    interactive: false,
    ...plan.start,
  });
  const errors = [];
  map.on('tileerror', (e) => errors.push({ tile: e.tile, error: e.error }));
  const gl = map.renderer.getContext();
  const buffers = measureBufferCreation(gl);
  let contextLost = false;
  const lost = () => {
    contextLost = true;
  };
  gl.canvas.addEventListener('webglcontextlost', lost);
  let raf = 0;
  try {
    const deadline = performance.now() + 60000;
    while (!map.getStats().tiles.visible) {
      if (performance.now() > deadline) throw new Error('No visible tile within 60 seconds');
      await nextFrame();
    }
    await nextFrame();
    const firstUsableMs = performance.now();
    await map.whenIdle({ timeoutMs: 60000 });
    // Include manifest and coverage. Sum the encoded HTTP bodies on this cold navigation.
    const base = new URL('.', tiles).href;
    const firstScreenBytes = performance
      .getEntriesByType('resource')
      .filter((r) => r.name.startsWith(base))
      .reduce((sum, r) => sum + r.encodedBodySize, 0);
    await map.easeTo({ zoom: plan.start.zoom + 0.5, duration: 1500 });
    await map.easeTo({ ...plan.start, duration: 1500 });
    await map.whenIdle({ timeoutMs: 60000 });
    buffers.take();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const frames = [];
    const started = performance.now();
    const r0 = map.getStats().requests;
    const gpuSamples = [],
      workerSamples = [];
    let latestGpu = -Infinity,
      latestWorker = -Infinity;
    function retainTimings(raw, end) {
      for (const sample of raw.gpu?.rawSamples ?? [])
        if (sample.time >= started && sample.time <= end && sample.time > latestGpu) gpuSamples.push(sample);
      for (const sample of raw.workerSamples ?? [])
        if (sample.profile === 'full' && sample.time >= started && sample.time <= end && sample.time > latestWorker)
          workerSamples.push(sample);
      latestGpu = gpuSamples.at(-1)?.time ?? latestGpu;
      latestWorker = workerSamples.at(-1)?.time ?? latestWorker;
    }
    let last = null;
    function collect(t) {
      const s = map.getStats();
      frames.push({
        t,
        dt: last === null ? null : t - last,
        draws: s.drawCalls,
        tris: s.triangles,
        resident: s.residentBytes,
        upload: s.upload.lastFrameMs,
        prepareMs: s.upload.lastFrameMs,
        ...buffers.take(),
        loading: s.tiles.loading,
        visible: s.tiles.visible,
        workerQueue: s.workers.queued,
      });
      last = t;
      raf = requestAnimationFrame(collect);
    }
    raf = requestAnimationFrame(collect);
    for (let loop = 0; loop < loops; loop++) {
      status.textContent = `Recording route ${loop + 1} of ${loops}…`;
      for (const k of plan.keyframes) {
        const target = { ...k.camera, duration: k.duration };
        if (k.type === 'flyTo') await map.flyTo(target);
        else await map.easeTo(target);
      }
      // The SDK bounds its diagnostic history. Retain each completed minute before it can be evicted.
      if (loop + 1 < loops) retainTimings(map.getStats({ raw: true }).raw, performance.now());
    }
    await nextFrame();
    cancelAnimationFrame(raf);
    const end = performance.now();
    const s = map.getStats({ raw: true });
    const intervals = frames.slice(1).map((f) => f.dt);
    const rawGpu = s.raw.gpu;
    retainTimings(s.raw, end);
    const peak = (key) => frames.reduce((max, f) => Math.max(max, f[key]), 0);
    const longFrames = intervals.filter((d) => d > 50).length;
    const reportHash = __TILE_HASHES__[plan.tileset] ?? null;
    const reportResponse = await fetch(new URL('report.json', tiles));
    const digest =
      reportResponse.ok && globalThis.crypto?.subtle
        ? new Uint8Array(await crypto.subtle.digest('SHA-256', await reportResponse.arrayBuffer()))
        : null;
    const servedReportSha256 = digest && Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const lapMs = plan.keyframes.reduce((sum, k) => sum + k.duration, 0);
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const budget = QUALITY_BUDGETS[quality];
    const uploadLimitMs = Math.min(budget.uploadMsPerFrame, mobile ? 6 : 4);
    const summary = {
      date: new Date().toISOString(),
      status: 'local-device run',
      environment: {
        browser: navigator.userAgent,
        device: params.get('device') || 'unspecified',
        cpu: params.get('device') || 'unspecified',
        gpu,
        cores: navigator.hardwareConcurrency,
        viewport: [innerWidth, innerHeight],
        devicePixelRatio,
        rendererPixelRatio: map.renderer.getPixelRatio(),
        quality,
      },
      tileset: { name: plan.tileset, buildReportSha256: reportHash, servedReportSha256 },
      route: { loops, lapMs, plannedMs: loops * lapMs },
      contextLost: contextLost || gl.isContextLost(),
      frameViolations: countFrameViolations(frames, budget, uploadLimitMs),
      uploadLimitMs,
      sdkCommit: __SDK_COMMIT__,
      durationMs: Math.round(end - started),
      frames: frames.length,
      frameIntervalMs: distribution(intervals),
      longFramesOver50ms: longFrames,
      longFramesPerMinute: (60000 * longFrames) / (end - started),
      firstUsableMs: Math.round(firstUsableMs),
      firstScreenEncodedBytes: firstScreenBytes,
      maxDrawCalls: peak('draws'),
      maxTriangles: peak('tris'),
      maxResidentBytesEstimate: peak('resident'),
      maxUploadMsPerFrame: frames.reduce((max, f) => Math.max(max, f.prepareMs + f.firstBufferMs), 0),
      maxPrepareMsPerFrame: peak('prepareMs'),
      maxFirstBufferMsPerFrame: peak('firstBufferMs'),
      maxFirstBufferBytesPerFrame: peak('firstBufferBytes'),
      firstBufferCalls: frames.reduce((n, f) => n + f.firstBufferCalls, 0),
      maxWorkerQueue: peak('workerQueue'),
      workerDecodeGenerateMs: distribution(workerSamples.map((x) => x.ms)),
      requests: { started: s.requests.started - r0.started, bytes: s.requests.bytes - r0.bytes },
      gpuTimer: {
        available: rawGpu?.available ?? false,
        reason: rawGpu?.reason ?? null,
        ...distribution(gpuSamples.map((x) => x.ms)),
      },
      tileErrors: errors,
    };
    summary.verdict = gradeReplay(summary, budget, {
      acceptance: loops === 10 || params.get('acceptance') === '1',
      mobile,
      canonicalRoute: JSON.stringify(plan) === JSON.stringify(plans.get(plan.tileset)),
      wholeCity: [enkhuizen.tileset, municipality.tileset].includes(plan.tileset),
      completedLoops: loops,
    });
    return { summary, frames, workerSamples, gpuSamples };
  } finally {
    cancelAnimationFrame(raf);
    buffers.dispose();
    gl.canvas.removeEventListener('webglcontextlost', lost);
    await map.dispose();
  }
}

async function start() {
  form.hidden = true;
  status.textContent = 'Loading tiles…';
  const plan = params.has('plan') ? JSON.parse(params.get('plan')) : plans.get(params.get('sample') ?? beijing.tileset);
  const loops = Number(params.get('loops') ?? 1);
  const quality = params.get('quality') ?? 'balanced';
  if (!plan || ![1, 10].includes(loops) || !['low', 'balanced', 'high'].includes(quality))
    throw new Error('Invalid benchmark options');
  const result = await replay(plan, quality, loops);
  output.value = JSON.stringify(result.summary, null, 2);
  window.benchmarkResult = result;
  document.getElementById('results').hidden = false;
  const verdict = result.summary.verdict;
  status.textContent = verdict.mode + (verdict.passed ? ' passed.' : ' failed — ' + verdict.failures.join(', '));
  document.getElementById('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = 'Copied result.';
    } catch {
      output.select();
      status.textContent = 'Copy the selected result text.';
    }
  };
  document.getElementById('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = plan.tileset + '-frames.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
if (params.get('run') === '1')
  start().catch((error) => {
    status.textContent = String(error);
    window.benchmarkError = String(error);
    form.hidden = false;
  });
