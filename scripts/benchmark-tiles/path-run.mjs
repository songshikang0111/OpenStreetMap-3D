// WP-D task D9 / 06 section 5: fixed camera path replay with whole-frame statistics in a real browser.
// Prerequisites: npm run demo:tiles && npm run build:demo
// Usage: node scripts/benchmark-tiles/path-run.mjs <path.json> [--quality balanced] [--width 1280 --height 720]
//        [--json summary.json] [--frames frames.json] [--headful]
// The summary (< 200 KB) may be committed; the per-frame log must not (07 section 4).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const pathFile = path.resolve(
  process.argv[2] ?? path.join(root, 'scripts/benchmark-tiles/paths/beijing-cbd-grow-9.json'),
);
const plan = JSON.parse(readFileSync(pathFile, 'utf8'));
const width = Number(arg('width', 1280));
const height = Number(arg('height', 720));
const quality = arg('quality', 'balanced');
const dist = path.join(root, 'apps/demo/dist');
const tilesetDir = path.join(dist, 'tiles', plan.tileset);
const tilesetHash = createHash('sha256')
  .update(readFileSync(path.join(tilesetDir, 'report.json')))
  .digest('hex')
  .slice(0, 16);

const page = await openPage(dist, `index.html?tiles=./tiles/${plan.tileset}/tileset.json`, {
  width,
  height,
  headless: !process.argv.includes('--headful'),
});
try {
  await page.waitFor('!!globalThis.cityMap && !!globalThis.createCityMap', 30000);
  await page.evaluate('cityMap.dispose()');
  const result = await page.evaluate(
    `(async () => {
    const plan = ${JSON.stringify(plan)};
    document.getElementById('map').innerHTML = '';
    const nav0 = performance.now();
    const map = await createCityMap({ container: document.getElementById('map'), tiles: './tiles/${plan.tileset}/tileset.json', quality: ${JSON.stringify(quality)}, ...plan.start });
    globalThis.cityMap = map;
    let firstUsable = null;
    await map.whenIdle({ timeoutMs: 60000 });
    firstUsable = performance.now() - nav0;
    // warm-up
    await map.easeTo({ zoom: plan.start.zoom + 0.5, duration: 1500 });
    await map.easeTo({ ...plan.start, duration: 1500 });
    await map.whenIdle({ timeoutMs: 60000 });
    const gl = map.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const frames = [];
    let last = performance.now(), running = true;
    const loop = (t) => {
      const s = map.getStats();
      frames.push({ t, dt: t - last, draws: s.drawCalls, tris: s.triangles, resident: s.residentBytes, upload: s.upload.lastFrameMs, loading: s.tiles.loading, visible: s.tiles.visible });
      last = t;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
    const r0 = map.getStats().requests;
    const t0 = performance.now();
    for (const k of plan.keyframes) await (k.type === 'flyTo' ? map.flyTo({ ...k.camera, duration: k.duration }) : map.easeTo({ ...k.camera, duration: k.duration }));
    const elapsed = performance.now() - t0;
    running = false;
    const s = map.getStats({ raw: true });
    return { frames, elapsed, firstUsable, gpu, dpr: devicePixelRatio, pixelRatio: map.renderer.getPixelRatio(), requests: { started: s.requests.started - r0.started, bytes: s.requests.bytes - r0.bytes }, workerMs: s.raw.generateMs };
  })()`,
    { timeout: 300000 },
  );
  const intervals = result.frames
    .slice(1)
    .map((f) => f.dt)
    .sort((a, b) => a - b);
  const q = (p, list = intervals) =>
    list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : null;
  const worker = [...result.workerMs].sort((a, b) => a - b);
  const longFrames = intervals.filter((d) => d > 50).length;
  const minutes = result.elapsed / 60000;
  const summary = {
    date: new Date().toISOString(),
    status: 'simulated: not a user-designated reference device (decision D5 pending)',
    environment: {
      browser: page.version?.product,
      gpu: result.gpu,
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      platform: `${os.platform()} ${os.release()}`,
      viewport: [width, height],
      devicePixelRatio: result.dpr,
      rendererPixelRatio: result.pixelRatio,
      quality,
      headless: !process.argv.includes('--headful'),
    },
    tileset: { name: plan.tileset, reportSha256Prefix: tilesetHash },
    sdkCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    path: path.relative(root, pathFile),
    durationMs: Math.round(result.elapsed),
    frames: intervals.length,
    frameIntervalMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: intervals.at(-1) },
    longFramesOver50ms: longFrames,
    longFramesPerMinute: +(longFrames / minutes).toFixed(2),
    firstUsableMs: Math.round(result.firstUsable),
    maxDrawCalls: Math.max(...result.frames.map((f) => f.draws)),
    maxTriangles: Math.max(...result.frames.map((f) => f.tris)),
    maxResidentBytesEstimate: Math.max(...result.frames.map((f) => f.resident)),
    maxUploadMsPerFrame: Math.max(...result.frames.map((f) => f.upload)),
    workerDecodeGenerateMs: {
      count: worker.length,
      p50: q(0.5, worker),
      p95: q(0.95, worker),
      max: worker.at(-1) ?? null,
    },
    requests: result.requests,
    gpuTimer:
      'not available in this run (EXT_disjoint_timer_query not queried); frame intervals are whole-frame wall-clock',
  };
  console.log(JSON.stringify(summary, null, 2));
  const out = arg('json');
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
  const frames = arg('frames');
  if (frames) writeFileSync(frames, JSON.stringify(result.frames));
} finally {
  await page.close();
}
