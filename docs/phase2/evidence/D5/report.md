# MapLibre padding, GPU picking and map isolation

Chrome 158.0.8127.36, MapLibre GL JS 6.16.0, Linux, AMD Ryzen 7 7840S / Radeon 780M. The base commit was `60cace3`. Tests used the Beijing CBD sample and headless Chrome with ANGLE EGL.

- Six camera configurations covered left 200 px, top 100 px, mixed insets on all sides, removing padding, resizing and host pixel ratios of 1, 1.5 and 2. At 58° pitch and 27° bearing, the largest difference from the host projection across 3,702 visible building outline vertices was 0.000000011 CSS px. At zero pitch, two successive GPU picks at the host-projected tower centre returned `way/599547918` in each configuration. Host canvas backing sizes matched before and after drawing, including 1022 × 677 for a 681 × 451 CSS viewport.
- Two standalone maps drew the same highlighted fill using different styles. The centre pixels were (255, 17, 17) and (17, 255, 17). After disposing the second map, the first map drew the same red pixel.
- Forcing WebGL context creation to fail left the standalone container empty with its original positioning. A second creation in that container succeeded. Both a synchronous MapLibre attachment failure and a pre-existing `ready()` waiter reported the error. The same layer then attached to the original, working host context.
- The existing AC801–AC806 checks passed, including a separate 50-camera outline comparison, host label occlusion, and removing the layer while preserving the host image.

The additional WP-E run matched all 100 CPU/GPU picks. AC502 recorded a 5.3 ms p95 against its 4 ms threshold. All AC503 visibility, colour and reload checks passed, but the sampled geometry count changed from 53 to 35 during that run, failing its equal-count check. The preceding run observed 53 to 53, with a 4.3 ms pick p95. AC504–AC509 passed. [WP-E observations](./overlay-checks.json)

[Targeted browser observations](./map-isolation.json) · [WP-H checks](./maplibre-checks.json)

To reproduce from the repository root:

```sh
npm ci
npm run build:packages
node --test test/phase2-map.test.js
npm run demo:tiles
npm run build:demo
npm run build:map-bundle
export CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'
node scripts/benchmark-tiles/map-isolation.mjs
node scripts/benchmark-tiles/maplibre-checks.mjs
```
