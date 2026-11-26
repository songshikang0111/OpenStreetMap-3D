// The route gate covers measurements made by replay. The separate 20-return resource check is AC411.
export function gradeReplay(s, budget, { acceptance, mobile, canonicalRoute, wholeCity, completedLoops }) {
  const failures = [];
  const checks = {};
  const check = (key, ok, value, limit) => {
    checks[key] = { pass: Boolean(ok), value, limit };
    if (!ok) failures.push(key);
  };
  const atMost = (key, value, limit) =>
    check(key, Number.isFinite(value) && value >= 0 && value <= limit, value, limit);
  const counts = s.frameViolations;
  for (const key of ['invalidSamples', 'blank', 'triangles', 'drawCalls', 'resident', 'workerQueue', 'upload'])
    atMost(key + 'Frames', counts[key], 0);
  atMost('tileErrors', s.tileErrors.length, 0);
  check('context', !s.contextLost, s.contextLost, false);
  check(
    'frameSamples',
    s.frames >= 2 && s.frameIntervalMs.count === s.frames - 1,
    s.frames,
    'at least 2 consecutive RAF samples',
  );
  check(
    'gpuEvidence',
    s.gpuTimer.available ? s.gpuTimer.count > 0 : !!s.gpuTimer.reason,
    s.gpuTimer.available ? s.gpuTimer.count : s.gpuTimer.reason,
    'timings or unavailable reason',
  );
  const env = s.environment;
  const names = [env.device, env.cpu, env.gpu, env.browser];
  check(
    'environment',
    names.every((v) => typeof v === 'string' && v.trim() && !/^(unspecified|unknown)$/i.test(v)) &&
      env.viewport.every((n) => Number.isFinite(n) && n > 0) &&
      env.devicePixelRatio > 0 &&
      env.rendererPixelRatio > 0,
    names,
    'identified device, CPU, GPU, browser, viewport and pixel ratios',
  );
  check(
    'dataIdentity',
    /^[0-9a-f]{40}$/.test(s.sdkCommit) &&
      /^[0-9a-f]{64}$/.test(s.tileset.buildReportSha256) &&
      s.tileset.buildReportSha256 === s.tileset.servedReportSha256,
    s.tileset,
    'build-time and served report hashes match',
  );
  check(
    'duration',
    Number.isFinite(s.durationMs) && s.durationMs >= (acceptance ? 600000 : s.route.plannedMs),
    s.durationMs,
    acceptance ? 'at least 600000 ms' : 'entire planned path',
  );
  if (acceptance) {
    check(
      'route',
      canonicalRoute && wholeCity && s.route.lapMs === 60000 && completedLoops === 10,
      { canonicalRoute, wholeCity, completedLoops, lapMs: s.route.lapMs },
      '10 complete laps of a versioned 60 s whole-city route',
    );
    check('hardwareRenderer', !/swiftshader|llvmpipe|software rasterizer/i.test(env.gpu), env.gpu, 'hardware GPU');
  }
  // Chrome reports RAF timestamps with 0.1 ms precision. Remove floating-point subtraction noise only.
  atMost(
    'frameIntervalP95Ms',
    Number.isFinite(s.frameIntervalMs.p95) ? Math.round(s.frameIntervalMs.p95 * 1e6) / 1e6 : null,
    mobile ? 33.3 : 16.7,
  );
  atMost('longFramesPerMinute', s.longFramesPerMinute, mobile ? 6 : 3);
  atMost('longFramesInWorstMinute', counts.maxLongFramesInMinute, mobile ? 6 : 3);
  atMost('firstUsableMs', s.firstUsableMs, mobile ? 3000 : 1500);
  check('workerSamples', s.workerDecodeGenerateMs.count > 0, s.workerDecodeGenerateMs.count, 'L1 samples');
  atMost('workerP95Ms', s.workerDecodeGenerateMs.p95, mobile ? 500 : 120);
  atMost('pixelRatio', env.rendererPixelRatio, Math.min(2, budget.pixelRatio));
  if (mobile)
    atMost(
      'renderPixels',
      Math.round(env.viewport[0] * env.rendererPixelRatio) * Math.round(env.viewport[1] * env.rendererPixelRatio),
      2500000,
    );
  if (wholeCity && env.quality === 'balanced')
    check(
      'firstScreenBytes',
      s.firstScreenEncodedBytes > 0 && s.firstScreenEncodedBytes <= 3000000,
      s.firstScreenEncodedBytes,
      '1–3000000 encoded bytes',
    );
  return { mode: acceptance ? 'acceptance' : 'diagnostic', passed: !failures.length, failures, checks };
}

export function countFrameViolations(frames, budget, uploadLimitMs) {
  const counts = { invalidSamples: 0, blank: 0, triangles: 0, drawCalls: 0, resident: 0, workerQueue: 0, upload: 0 };
  const longFramesByMinute = [];
  let worstMinute = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (Number.isFinite(f.t) && f.dt > 50) {
      const minute = Math.floor((f.t - frames[0].t) / 60000);
      const count = (longFramesByMinute[minute] ?? 0) + 1;
      longFramesByMinute[minute] = count;
      worstMinute = Math.max(worstMinute, count);
    }
    const values = [f.t, f.tris, f.draws, f.resident, f.workerQueue, f.visible, f.prepareMs, f.firstBufferMs];
    if (values.some((n) => !Number.isFinite(n) || n < 0) || (i && (!Number.isFinite(f.dt) || f.dt <= 0)))
      counts.invalidSamples++;
    if (!f.visible || !f.tris || !f.draws) counts.blank++;
    if (f.tris > budget.visibleTriangles) counts.triangles++;
    if (f.draws > budget.drawCalls) counts.drawCalls++;
    if (f.resident > budget.residentBytes) counts.resident++;
    if (f.workerQueue > budget.workerQueue) counts.workerQueue++;
    if (f.prepareMs + f.firstBufferMs > uploadLimitMs) counts.upload++;
  }
  return { ...counts, maxLongFramesInMinute: worstMinute };
}
