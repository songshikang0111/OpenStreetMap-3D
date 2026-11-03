# @city-ink/landmarks

Versioned editable recipes, MIT code; source OSM data is © OpenStreetMap contributors, ODbL. No generated model assets. This package makes no network requests and contains no generator code to evaluate. The City Ink engine supplies `city-ink/china-zun` and `city-ink/cctv` implementations. Both preserve source height/min_height records; the silhouette is a parametric approximation.

```js
import pack from '@city-ink/landmarks';
// Import createLandmarkRegistry/checkLandmarkPackage from your City Ink engine.
const check = checkLandmarkPackage(pack);
if (!check.valid) throw new Error(JSON.stringify(check.diagnostics));
const registry = createLandmarkRegistry({ recipes: pack.recipes });
const context = { origin: {lat:39.9095,lon:116.4605}, bounds, seed:1, features };
const matches = registry.match(features, context);
const result = registry.generate(matches[0], context);
```

Use normalized stable `feature.id`, `osmType`, `osmId`, local metre `outer` and `center`, `height`, `minHeight`, and source records. Origin is the projection origin, not a landmark's location. You may pass `project.inverse`/`inverse` instead. Bounds in recipes are geographic; context.bounds are local metres. All required OSM parts must be present. Matching never relies on a name. CCTV's four parts are claimed once as a group; generic geometry is suppressed only after successful generation.

Compatibility uses stable `x.y.z` versions and exact, `>=`, `<=`, `>`, `<`, `^`, `~`, space-separated AND and `||` OR ranges. Unsupported syntax is rejected. Update deliberately to a compatible local archive, validate, save package/recipe versions plus archive/content hashes in the project lock, then rebuild affected objects. Keep the previous archive and lock for rollback. No implicit latest fetch. A CLI integration owns filesystem installation and atomic lock writes; `checkLandmarkPackage` is a pure validation/lock-description helper.

Local distribution: run `npm pack --pack-destination <temporary-directory>` here, then `npm install <archive>` in the consumer. Do not publish until package names and release policy are approved. Only listed source/typing/license/documentation files are shipped. The repository's `test/phase1-landmark-packages.test.js` demonstrates offline installation, two versions, geometry change and exact rollback.
