# First physical frame and GPU window integrity — final retest

Reviewed HEAD: 112ae159ad6d5b867d7f3dbe9a48ded2e3c5d23b. First-frame producer: 743d3e55d51439e7a994203ea23d17d420ec493c. First-window assessment: a273e6a05182f989966cc3136b1cd6ea7f289889. Final GPU completeness closure: 112ae15.

Conclusion: closed; no remaining reproduced P1/P2 in this reviewed measurement producer and assessment scope. The first physical frame participates in drawing/resource budgets; GPU evidence has the frozen eight-query capacity and consistent live-query counts. This is a Node harness review, not final real performance acceptance. No browser/GPU was launched, no full check was run, and no A/C product review was performed.

## Actual commands and results

    node work/remediation-review-architecture/final-window-integrity.mjs
    node --test test/phase1-remediation-assessment.test.js

The same 59 rejection probes now all reject (59/59), all eight valid controls pass, and the reproducer exits 0. Targeted author assessment tests pass 6/6. Earlier a273 runtime + assessment validation passed 23/23; the 17 runtime tests were not redundantly rerun for this assessment-only fix.

The eight controls cover an explicit complete 6001-physical-frame case with 6000 FPS intervals; GPU pending boundaries zero/eight; one active GPU query; unsupported GPU with no invented millisecond metrics; exact path/stationary 128MiB resident boundaries; and the real FrameStatistics first-frame copy/reset/FPS behavior. Constructed controls are clearly labelled and are not described as actual SDK/GPU acceptance.

The original GPU completeness P2 is closed: retaining one GPU raw sample while reporting pending=maxPending=unreleased=6000 now fails both window and query checks. The independent gate requires maxPending exactly eight, pending+active at most eight, and unreleased exactly pending+active. A record with pending one and unreleased zero now fails queries. Lifecycle returned snapshots use the same bound and consistency helper.

All other original and new probes remain rejected: missing/invalid first-frame evidence, first-only triangle/draw/resident/near overflow, invalid near-byte/total evidence, incomplete stationary window or repeated saved-camera identity, raised default budgets, actual-camera drift, hidden requests, short epoch, raw 40ms intervals hidden by stale aggregate, sampled resident overflow/peak contradiction, away instance/profile leakage, malformed GPU samples, duplicate/out-of-window timestamps, count mismatch, and aggregate mismatch. FPS still uses only subsequent interval frames; the initial null interval does not alter its definition.

## Optional real smoke evidence

The current script optionally reads work/remediation-raw-producer-smoke.json. If present it validates the existing evidence; if absent it records actualSmoke.status=not-run with a reason. Only ENOENT is treated as absent; malformed or failing present evidence still fails. CITY_INK_REVIEW_SMOKE can choose another evidence path.

Both branches were executed at 112ae15. With the existing smoke file, all GPU/resource checks pass. With CITY_INK_REVIEW_SMOKE set to an absent ignored path, all 59 rejection probes and eight controls still pass, the command exits 0, and actualSmoke explicitly says not-run. Results are retained separately in window-integrity-112-with-smoke.json and window-integrity-112-without-smoke.json. final-window-integrity.json is the final rerun with the present smoke.

The provided real production smoke contains 361 physical frames (1 initial + 360 intervals), 360 GPU raw samples + 1 pending, resident maximum 166628 bytes, and near-total maximum 295. GPU p50/p95/p99/max independently recompute as 3.078144/4.192256/4.515840/5.417984ms. This is three-second existing smoke evidence, not a new measurement or formal >=60-second performance case.

Producer source was checked: SDK begin/end wraps the full renderWithProfile; refreshed resident/body/attachment totals are recorded after rendering; resetStats resets CPU frame and GPU windows together; getStats({raw:true}) requests both raw collectors. FrameStatistics separately copies and resets initialFrame without changing FPS intervals. physicalFrames feeds the first frame into drawing/resource checks and summarizer distributions; GPU display statistics are recomputed from raw values.

## Files and scope limits

Current reusable reproducer and outputs: final-window-integrity.mjs/json/md, under ignored work/remediation-review-architecture. The script can be replayed from a two-level ignored work directory in the repository root, using its static ../../ imports. It no longer requires an ignored smoke file to exist. The failing a273 result remains unchanged as window-integrity-a273-failure.json; it is historical evidence, not the current conclusion.

No tracked file, staging area, product commit, or historical raw was changed. Existing untracked package-results.json belongs to the parent run and was left untouched. Final frozen production SDK/bundle, twelve real >=60-second path cases, the two real >=15-second old-failure stationary views, and final raw auditing remain outside this Node review.
