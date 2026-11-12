# Roadmap

Status on 2026-11-13. Milestones and acceptance criteria are defined in
[docs/phase2/09-work-packages.md](docs/phase2/09-work-packages.md); evidence per work package is in
`docs/phase2/evidence/`.

| Milestone | Content | Status |
| --- | --- | --- |
| M0 Foundation | Workspaces, formatting, positioning, naming candidates | Done (WP-A) |
| M1 Tiles | Tile format 1.0, generators, small-area builds | Done except generation time (AC312, see E5/E11) |
| M2 Map runtime | `createMap`, camera, streaming, workers, picking, overlays | Done on a non-reference device; reference devices pending (D5) |
| M3 Whole city | PBF ingest, whole-city builds, MapLibre layer | MapLibre layer done; PBF ingest done; whole-city build too slow (WP-F) |
| M4 Styles | StyleSpec, plain/light/dark, ink looks, provenance filter | Done (WP-G) |
| M5 Release | Mobile performance, npm packages, hosted demo, English docs | Docs drafted; publishing, hosting and device tests wait for decisions D1, D2, D5, D8 |

## Next

1. Whole-city builds: per-cell ingest from a PBF feature store (no global parse), parallel cells, archive format.
2. Generation time: typed phase-one mesh writer, near-only facade trims, worker scheduling (target 120 ms p95 on
   desktop).
3. Reference-device performance runs (desktop and two phones) once devices are chosen (D5).
4. Visual parity with phase one: detailed tree crowns, roof-equipment LOD, parking and court markings.
5. Release: package names (D1), demo hosting (D2), prebuilt example cities (D7), publishing (D8).

## Later (not promised in phase two)

Text labels, terrain (DEM), external building-height datasets, native mobile wrappers, WebGPU.
