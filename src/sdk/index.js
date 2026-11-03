import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeManifest, fetchAsset, runtimeError } from '../runtime/manifest.js';
import { createBudget } from '../runtime/policy.js';
import { ChunkStreamer } from '../runtime/streamer.js';
import { FrameStatistics } from '../runtime/statistics.js';
import { GpuFrameTimer } from '../runtime/gpu-timer.js';
import { loadDefaultAdapters } from '../runtime/integrations.js';
import { NearDetails } from '../runtime/near-details.js';
import { applyView } from '../runtime/camera.js';
import { applyPipelineQuality } from '../runtime/style-quality.js';
import { renderProfile, costContext, renderWithProfile } from '../runtime/render-cost.js';
import { exportViewerPNG, exportViewerGLB } from './exports.js';

const QUALITY = { low: { pixelRatio: 1, shadowQuality: 0, aoQuality: 0 }, balanced: { pixelRatio: 1, shadowQuality: 1, aoQuality: 1 }, high: { pixelRatio: 2, shadowQuality: 2, aoQuality: 2 } };
QUALITY.draft = QUALITY.low;

/** A static-asset WebGL2 viewer. No workbench endpoints or fixed DOM IDs. */
export async function createCityViewer(options) {
  const { container, manifestUrl, onProgress = () => {}, onDiagnostic = () => {}, onSelect = () => {}, readAsset = fetchAsset } = options || {};
  if (!container?.appendChild) throw new TypeError('createCityViewer requires a DOM container.');
  const quality = typeof options.quality === 'string' ? QUALITY[options.quality] : options.quality;
  if (typeof options.quality === 'string' && !quality) throw new TypeError(`Unknown quality ${options.quality}.`);
  const budget = createBudget({ ...QUALITY.balanced, ...quality, ...options.budget });
  const adapters = options.adapters || await loadDefaultAdapters();
  if (typeof adapters.decodeChunk !== 'function') throw new TypeError('adapters.decodeChunk must be a function.');
  const styleApi = adapters.styleApi;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, budget.pixelRatio));
  renderer.shadowMap.enabled = budget.shadowQuality > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'City Ink scene'); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f6f5f1');
  const root = new THREE.Group(); scene.add(root);
  const camera = new THREE.PerspectiveCamera(45, 1, .25, 30000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .12; controls.maxPolarAngle = Math.PI;
  const ambient = new THREE.HemisphereLight('#ffffff', '#818b86', 2.3), sun = new THREE.DirectionalLight('#fff5e4', 2.4);
  sun.position.set(-400, 800, 350); sun.castShadow = budget.shadowQuality > 0;
  sun.shadow.mapSize.setScalar(budget.shadowQuality > 1 ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 4000 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(ambient, sun, sun.target);
  const shared = adapters.createShared?.() || { windows: { value: 1 }, provenance: { value: 0 }, facadeDetail: { value: .5 }, glassReflection: { value: .65 }, toneSize: { value: 4.2 }, projectionScale: { value: 1000 } };
  const statistics = new FrameStatistics(), gpuTimer = new GpuFrameTimer(renderer.getContext()); let streamer, manifest, activeUrl, pipeline, style, nearDetails;
  let width = 1, height = 1, animation, disposed = false, loading, loadEpoch = 0, paused = false, renderFailed = false, lodMode = 'auto';
  let selectionStart, allLoadedMs = null, firstRenderedMs = null, firstRenderedAtMs = null, sceneStarted = 0, sceneOperations = Promise.resolve(), internalPauses = 0, disposal;
  let viewRevision = 0, scheduledRevision = -1;
  let observedProfile;
  const invalidateSchedule = () => { viewRevision++; };
  controls.addEventListener('change', invalidateSchedule);
  const acquirePause = () => { internalPauses++; let released = false; return () => { if (!released) { released = true; internalPauses--; } }; };
  function queueOperation(operation) {
    if (disposed) return Promise.reject(runtimeError('VIEWER_DISPOSED', 'lifecycle', 'Viewer is disposed.'));
    const next = sceneOperations.catch(() => {}).then(async () => {
      if (disposed) throw runtimeError('VIEWER_DISPOSED', 'lifecycle', 'Viewer is disposed.');
      return operation();
    });
    sceneOperations = next; return next;
  }
  const diagnostics = [];
  const diagnose = d => { diagnostics.push(d); if (diagnostics.length > 200) diagnostics.shift(); onDiagnostic(d); };
  const resolveStyle = input => typeof input === 'string' ? styleApi?.getStyle?.(input) : input;
  const basicPipeline = () => ({ render: () => renderer.render(scene, camera), resize() {}, dispose() {} });
  const bindGroup = group => styleApi?.bindSceneStyle?.(group, { style, shared }) || null;
  const prepareGroup = async (group, signal) => {
    (pipeline?.prepareGroup || pipeline?.ink?.prepareGroup)?.call(pipeline?.ink || pipeline, group);
    // compileAsync uses parallel shader compilation when available. Decode may
    // be asynchronous; only one ready group is attached per animation frame.
    if (options.precompile && !signal?.aborted) await renderer.compileAsync(group, camera, scene);
  };
  const releaseGroup = group => (pipeline?.releaseGroup || pipeline?.ink?.releaseGroup)?.call(pipeline?.ink || pipeline, group);
  async function applyStyle(input) {
    const resolved = resolveStyle(input || 'comic');
    if (styleApi && !resolved) throw runtimeError('UNKNOWN_STYLE', 'style', `Unknown style ${input}.`);
    const previous = pipeline;
    const next = styleApi?.createStylePipeline ? await styleApi.createStylePipeline({ renderer, scene, camera, style: resolved, shared, quality: { ...budget } }) : basicPipeline();
    if (!next?.render || !next?.resize || !next?.dispose) { next?.dispose?.(); throw runtimeError('INVALID_STYLE_PIPELINE', 'style', 'Style pipeline requires render/resize/dispose.'); }
    const resume = acquirePause();
    try {
      previous?.dispose(); pipeline = next; style = resolved; observedProfile = undefined;
      pipeline.resize(Math.round(width * renderer.getPixelRatio()), Math.round(height * renderer.getPixelRatio()));
      applyPipelineQuality(pipeline, budget);
      if (streamer) await streamer.rebind(bindGroup, prepareGroup);
      nearDetails?.rebind(bindGroup); renderFailed = false; invalidateSchedule();
    } catch (error) { renderFailed = true; diagnose({ code: 'STYLE_BIND_FAILED', stage: 'style', message: error.message }); throw error; }
    finally { resume(); }
  }
  function resize(w = container.clientWidth, h = container.clientHeight) {
    if (disposed) return;
    width = Math.max(1, Math.round(w || 1)); height = Math.max(1, Math.round(h || 1));
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    pipeline?.resize(Math.round(width * renderer.getPixelRatio()), Math.round(height * renderer.getPixelRatio()));
    invalidateSchedule();
  }
  function setView(view) {
    if (disposed) throw runtimeError('VIEWER_DISPOSED', 'camera', 'Viewer is disposed.');
    applyView(camera, controls, view); invalidateSchedule();
  }
  const getView = () => ({ position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, near: camera.near });
  function fitView() {
    const center = manifest.box.getCenter(new THREE.Vector3()), size = manifest.box.getSize(new THREE.Vector3()), span = Math.max(size.x, size.z, 100);
    setView({ position: center.clone().add(new THREE.Vector3(span * .6, span * .9, span)).toArray(), target: center.toArray() });
    camera.far = Math.max(5000, span * 20); camera.updateProjectionMatrix();
    sun.target.position.copy(center); sun.position.copy(center).add(new THREE.Vector3(-400, 800, 350));
  }
  async function load(url = activeUrl || manifestUrl, { signal, view } = {}) {
    if (disposed) throw runtimeError('VIEWER_DISPOSED', 'manifest', 'Viewer is disposed.');
    if (!url) throw new TypeError('load requires manifestUrl.');
    const epoch = ++loadEpoch; loading?.abort(); const controller = new AbortController(); loading = controller;
    const abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const resolved = new URL(url, document.baseURI).href;
    const requestedAt = performance.now();
    try {
      onProgress({ stage: 'manifest', url: resolved, complete: false });
      let json;
      try { json = await readAsset(resolved, { signal: controller.signal, responseType: 'json' }); }
      catch (cause) { if (controller.signal.aborted) throw new DOMException('Load cancelled', 'AbortError'); throw runtimeError('MANIFEST_REQUEST_FAILED', 'manifest', `Unable to load ${resolved}: ${cause.message}`, { url: resolved, cause }); }
      if (controller.signal.aborted || epoch !== loadEpoch || disposed) throw new DOMException('Load cancelled', 'AbortError');
      const next = normalizeManifest(json, resolved);
      const validity = await adapters.validateSceneManifest?.(json);
      if (validity?.valid === false) throw runtimeError('INVALID_SCENE_MANIFEST', 'manifest', 'Scene manifest validation failed.', { url: resolved, diagnostics: validity.diagnostics });
      // Preserve the old scene if the next manifest cannot be read / validated.
      if (controller.signal.aborted || epoch !== loadEpoch || disposed) throw new DOMException('Load cancelled', 'AbortError');
      await queueOperation(async () => {
        if (controller.signal.aborted || epoch !== loadEpoch || disposed) throw new DOMException('Load cancelled', 'AbortError');
        const resume = acquirePause();
        try {
          const previous = streamer; nearDetails?.dispose(); nearDetails = null; await previous?.dispose();
          if (controller.signal.aborted || epoch !== loadEpoch || disposed) throw new DOMException('Load cancelled', 'AbortError');
          manifest = next; activeUrl = resolved; allLoadedMs = null; firstRenderedMs = firstRenderedAtMs = null; sceneStarted = requestedAt;
          streamer = new ChunkStreamer({ manifest, readAsset, decodeChunk: adapters.decodeChunk, budget, bindGroup, prepareGroup, releaseGroup, onDiagnostic: diagnose, onProgress });
          nearDetails = new NearDetails({ budget, bindGroup, releaseGroup }); root.add(nearDetails.group);
          root.add(streamer.group); fitView(); if (view) setView(view);
          statistics.reset(); gpuTimer.reset(); renderer.renderLists.dispose(); renderFailed = false;
        } finally { resume(); }
      });
      return controllerApi;
    } catch (error) { if (error.name !== 'AbortError') diagnose({ code: error.code || 'MANIFEST_INVALID', stage: error.stage || 'manifest', url: resolved, message: error.message }); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  function frame(time) {
    if (disposed) return;
    animation = requestAnimationFrame(frame);
    if (paused || internalPauses || renderFailed) return;
    controls.update();
    const before = performance.now();
    try {
      const shadows = renderer.shadowMap.enabled && sun.castShadow;
      const profile = observedProfile || renderProfile(pipeline, shadows);
      const context = costContext(camera, profile, sun);
      streamer?.update(camera, height, time, { forceLod: lodMode === 'auto' ? undefined : lodMode === 'full' ? 0 : manifest.chunks[0].lods.length - 1, renderContext: context });
      scheduledRevision = viewRevision;
      const main = streamer?.frameCost(), multiplier = profile.scenePasses + profile.shadowPasses;
      const mainResident = (streamer?.estimatedBytes() || 0) - (streamer?.extraResidentBytes || 0);
      nearDetails?.update(streamer?.current.values() || [], camera, time, budget.visibleTriangles - (main?.triangles || 0), multiplier, { residentBytes: budget.residentBytes - mainResident, drawCalls: budget.drawCalls - (main?.calls || 0) });
      renderer.info.reset(); gpuTimer.begin(time);
      try { observedProfile = renderWithProfile(renderer, pipeline, scene, camera, shadows); } finally { gpuTimer.end(); }
      streamer?.refreshResources(); nearDetails?.refreshResources();
      if (streamer) {
        const near = nearDetails?.stats(); streamer.extraResidentBytes = near?.geometryArrayBytes || 0; streamer.extraTriangles = near?.triangles || 0; streamer.extraCalls = near?.drawCalls || 0; streamer.extraDetails = near?.nearDetails || 0;
        streamer.counters.peakEstimatedResidentBytes = Math.max(streamer.counters.peakEstimatedResidentBytes, streamer.estimatedBytes());
      }
      statistics.record(time, renderer, { cpuFrameMs: performance.now() - before, estimatedResidentBytes: streamer?.estimatedBytes() || 0, chunks: streamer?.current.size || 0 });
      // Whole-frame counters include all scene, shadow and screen-space passes.
      const runtime = streamer?.stats(), calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
      if (firstRenderedMs == null && runtime?.visibleChunks && triangles > 6) { firstRenderedAtMs = performance.now(); firstRenderedMs = firstRenderedAtMs - sceneStarted; }
      if (streamer && lodMode === 'auto' && (calls > budget.drawCalls || triangles > budget.visibleTriangles)) streamer.diagnostic('MEASURED_DRAW_BUDGET', 'Whole-frame renderer counters exceed budget; the next schedule reduces geometric detail.', { drawCalls: calls, triangles });
      if (runtime?.settled && runtime.visibleChunks && allLoadedMs == null) allLoadedMs = performance.now() - sceneStarted;
    } catch (error) { renderFailed = true; diagnose({ code: 'RENDER_FAILED', stage: 'render', message: error.message }); }
  }
  function pointerDown(event) { selectionStart = [event.clientX, event.clientY]; }
  function pointerUp(event) {
    if (!selectionStart || Math.hypot(event.clientX - selectionStart[0], event.clientY - selectionStart[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect(), pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera); const hits = ray.intersectObject(root, true);
    for (const hit of hits) {
      if (!hit.object.visible || !hit.object.parent?.visible) continue;
      const feature = adapters.resolveSelection?.(hit, manifest) || resolveFeature(hit, manifest);
      if (feature) { onSelect({ ...feature, point: hit.point.toArray(), instanceId: hit.instanceId }); return; }
    }
    onSelect(null);
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null; observer?.observe(container);
  const controllerApi = {
    load, resize, setView, getView,
    setStyle(input) { return queueOperation(() => applyStyle(input)); },
    getStats({ raw = false } = {}) { return { schemaVersion: 1, manifestUrl: activeUrl, quality: options.quality || 'balanced', budget: { ...budget }, viewport: { width, height, pixelRatio: renderer.getPixelRatio(), devicePixelRatio: globalThis.devicePixelRatio || 1 }, runtime: streamer?.stats() || null, nearAttachments: nearDetails?.stats() || null, rendering: { ...statistics.snapshot(raw), gpuTime: gpuTimer.snapshot({ raw }) }, firstRenderedMs, firstRenderedAtMs, allLoadedMs, loadRequestedAtMs: sceneStarted, diagnostics: diagnostics.map(d => ({ ...d })), disposed, paused: paused || internalPauses > 0, userPaused: paused, lodMode }; },
    resetStats() { statistics.reset(); gpuTimer.reset(); },
    setLodMode(mode) { if (!['auto', 'full', 'far'].includes(mode)) throw new TypeError('LOD mode must be auto/full/far.'); lodMode = mode; invalidateSchedule(); },
    pause(value = true) { paused = !!value; },
    async whenIdle({ timeoutMs = 30000 } = {}) {
      const deadline = performance.now() + timeoutMs;
      while (!disposed && performance.now() < deadline) {
        if (renderFailed) throw runtimeError('RENDER_FAILED', 'render', 'Rendering stopped; inspect diagnostics.');
        if (scheduledRevision === viewRevision) {
          if (streamer?.hasScheduled && streamer.isSettled()) return;
          const failure = streamer?.getBlockingFailure(); if (failure) throw failure;
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw runtimeError(disposed ? 'VIEWER_DISPOSED' : 'LOAD_TIMEOUT', 'stream', 'Visible scene did not settle before the deadline.');
    },
    exportPNG: opts => queueOperation(() => exportViewerPNG(exportContext(), opts)),
    exportGLB: opts => queueOperation(() => exportViewerGLB(exportContext(), opts)),
    dispose() {
      if (disposal) return disposal;
      disposed = true; ++loadEpoch; loading?.abort(); cancelAnimationFrame(animation); observer?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); controls.removeEventListener('change', invalidateSchedule); controls.dispose();
      disposal = (async () => {
        await sceneOperations.catch(() => {}); nearDetails?.dispose(); await streamer?.dispose(); pipeline?.dispose();
        gpuTimer.dispose(); sun.shadow.dispose(); scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); statistics.reset();
      })();
      return disposal;
    },
  };
  const exportContext = () => ({ renderer, scene, camera, root, manifest, streamer, nearGroup: nearDetails?.group, pipeline, width, height, budget, readAsset, decodeChunk: adapters.decodeChunk, bindGroup, acquirePause, resize, render: () => { renderer.info.reset(); pipeline.render(); }, isDisposed: () => disposed });
  try { resize(); await applyStyle(options.style); animation = requestAnimationFrame(frame); if (manifestUrl) await load(manifestUrl); return controllerApi; }
  catch (error) { await controllerApi.dispose(); throw error; }
}

function resolveFeature(hit, manifest) {
  let city = hit.object.userData.city;
  if (!city) { let parent = hit.object.parent; while (parent && !city) { city = parent.userData.city; parent = parent.parent; } }
  const instance = hit.object.userData.cityInstances?.[hit.instanceId];
  const instanceFeatureId = city?.instanceFeatureIds?.[hit.instanceId];
  const range = hit.object.userData.cityFeatureRanges?.find(r => hit.faceIndex >= r.start && hit.faceIndex < r.start + r.count);
  const attribute = hit.object.geometry?.attributes.cityFeature;
  const renderId = attribute && hit.face ? attribute.getX(hit.face.a) : null;
  const vertexFeatureId = renderId == null ? null : Object.values(manifest.featureIndex || {}).find(f => f.renderId === renderId)?.featureId;
  const featureId = instanceFeatureId || instance?.featureId || vertexFeatureId || range?.featureId || city?.featureId;
  if (!featureId) return null;
  const index = Array.isArray(manifest.featureIndex) ? manifest.featureIndex.find(f => f.featureId === featureId || f.id === featureId) : manifest.featureIndex?.[featureId];
  return { ...city, ...instance, ...range, ...index, featureId };
}
