# Root independent geometry revalidation — passed reviewed CPU scope

Date:2026-11-03. Reviewer:/root/acceptance_geometry. Accepted integrated HEAD:55862f0a2649fb9289331c9ea19b2325f35f3037. Product fix:e11990c, cherry-pick of A3b62b40281c116352dd8bd379cb22331d026f2df.55862f0 adds core evidence only; git diff e11990c..55862f0 is empty for src,schemas,source snapshots and package files. The runner also requires the five actual repair patches in integrated history and an exact core diff against A3b62b40.

Final run:`final-runs/2026-11-03T15-08-52-090Z-55862f0a2649/summary.json`, statuspass. HEAD before/after55862f0; every recorded source/Schema/package/fixture/input SHA-256 before/after is identical. Windows x64,Nodev22.11.0. Execution was read-only against product source and used the root-authorized CPU window before GPU measurement. No full suite/build, browser or GPU work was performed by this reviewer.

## Closed findings and exact results

- Transformed external recipes: low/medium/high preserve parent/reflection matrices, reverse multi-material slot order, authored role groups, normalized attributes, object identities/sources, repeated instances and meshPerAttribute2. Atomic copies preserve every claimed feature ID. Pass.
- Mixed LOD: original53 ground combinations and53 all-road-top combinations, unchanged sampled region and locations, all have0 holes/overlaps. Original400 bridge external-wall samples pass every single-chunk upgrade. Water per-chunk triangles/IDs remain invariant across levels. Pass.
- Exact grid planes: x=0 andz=0 vertical surfaces use one half-open owner side,32m² total,16m² per cell; two triangulations,16 mixed patterns per axis×320 interior points remain singly covered. UV/normalized scalar/feature/role/objectId continuity passes.
- Rounded boundary P1: unchanged external-wall reproduction now emits32m² rather than16m²; old missing interior point is8.1124e-26m from retained geometry. For the actual guardrail fixture, unrounded one/four-tile areas are both3480.494275995952m², absolute and relative difference0. All source-face centroids, including the formerly missing eight endcap triangles, are within1.1371e-12m of retained geometry;0 source faces exceed1cm. The1/4/16 high guardrail area check also passes without widening its original threshold. Old failed JSON and final-run directory remain untouched.
- Fixed1/4/16 synthetic continuity: all7 building bodies and349 trees remain represented at all three LODs; whole-feature/instance geometry and attributes hash identically. Shared-surface areas and extents remain equivalent, including the restored guardrail endcaps. The review permits valid surface retessellation; it does not demand identical triangles for clipped surfaces.
- Near contract: ordinary detail/near meshes count1, instances count by active count; hidden/body objects are excluded, core/runtime counters agree, false and invalid metadata are rejected and legacy omission works. Same-facing overlapping slab shells retain their outward envelope. Pass.

## Four source-internal building identities

The proof is geometric rather than an arbitrary missing-object exemption. Both official input hashes/configurations were verified. Each source footprint has empty polygon difference against its named enclosure, and its full height interval lies inside that enclosure. The actual envelope has0 exposed wall spans/roof polygons/required bottom polygons. Removing the enclosure produces4..22 wall spans,1 roof and30..174 low vertices, while the covered object has0 vertices. Each identity and source remains in featureIndex.

Beijing grow4:w547523487 (161..234m) andw548126517 (0..234m) lie inside r7820447-0 (0..245m). Kyoto grow9:w879306473 (0..9.3m) andw879306475 (0..6.2m) lie inside w879306476 (0..24.8m). Actual retained enclosure triangles are checked by per-vertex cityFeature in every LOD, not merely featureIds metadata. The final proof reads fresh A3b62b40 assets fromwork/core-repair-boundary-frozen. Full per-object results:`identity-proof-results.json` in the accepted final run.

## Scope and replay

No open CPU geometry/protocol defect remains in the reviewed scope. This supplies bounded independent evidence for AC09/10/11/12/14/16 and closes the previously reported source/coverage defects; final visual old-feature comparison, actual shaders, twelve-case browser performance and resource round trips belong to root/E. This report does not declare AC01–AC27 overall passed.

Replay from the repository checkout:

`node work/root-remediation-geometry/run-final-geometry.mjs --run --assets-root=<directory of the two official frozen/regenerated cases>`

Use `final-archive-index.json` as the root archive entry point. It references the accepted run's complete script/raw/source-hash manifest and the preserved failed run/finding/reproduction evidence. `runner-before-rounded-boundary-fix.mjs` preserves the runner bytes recorded in the old failed archive. Root owns copying this review evidence into docs and committing it; the reviewer changed no product files and made no commit.
