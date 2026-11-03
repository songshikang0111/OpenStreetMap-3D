import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalizeManifest, fetchAsset } from '../src/runtime/manifest.js';
import { createBudget, projectChunks, chooseLod, budgetPlan } from '../src/runtime/policy.js';
import { ResourceRegistry } from '../src/runtime/resources.js';
import { ChunkStreamer } from '../src/runtime/streamer.js';
import { FrameStatistics } from '../src/runtime/statistics.js';
import { encodeFixture, decodeFixture } from '../examples/embed/fixture-codec.js';
import { exportViewerGLB, exportViewerPNG } from '../src/sdk/exports.js';

function manifest(count = 1) {
  return normalizeManifest({ schemaVersion: 1, bounds: [-100, 0, -100, count * 100, 50, 100], chunks: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, contentBounds: [i * 100 - 50, 0, -50, i * 100 + 50, 50, 50], transform: { translation: [0, 0, 0] }, lods: [0, 1, 2].map(level => ({ level, uri: `nested/${i}-${level}.bin`, bytes: (3 - level) * 1000, triangles: (3 - level) * 100, drawCalls: 3 - level, nearDetails: level === 0 ? 30 : 0, minScreenPixels: level === 0 ? 800 : 200 })) })) }, 'https://example.test/cities/site/manifest.json');
}
function camera(position = [0, 150, 250], target = [0, 0, 0]) { const c = new THREE.PerspectiveCamera(45, 1280 / 720, .1, 10000); c.position.fromArray(position); c.lookAt(...target); c.updateMatrixWorld(true); return c; }
function box() { const g = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); mesh.userData.city = { featureId: 'way:7', sourceIds: ['way:7'], materialRole: 'wall' }; g.add(mesh); return g; }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle(stream, c, forceLod = 0) { for (let i = 0; i < 60; i++) { stream.update(c, 720, stream.now(), { forceLod }); await tick(); if (stream.isSettled()) return; } throw new Error('Stream did not settle'); }
function stream(options = {}) { return new ChunkStreamer({ manifest: manifest(), readAsset: async () => new ArrayBuffer(8), decodeChunk: () => box(), budget: createBudget({ minResidenceMs: 0, unloadDelayMs: 0 }), ...options }); }

