# Independent Web SDK embed

This example loads static scene assets through `src/sdk/index.js`. It uses neither the old demonstration entry point nor studio HTTP endpoints. The default is an actual CINK scene compiled by the phase-one core and bound to the official styles.

```powershell
node --expose-gc scripts/benchmark-runtime/build-scenes.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort
```

Open `http://127.0.0.1:5184/examples/embed/`. Select another generated scene with `?fixture=core-kyoto-gion-grow-4`, or provide `?manifest=../../my-scene/manifest.json`. Resource URIs resolve relative to that manifest, including under nested static hosting paths.

```js
import { createCityViewer } from './src/sdk/index.js';
const viewer = await createCityViewer({
  container: document.querySelector('.my-canvas'),
  manifestUrl: './city/manifest.json',
  style: 'comic', quality: 'balanced',
  budget: { residentBytes: 128 * 1024 * 1024, concurrentLoads: 3 },
  onSelect: feature => console.log(feature?.featureId, feature?.sourceIds),
  onDiagnostic: diagnostic => console.warn(diagnostic),
});
viewer.setView({position:[300,300,500],target:[0,20,0],fov:45});
await viewer.setStyle('color');
await viewer.whenIdle();
const stats = viewer.getStats();
const png = await viewer.exportPNG({width:1600,height:900});
const glb = await viewer.exportGLB({scope:'complete'});
await viewer.dispose();
```

Use a bundler or import map for Three.js. Root package exports are owned by integration task E; this source entry requires the integrated core/style modules. `readAsset(url,{signal,responseType})` can supply a cache or custom transport; return parsed JSON for `json`, ArrayBuffer for `arrayBuffer`, and honor AbortSignal. All errors report the resolved URL and stage. The optional `adapters` object exists for codec/style testing and external integrations; ordinary consumers do not need it.

`load` replaces a scene only after reading and validating the next manifest. `resize`, `getView`, `setView`, `getStats`, `resetStats`, `pause`, `whenIdle`, and `dispose` manage an embedded viewer. `quality` accepts draft/low, balanced, high or explicit budget fields. `setLodMode('full'|'far'|'auto')` is an explicit diagnostic override; full/far bypass automatic LOD budget reduction and should be used for controlled comparisons. Types are in `src/sdk/index.d.ts`.

PNG captures the current camera and loaded LODs, includes source attribution, has a 16 megapixel cap and restores the viewport afterward. GLB requires an explicit scope: `loaded` includes all currently resident chunks plus current camera-dependent near attachments; `complete` independently loads every manifest chunk at the requested detail index (0 = highest). Complete export refuses its resource estimate limit rather than producing a partial file. It includes persisted geometry, not all possible camera-dependent window/tree attachments. Procedural shaders and postprocessing are represented only by standard colors/materials; the returned result includes this limitation and chunk IDs. Neither export automatically downloads a file; the caller receives a Blob.

LOD uses world content bounds, screen-space error in CSS pixels, FOV, viewport, hysteresis and residence time. Budget order removes near accessories and simplifies less prominent chunks, retaining coarse coverage. Oversized minimum coverage and atomic replacement headroom have explicit diagnostics. `getStats().rendering` counts the whole frame including every shadow/postprocessing pass. CPU array bytes and manifest resident estimates are labelled; they are not measured VRAM. GPU time is explicitly unavailable. Mobile devices and other browsers require separate measurement.

Reproduce the standalone production/non-root browser check:

```powershell
node scripts/benchmark-runtime/build-embed.mjs
$env:CITY_BENCHMARK_BROWSER = 'absolute/path/to/chromium.exe' # optional if Playwright browser installed
node scripts/benchmark-runtime/check-browser.mjs
node scripts/benchmark-runtime/run.mjs --seconds=60
```

Playwright is a test-only dependency (install locally with `npm install --no-save --package-lock=false playwright` until E adds the root test tooling). Raw per-frame results, fixed camera keys, cold/warm statistics, same-view full/far controls, five resource round trips and machine/WebGL identity are written to `docs/phase1-evidence/runtime`. The separately labelled `build-fixtures.mjs` / `fixture-codec.js` are synthetic/legacy adapter fixtures, not production CINK or proof of core integration.

`cold-start.mjs` collects fresh-context startup markers after rendering; `report.mjs` generates the complete performance table. `runtime.firstUsableMs` is the earlier first-attachment marker; use top-level `firstRenderedMs`/`firstRenderedAtMs` for the first geometry-containing frame submitted by all passes. They are browser/CPU markers, not GPU/display-completion timings.

The measured 900000-triangle preset has an explicit coverage limit: Beijing/Kyoto 9-block lowest LOD still exceeds that draw budget, even though this RTX4090 run meets the frame-latency target. Handle `COVERAGE_EXCEEDS_BUDGET` in the host UI and reduce area or select a deliberate higher budget. Full-frame measurements, all long frames and this limitation remain in the report.

Strict type consumption, including the official A/C adapters, is checked by `examples/embed/typecheck.ts` using TypeScript and matching Three.js typings:

```powershell
node node_modules/typescript/bin/tsc --noEmit --strict --moduleResolution NodeNext --module NodeNext --target ES2022 --lib ES2022,DOM examples/embed/typecheck.ts
```
