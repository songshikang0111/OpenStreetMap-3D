# Data, CLI and localhost service

Windows / Node 22+ is the tested environment. Root bin registration belongs to task E. Until integration use `node bin/city.js` in the repository. No additional dependency is needed for data, jobs or HTTP. Web bundling uses the existing Vite dependency; PNG additionally needs Playwright and its Chromium installation.

```powershell
node bin/city.js --help
node bin/city.js init C:/temp/my-city --sample --json
node bin/city.js search '39.909,116.460' --offline --json
node bin/city.js search 'landmark:china-zun' --offline --json
node bin/city.js data import C:/maps/standard-overpass.json --project C:/temp/my-city --json
node bin/city.js build --project C:/temp/my-city --offline --json
node bin/city.js validate --project C:/temp/my-city --offline --json
node bin/city.js studio --project C:/temp/my-city --port 4178 --json
node bin/city.js export web --project C:/temp/my-city --json
node bin/city.js export glb --project C:/temp/my-city --json
node bin/city.js export png --project C:/temp/my-city --json
```

`--sample` creates three explicitly synthetic OSM-shaped elements, with a fixed small area, no network, roof inference off and landscape inference off. It is packaged as code and is not a mislabeled real OSM download. The usual compiler handles it. The working studio defaults to an explicitly registered `sample/` below `--workspace` (default `.city-studio`). `--project` uses that user-selected directory itself as the allowed root.

For a real extract initialize with `--area south,west,north,east`, then `data fetch`. Public config uses named bbox properties. `data fetch` uses one configured Overpass endpoint, complete recursive references, metadata/version output, 32 MiB response limit, 75 s request timeout and at most two retries. Side limit is 5 km; area limit is 16 km². It does not tile requests to bypass those limits. Failed or cancelled refreshes preserve the existing snapshot. An existing valid cache is preferred until `--refresh`; `--offline` never requests the network. Missing references remaining after one bounded completion request are reported. No boundaries are invented. Source/query/retrieval timestamp, content and raw-source hashes, object versions, attribution and ODbL license are recorded in `metadata`.

Standard Overpass JSON, OSM Map JSON `elements`, and legacy `metadata.bbox` JSON are supported. Standard input can take the project area rather than requiring metadata. XML/PBF are explicitly rejected. The legacy Python fetcher remains usable with its old arguments and explicit map-api option; the new product workflow uses Overpass. Its writes now replace atomically and a 429 stops endpoint rotation.

Photon is configurable with `search --photon-url`; coordinate, official landmark IDs and cached results work offline. OSM object URLs resolve through Overpass. Multiple candidates are preserved. Empty results remain empty. Public Nominatim is not a default. Photon has no availability guarantee and throttles extensive use; see [Photon terms](https://photon.komoot.io/). Overpass is a shared service: [resource and rate policies](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), checked 2026-11-03. Endpoint rotation on 429 is not used.

Build and rule update run in Node worker threads. Ctrl+C cancels CLI work. `jobs status|cancel|resume JOB_ID --project path` reads status, requests cancellation or retries a persisted job. A live process owns its queue; another process cannot relabel its jobs interrupted. After a process dies, reopening the queue records interrupted running/queued jobs as failed; explicit resume retries those. A single project's tasks are serialized. Batch concurrency is 1–4, default 1.

```json
{"projects":[{"project":"beijing","kind":"build"},{"project":"kyoto","kind":"build"},{"project":"broken","kind":"build"}]}
```

Run `city batch list.json --concurrency 2 --json`, then `city batch list.json --resume --json` after fixing the failed input. Paths are relative to the list file. Successes are not run again on resume. Exit code 2 means partial/failed batch, 130 cancelled, 1 other failure, 0 success. JSON stdout contains one envelope with `schemaVersion,status,artifacts,diagnostics`; progress goes to stderr.

Project origin is fixed after init. Locks record config, normalized data, exact source file, engine source, recipe, style and asset hashes. Build time/report are separate from deterministic content hashes. Ordinary build never requests latest rules or data. Recipe install accepts a local directory of declarative JSON files (or `{recipes:[]}`), validates protocol compatibility, copies content-addressed JSON into `rules/packages/`, records previous package sets and marks dependent stages dirty. `landmarks update <dir>` runs the full compiler after updating; `--rollback` selects the previous set and rebuilds. No downloaded code or shell text executes.

The service exports `createLocalServer` from `src/local-server/index.js`. Responses use the CLI envelope plus `candidates`, `projects`, `project`, or `job`. Project objects contain `{id,relativePath,config}`. All §12.5 routes are implemented. Job submissions accept `{kind,parameters:{...}}` and the studio client's flat `{kind,...parameters}`; resume accepts a job ID or `true` for the latest failed/cancelled job of the same project/kind. An additional `POST /api/projects/:id/import` accepts a workspace-relative JSON path. `GET /projects/:id/site/...` serves a built web export.

Only loopback binding is accepted. Host and Origin are checked, writes require JSON, request bodies are limited, absolute/traversal/symlink project paths are rejected. Static routes serve registered dist/site files. `studio/dist` is served when installed; otherwise an actual `studio/index.html` is transformed by Vite source middleware. Missing studio/compiler/SDK dependencies return explicit failure. The production SDK does not call this service.

Web exports bundle the SDK with Vite and copy only the built scene (no source snapshot, cache or build lock). Asset URLs are relative for nested hosting. GLB reads every chunk's highest-triangle LOD; it preserves available geometry/standard materials, and reports procedural/postprocessing limits. PNG captures a 1280×720 SDK overview with visible-region scope and persistent OSM attribution; full browser validation belongs to integrated A/D/E. Do not report those exports passed from dependency-injected tests.
