# Contributing

Thanks for helping. City Ink turns OpenStreetMap into an embeddable, restylable 3D city layer. Read
[AGENTS.md](AGENTS.md) (rules for humans and coding agents alike), the [README](README.md) and the
[phase-two plan](docs/phase2/README.md) before larger changes. 中文读者：规格文档主要为中文，见 `docs/phase2/`。

## Set up and test (about ten minutes)

Node 22.11+ and Chrome or Edge (for browser checks).

```sh
npm ci
npm test                 # all root tests (phase one and phase two)
npm run test:packages    # builds and tests every workspace package
npm run test:types       # strict type checks of the public examples
npm run format:check     # Prettier, line width 120
npm run build
```

Browser checks need the demo build: `npm run demo:tiles && npm run build:demo`, then for example
`node scripts/benchmark-tiles/map-checks.mjs`. Headless Chrome uses a software renderer unless you set
`CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist"`. To look at the result:
`node scripts/benchmark-tiles/style-shots.mjs /tmp/shots` (screenshots stay outside the repository).

## Where things live

| Package | Responsibility |
| --- | --- |
| `packages/tiles` | Tile format, codec, Mercator math, tileset validation (no runtime dependencies) |
| `packages/generators` | Deterministic geometry from planned features, identical in Node and Workers |
| `packages/builder` | JSON/PBF ingest, planning cells, cutting, encoding, `city tiles` CLI |
| `packages/map` | `createMap`, streaming, workers, picking, overlays, MapLibre layer |
| `packages/styles` | StyleSpec, default styles, facade shader, phase-one style descriptors |
| `packages/styles-ink` | Comic, line, colour, clay and cel looks for `createMap` |
| `packages/details` | Optional street details and site completion |
| `packages/landmarks` | Official landmark recipes |
| `src/`, `studio/`, `bin/` | Phase-one toolchain (scene packages, studio, CLI), still supported |

New package code is strict TypeScript in `packages/<name>/src`. Some phase-one modules in `src/` are shared through
`.d.ts` type boundaries (decision E4 in [08](docs/phase2/08-risks-and-decisions.md)).

## A good first change

Pick one from [docs/phase2/starter-issues.md](docs/phase2/starter-issues.md). Each lists the files to touch and the
command that proves it works.

## Rules

- Determinism: the same input and options give byte-identical tiles; ids come from OSM, never from traversal order.
  Run the builder tests (`node --test test/phase2-builder.test.js`) after touching planning or cutting.
- Provenance: anything estimated is `inferred`; never present inferred data as real.
- Public interface changes update types, schemas, examples and docs together.
- Performance claims come from real-browser whole-frame statistics with the GPU named; Node timings are not GPU
  evidence. Untested platforms are "unverified".
- Do not commit generated tiles, downloaded data, screenshots or caches. Evidence is text or JSON under 200 KB.
- Keep OSM attribution and the ODbL/MIT split ([DATA_LICENSE.md](DATA_LICENSE.md)).
- When a specification and reality disagree, add a decision record to
  [08 section 4](docs/phase2/08-risks-and-decisions.md) before changing behaviour.
- Commit each substantial change with a clear message (conventional commits, English) after running the matching
  checks; stage only your own files. `git config blame.ignoreRevsFile .git-blame-ignore-revs` hides the formatting
  commit in blame.