test('manifest URI resolution uses the manifest directory, validates corruption/version/identity', () => {
  assert.equal(manifest().chunks[0].lods[0].url, 'https://example.test/cities/site/nested/0-0.bin');
  assert.throws(() => normalizeManifest({ schemaVersion: 2 }, 'https://example.test/a'), { code: 'UNSUPPORTED_SCENE_VERSION', stage: 'manifest' });
  assert.throws(() => normalizeManifest({ schemaVersion: 1, chunks: [] }, 'https://example.test/a'), { code: 'INVALID_MANIFEST' });
  const m = manifest(); m.chunks[0].lods[0].bytes = NaN;
  assert.throws(() => normalizeManifest(m, 'https://example.test/a'), { code: 'INVALID_LOD' });
});
test('CSS screen size responds to distance, FOV, viewport and hysteresis', () => {
  const m = manifest(), b = createBudget({ minResidenceMs: 0 }), c = camera();
  const p = projectChunks(m.chunks, c, 720)[0], big = projectChunks(m.chunks, c, 1440)[0];
  assert.equal(big.pixels, p.pixels * 2);
  c.fov = 25; c.updateProjectionMatrix(); assert(projectChunks(m.chunks, c, 720)[0].pixels > p.pixels);
  const near = { ...p, pixels: 810 }, state = { index: 1, since: 0 };
  assert.equal(chooseLod(near, state, b, 1000), 1);
  assert.equal(chooseLod({ ...near, pixels: 1000 }, state, b, 1000), 0);
  assert.equal(chooseLod({ ...near, pixels: 700 }, { index: 0, since: 0 }, b, 1000), 0);
  assert.equal(chooseLod({ ...near, pixels: 600 }, { index: 0, since: 0 }, b, 1000), 1);
  assert.equal(chooseLod({ ...near, pixels: 2000 }, { index: 2, since: 900 }, createBudget(), 1000), 2);
});
test('view frustum uses content bounds, and budgets downgrade while retaining every visible chunk', () => {
  const m = manifest(3), c = camera([100, 200, 500], [100, 0, 0]), p = projectChunks(m.chunks, c, 720);
  assert.equal(p.filter(p => p.visible).length, 3);
  const b = createBudget({ residentBytes: 3000, visibleTriangles: 300, drawCalls: 3, nearDetails: 0, minResidenceMs: 0 });
  const plan = budgetPlan(p.map(p => ({ ...p, pixels: 2000 })), new Map(), b, 1000);
  assert.equal(plan.requests.length, 3); assert(plan.requests.every(r => r.index === 2)); assert.equal(plan.unavoidable, false);
  assert.equal(budgetPlan(p, new Map(), { ...b, residentBytes: 1 }, 1000).unavoidable, true);
  c.lookAt(100, 200, 2000); c.updateMatrixWorld(true); assert(projectChunks(m.chunks, c, 720).every(p => !p.visible));
});
test('registry refcounts shared geometry, material, uniform texture and instance buffers', () => {
  const registry = new ResourceRegistry(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture(), material = new THREE.ShaderMaterial({ uniforms: { map: { value: texture } } });
  let geometryDisposes = 0, materialDisposes = 0, textureDisposes = 0;
  geometry.addEventListener('dispose', () => geometryDisposes++); material.addEventListener('dispose', () => materialDisposes++); texture.addEventListener('dispose', () => textureDisposes++);
  const a = new THREE.Group(), b = new THREE.Group(); a.add(new THREE.InstancedMesh(geometry, material, 3)); b.add(new THREE.Mesh(geometry, material));
  const ar = registry.retain(a), br = registry.retain(b); assert.equal(registry.stats().geometries, 1); assert(registry.stats().geometryArrayBytes > 192);
  registry.release(ar); assert.equal(geometryDisposes, 0); registry.release(br); assert.equal(geometryDisposes, 1); assert.equal(materialDisposes, 1); assert.equal(textureDisposes, 1); assert.equal(registry.refs.size, 0);
});
test('independent registries protect a shared live style texture during export and keep source bitmap ownership external',()=>{
  const a=new ResourceRegistry(),b=new ResourceRegistry(),texture=new THREE.Texture(),group=new THREE.Group();let disposed=0,closed=0;
  texture.userData.cityOwnsImage=true;texture.source.data={width:16,height:16,close(){closed++;}};texture.addEventListener('dispose',()=>disposed++);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map:texture})));
  const ar=a.retain(group),br=b.retain(group);b.release(br);assert.equal(disposed,0);assert.equal(closed,0);a.release(ar);assert.equal(disposed,1);assert.equal(closed,0);
});
test('atomic LOD replacements retain coverage, restore near geometry and release old resources', async () => {
  const s = stream(); const c = camera(); await settle(s, c, 2);
  const old = s.current.get('c0').group; assert.equal(s.current.get('c0').index, 2);
  s.update(c, 720, 5000, { forceLod: 0 }); assert.equal(s.current.get('c0').group, old);
  await settle(s, c, 0); assert.equal(s.current.get('c0').index, 0); assert.equal(old.parent, null); assert.equal(s.stats().geometries, 1); assert(s.counters.swaps > 0);
  await s.dispose(); assert.equal(s.registry.refs.size, 0);
});
test('five round trips and reloads return to a stable resident baseline', async () => {
  const s = stream(), c = camera(), away = camera([0, 100, 5000], [0, 100, 9000]), baselines = [];
  for (let i = 0; i < 5; i++) { await settle(s, c); baselines.push(s.stats().geometryArrayBytes); s.update(away, 720); assert.equal(s.stats().currentChunks, 0); assert.equal(s.registry.refs.size, 0); }
  assert(baselines.every(n => n === baselines[0])); assert(s.counters.loads >= 10); await s.dispose();
});
test('stale requests abort and ignored cancellation still respects actual concurrency', async () => {
  const deferred = []; let active = 0, peak = 0;
  const s = stream({ manifest: manifest(4), budget: createBudget({ concurrentLoads: 2, unloadDelayMs: 0, minResidenceMs: 0 }), readAsset: (_url, { signal }) => { active++; peak = Math.max(peak, active); return new Promise(resolve => deferred.push({ signal, resolve: () => { active--; resolve(new ArrayBuffer(8)); } })); } });
  const c = camera([150, 500, 800], [150, 0, 0]); s.update(c, 720); assert.equal(active, 2);
  s.update(camera([0, 100, 5000], [0, 100, 9000]), 720); assert(deferred.every(d => d.signal.aborted)); s.update(c, 720); assert.equal(active, 2);
  for (const d of deferred) d.resolve(); await tick(); assert.equal(peak, 2); await s.dispose(); assert.equal(s.current.size, 0);
});
test('asset failure diagnostics include resolved URL and bounded retries', async () => {
  const diagnostics = []; let now = 0;
  const s = stream({ now: () => now, readAsset: async () => { throw new Error('offline'); }, onDiagnostic: d => diagnostics.push(d) });
  for (let i = 0; i < 8; i++) { s.update(camera(), 720); await tick(); now += 2000; }
  assert.equal(s.counters.failures, 2); assert.equal(diagnostics[0].stage, 'asset'); assert(diagnostics[0].url.startsWith('https://example.test/cities/site/nested/')); await s.dispose();
});
test('a failed offscreen chunk cannot poison idle state after the camera moves to healthy coverage or empty sky',async()=>{
  let now=0;
  const s=stream({manifest:manifest(2),now:()=>now,readAsset:async url=>{if(url.includes('/0-'))throw new Error('Broken first chunk');return new ArrayBuffer(8);}});
  const first=camera([-45,25,60],[-45,25,-40]),second=camera([145,25,60],[145,25,-40]);
  for(let i=0;i<4;i++){s.update(first,720,now);await tick();now+=1200;}
  assert.equal(s.getBlockingFailure()?.code,'ASSET_REQUEST_FAILED');
  await settle(s,second,2);assert.equal(s.getBlockingFailure(),null);assert.equal(s.isSettled(),true);assert(s.current.has('c1'));
  s.update(camera([0,100,5000],[0,100,9000]),720,now);assert.equal(s.getBlockingFailure(),null);assert.equal(s.isSettled(),true);await s.dispose();
});
test('corrupt hash and decoder failures preserve diagnostic stages and clean decoded resources', async () => {
  const m = manifest(); m.chunks[0].lods[2].hash = '0'.repeat(64); const errors = [];
  const s = stream({ manifest: m, onDiagnostic: d => errors.push(d) }); s.update(camera(), 720); for(let i=0;i<10&&!errors.length;i++)await tick();
  assert.equal(errors[0].code, 'ASSET_HASH_MISMATCH'); assert.equal(errors[0].stage, 'decode'); await s.dispose();
  const fail = stream({ decodeChunk: () => { throw new Error('invalid geometry'); }, onDiagnostic: d => errors.push(d) }); fail.update(camera(), 720); await tick(); assert.equal(errors.at(-1).code,'ASSET_DECODE_FAILED'); await fail.dispose();
});
test('style rebinding and failed style setup release replaced decoder resources', async () => {
  const s = stream(); await settle(s, camera()); let disposed = 0;
  await s.rebind(group => { group.children[0].material = new THREE.MeshBasicMaterial(); return { dispose() { disposed++; } }; });
  assert.equal(s.registry.stats().materials,1); await s.dispose(); assert.equal(disposed,1); assert.equal(s.registry.refs.size,0);
  const bad=stream({bindGroup:()=>{throw new Error('style failed');}});bad.update(camera(),720);await tick();assert.equal(bad.registry.refs.size,0);await bad.dispose();
});
test('fixture binary roundtrip preserves geometry, metadata, instances and attributes', () => {
  const g=box(), mesh=g.children[0];mesh.geometry.setAttribute('aFacade',new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count*4).fill(3),4));
  const inst=new THREE.InstancedMesh(mesh.geometry,mesh.material,2);inst.userData.cityInstances=[{featureId:'tree:1'},{featureId:'tree:2'}];g.add(inst);
  const decoded=decodeFixture(encodeFixture(g));assert.deepEqual(decoded.children[0].userData.city,mesh.userData.city);assert.equal(decoded.children[0].geometry.attributes.aFacade.getX(0),3);assert.equal(decoded.children[1].count,2);assert.equal(decoded.children[1].userData.cityInstances[1].featureId,'tree:2');
});
test('whole-frame counters and percentile definitions include all passes', () => {
  const stats=new FrameStatistics(),r={info:{render:{calls:17,triangles:900,lines:0,points:0},memory:{geometries:3,textures:6}}};
  for(const t of [0,16,32,52,112])stats.record(t,r);
  const s=stats.snapshot(true);assert.equal(s.intervalsMs.p50,16);assert.equal(s.intervalsMs.p95,60);assert.equal(s.longFrames50ms,1);assert.equal(s.drawCalls.p50,17);assert.equal(s.frames.length,4);assert.equal(s.gpuTime.available,false);
});
test('raw statistics retain the initial physical frame independently of FPS intervals and clear it on reset',()=>{
  const stats=new FrameStatistics(),renderer={info:{render:{calls:1201,triangles:600001,lines:0,points:0},memory:{geometries:3,textures:0}}};
  stats.record(100,renderer,{estimatedResidentBytes:8000,bodyNearDetails:2,nearAttachmentDetails:3,totalNearDetails:5,nearGeometryArrayBytes:2000});
  renderer.info.render.calls=10;renderer.info.render.triangles=100;stats.record(116,renderer);
  const raw=stats.snapshot(true);assert.equal(raw.initialFrame.drawCalls,1201);assert.equal(raw.initialFrame.triangles,600001);assert.equal(raw.initialFrame.intervalMs,null);assert.equal(raw.initialFrame.totalNearDetails,5);assert.equal(raw.frameCount,raw.frames.length+1);assert.equal(raw.intervalsMs.p95,16);
  raw.initialFrame.drawCalls=0;assert.equal(stats.snapshot(true).initialFrame.drawCalls,1201);
  stats.reset();assert.equal(stats.snapshot(true).initialFrame,null);assert.deepEqual(stats.snapshot(true).frames,[]);
});
test('GLB export requires explicit scope and rejects complete budget overflow before loading', async () => {
  const ctx={isDisposed:()=>false,manifest:manifest(2),budget:{residentBytes:1},readAsset:()=>{throw new Error('must not fetch');}};
  await assert.rejects(exportViewerGLB(ctx),{code:'EXPORT_SCOPE_REQUIRED'});await assert.rejects(exportViewerGLB(ctx,{scope:'complete'}),{code:'EXPORT_RESOURCE_BUDGET'});
});
test('nonfinite export limits cannot bypass the PNG or complete GLB resource caps',async()=>{
  const ctx={isDisposed:()=>false,manifest:manifest(),budget:{residentBytes:1000000},readAsset:()=>{throw new Error('must not fetch');}};
  await assert.rejects(exportViewerPNG(ctx,{width:50000,height:50000,maxPixels:NaN}),{code:'EXPORT_PIXEL_BUDGET'});
  await assert.rejects(exportViewerGLB(ctx,{scope:'complete',maxBytes:NaN}),{code:'EXPORT_RESOURCE_BUDGET'});
  await assert.rejects(exportViewerGLB(ctx,{scope:'complete',maxBytes:Infinity}),{code:'EXPORT_RESOURCE_BUDGET'});
});
