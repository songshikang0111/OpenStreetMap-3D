# @city-ink/styles

Four official StylePacks: `comic`, `line`, `color`, `white`. `@city-ink/styles/cel` is a separate external ESM example. Three.js is a peer dependency. These packs bind semantic materials, create render pipelines, describe parameters/quality and release resources. They contain no scene data or generated model files.

```js
import cel from '@city-ink/styles/cel';
// City Ink engine entry points:
registerStyle(cel);
const binding = bindSceneStyle(group, {style:{id:cel.id, parameters:{waterOpacity:.8}}, shared});
const pipeline = createStylePipeline({renderer, scene, camera, style:cel, shared});
pipeline.resize(width, height);
pipeline.render();
pipeline.dispose();
binding.dispose();
```

The external example uses Toon materials with owned gradient textures, a direct single-pass renderer and distance fog. It covers buildings, roofs, structure, roads, water, trees, ground, facilities and landmarks. It does not need a core modification. For your own external directory, copy `cel.js`, edit its ID/factories, dynamically import it and register the export. Plugins are trusted local JavaScript, not an untrusted sandbox.

Every mesh requires serializable `userData.city` with `schemaVersion:1`, `featureId`, `sourceIds`, `kind`, `materialRole`, `lodRole` and optional `inkClass`. Procedural facades declare `shader:'facade-v6'` and preserve `aFacade` (4), `aStyle` (2), `aLayout` (4), `aSurface` (2), and `objectId` (3). For multi-role geometry, preserve geometry groups and `geometry.userData.city.materialRoles` indexed by group.materialIndex. Codecs must preserve these fields. The binding restores shader callbacks after decoding; plain ObjectLoader/GLB cannot serialize JavaScript callbacks.

Shared uniforms are `{windows:{value:1}, provenance:{value:0}, facadeDetail:{value:.5}, glassReflection:{value:.65}, toneSize:{value:4.2}, sunDirection:{value:THREE.Vector3}, projectionScale:{value:1000}}`. `createStyleShared` fills defaults while retaining supplied uniform object references. Pipeline resize receives drawing-buffer pixels; the ink pipeline accounts for renderer DPR when filtering facades. Material factories get `{object, role, semantic, shared, parameters, sourceMaterial, services}`. `services.createFacadeMaterial` preserves procedural windows/glass. Pipeline factories get `{renderer, scene, camera, shared, parameters, services}`; `services.createInkPipeline({...context, mode:0..3})` provides the official renderer. Factories must return newly owned materials. Mark generated textures in `material.userData.cityOwnedTextures` (property-name array) for release; source textures remain caller-owned.

Always dispose the current pipeline and binding before switching styles or freeing geometry. Binding disposal restores caller-owned original materials and frees only replacements; it does not dispose source geometry/materials/textures. Pack dispose runs when its last binding/pipeline is released. Official parameters affect materials/postprocessing only (`rebuildParameters:[]`); geometry extensions must declare rebuild parameters and be handled by the builder. Styles do not silently rebuild or download OSM. GLB preserves standard geometry/material subsets, not the full ink/facade pipeline.

Local distribution: `npm pack --pack-destination <temporary-directory>`; install the archive with a compatible Three.js peer. See the repository extension guide and package test. No remote publication is performed in this phase.
