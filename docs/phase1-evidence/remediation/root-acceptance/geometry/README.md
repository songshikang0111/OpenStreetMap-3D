# Geometry acceptance archive

This folder preserves the independent CPU geometry review at integrated55862f0 (producte11990c, source freeze3b62b40281c116352dd8bd379cb22331d026f2df), its original failedb40e604 run, the unchanged exterior-wall reproduction and actual missing guardrail faces. It does not claim browser/GPU performance acceptance.

`final-archive-index.json` is the historical evidence index. `staging-manifest.json` records each copied file, recorded SHA checks and the18 top-level files needed for canonical replay:12 checks, the original runner and its inputs/archive helpers. The old failed manifest's `run-final-geometry.mjs` hash refers to `runner-before-rounded-boundary-fix.mjs`; `historicalPathAlias` records this alias without rewriting the original manifest. Historical generated scripts contain the original machine's absolutefileURLs as现场记录. Do not execute those generated scripts fromdocs.

## Replay after the formal GPU measurement has finished

Use the installed repository dependencies and the frozen product source. First generate the two official input cases at the currentHEAD, or provide existing correct3b62b40 frozen assets. From the repository root:

```powershell
node scripts/phase1-build-cases.mjs work/root-remediation-geometry-assets beijing-cbd-grow-4 kyoto-gion-grow-9
node docs/phase1-evidence/remediation/root-acceptance/geometry/replay.mjs --assets-root work/root-remediation-geometry-assets
```

To reuse the original frozen assets, explicitly pass their directory instead:

```powershell
node docs/phase1-evidence/remediation/root-acceptance/geometry/replay.mjs --assets-root "C:\path\to\core-repair-boundary-frozen"
```

Both case folders must contain their manifests, build reports and chunks. The identity proof checks input hashes/configurations and permits the original asset compiler commit3b62b40 or the currentHEAD; older mixed artifacts are rejected. The five repair patches and frozen core equality remain required. The replay wrapper changes only the temporary runner's source-version reference to the equivalent integrated commit e11990c, which is reachable from this branch in a normal clone. Root verified zero diff between the two references for all five guarded core files; a donor worktree Git object is not required. The original archived runner remains unchanged.

`replay.mjs` finds the repository throughGit or ancestor directories. It verifies canonical SHA-256 and copies original bytes into a fresh directory directly below ignored`work/`, preserving the original `../../src` imports. It records the source-reference adaptation and both runner hashes before spawning the temporary runner. All results stay in that freshwork directory; archived originals are read-only. No geometric assertion or threshold is changed.

Preparation performed file copying only while E held the GPU window. After measurement ended, root ran the final archived wrapper: all12 scripts passed, including the signed-boundary wall and eight actual guardrail caps, with unchanged source SHA. See `archived-replay.txt`; new run output remains in ignored work. The original `prepared-files.json` describes preparation-time wrapper bytes, while `final-consistency.json` in the parent records completed acceptance.
