# Roadmap

Local integration status on 2026-11-26. The milestone reports link each acceptance criterion to its verification and record the remaining gaps.

| Milestone | Current result |
| --- | --- |
| [M0 · Foundation](docs/phase2/evidence/M0-acceptance.md) | Local Linux tooling, package installation, types and builds verified. Hosted Windows and Linux CI runs remain unverified. |
| [M1 · Tiles](docs/phase2/evidence/M1-acceptance.md) | OSM inputs, deterministic tiling, building massing and cross-runtime geometry checks implemented. Dense tiles exceed the 60 ms Node generation target. |
| [M2 · Map runtime](docs/phase2/evidence/M2-acceptance.md) | Camera, streaming, picking, cancellation, markers, overlays and resource round trips verified on the local desktop. |
| [M3 · Whole city](docs/phase2/evidence/M3-acceptance.md) | PBF indexing, parallel neighbourhood planning, checkpointed builds, polygon regions, single-file HTTP range archives and MapLibre layers implemented. City measurements and regional scale limits are recorded separately. |
| [M4 · Styles](docs/phase2/evidence/M4-acceptance.md) | Default, ink and external styles, provenance filters and material switching verified on the local desktop. |
| [M5 · Release](docs/phase2/evidence/M5-acceptance.md) | Five local city samples, static demo, empty-directory package installs and onboarding verified. Desktop performance gaps, mobile device tests and release decisions remain open. |

The [performance summary](docs/phase2/evidence/perf-summary.md) records whole-frame measurements. Publishing, public hosting and the archive of historical repository data require the decisions in [phase-two risks and decisions](docs/phase2/08-risks-and-decisions.md).

## Later

Text labels in the standalone map, terrain (DEM), external height datasets, native mobile wrappers and WebGPU are outside the phase-two plan.
